import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@sns/database';
import { loadConfig } from '@sns/config';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';

const opened: { sqlite: Db; dir: string }[] = [];

async function boot(env: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-device-'));
  const sqlite = await openDatabase(path.join(dir, 'app.db'));
  opened.push({ sqlite, dir });
  const app = await buildApp(
    loadConfig({
      LEAVEOS_DATA_DIR: dir,
      LEAVEOS_ENV: 'test',
      LEAVEOS_ENFORCE_WORKSTATION: 'true',
      ...env,
    }),
    sqlite,
  );
  await app.ready();
  await app.inject({
    method: 'POST',
    url: '/api/v1/setup',
    payload: {
      companyName: 'Test Co',
      timezone: 'UTC',
      leaveYearStartMonth: 1,
      leaveYearStartDay: 1,
      adminName: 'Ada Example',
      adminEmail: 'admin@example.invalid',
      adminPassword: 'ChangeMe_admin_1',
      loadSampleData: true,
    },
  });
  return { app, sqlite, dir };
}

function cookieHeader(res: { headers: Record<string, unknown> }, previous = ''): string {
  const raw = res.headers['set-cookie'];
  const fresh = (Array.isArray(raw) ? raw : raw ? [String(raw)] : []).map(
    (c) => String(c).split(';')[0] ?? '',
  );
  const map = new Map<string, string>();
  for (const part of [...previous.split('; '), ...fresh]) {
    const name = part.split('=')[0]?.trim();
    if (name) map.set(name, part.trim());
  }
  return [...map.values()].join('; ');
}

function deviceOnly(header: string): string {
  return header
    .split('; ')
    .filter((p) => p.startsWith('leaveos.device='))
    .join('; ');
}

async function login(
  app: FastifyInstance,
  email: string,
  password: string,
  cookie = '',
  remoteAddress?: string,
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: cookie ? { cookie } : {},
    remoteAddress,
    payload: { email, password },
  });
}

afterEach(async () => {
  for (const item of opened.splice(0)) {
    try {
      await item.sqlite.close();
    } catch {
      /* already closed */
    }
    fs.rmSync(item.dir, { recursive: true, force: true });
  }
});

describe('browser device binding', () => {
  it('issues an httpOnly cookie, stays pending, then binds after approval', async () => {
    const { app, sqlite } = await boot();
    const first = await login(app, 'vijay@sns.test', 'ChangeMe_demo_1');
    expect(first.statusCode).toBe(403);
    expect((first.json() as { error: { code: string } }).error.code).toBe(
      'DEVICE_PENDING_APPROVAL',
    );
    const raw = first.headers['set-cookie'];
    const joined = Array.isArray(raw) ? raw.join('\n') : String(raw ?? '');
    expect(joined).toMatch(/leaveos\.device=/);
    expect(joined).toMatch(/HttpOnly/i);
    expect(joined).not.toMatch(/leaveos\.sid=/);

    const device = deviceOnly(cookieHeader(first));
    const admin = await login(app, 'admin@example.invalid', 'ChangeMe_admin_1');
    expect(admin.statusCode).toBe(200);
    const adminCookie = cookieHeader(admin);
    const csrf = /leaveos\.csrf=([^;]*)/.exec(adminCookie)?.[1] ?? '';
    const row = (await sqlite
      .prepare(
        `SELECT b.id, b.status FROM browser_device b
           JOIN user_account ua ON ua.id = b.user_account_id
          WHERE ua.email = 'vijay@sns.test'`,
      )
      .get()) as { id: string; status: string };
    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/devices/${row.id}/approve`,
      headers: { cookie: adminCookie, 'x-csrf-token': csrf },
    });
    expect(approved.statusCode).toBe(200);

    const again = await login(app, 'vijay@sns.test', 'ChangeMe_demo_1', device, '192.168.1.20');
    expect(again.statusCode).toBe(200);
    const audit = (await sqlite
      .prepare(
        `SELECT after_json, ip FROM audit_event WHERE action = 'auth.login' ORDER BY occurred_at DESC`,
      )
      .get()) as { after_json: string; ip: string };
    const detail = JSON.parse(audit.after_json) as { deviceId: string; ip: string; at: string };
    expect(detail.deviceId).toBe(row.id);
    expect(detail.ip).toContain('192.168.1.20');
    expect(detail.at).toMatch(/^\d{4}-/);
    expect(audit.ip).toContain('192.168.1.20');
  });

  it('blocks another person on a bound browser and a bound person on a new browser', async () => {
    const { app, sqlite } = await boot();
    const first = await login(app, 'vijay@sns.test', 'ChangeMe_demo_1');
    const device = deviceOnly(cookieHeader(first));
    const admin = await login(app, 'admin@example.invalid', 'ChangeMe_admin_1');
    const adminCookie = cookieHeader(admin);
    const csrf = /leaveos\.csrf=([^;]*)/.exec(adminCookie)?.[1] ?? '';
    const row = (await sqlite
      .prepare(
        `SELECT b.id FROM browser_device b
           JOIN user_account ua ON ua.id = b.user_account_id
          WHERE ua.email = 'vijay@sns.test'`,
      )
      .get()) as { id: string };
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/devices/${row.id}/approve`,
      headers: { cookie: adminCookie, 'x-csrf-token': csrf },
    });

    const other = await login(app, 'ramesh@sns.test', 'ChangeMe_demo_1', device);
    expect(other.statusCode).toBe(403);
    expect((other.json() as { error: { code: string } }).error.code).toBe('DEVICE_BOUND');
    const note = (await sqlite
      .prepare(`SELECT id FROM notification WHERE kind = 'device.binding'`)
      .get()) as { id: string } | undefined;
    expect(note).toBeDefined();

    const fresh = await login(app, 'vijay@sns.test', 'ChangeMe_demo_1');
    expect(fresh.statusCode).toBe(403);
    expect((fresh.json() as { error: { code: string } }).error.code).toBe('DEVICE_BOUND');
  });

  it('supports revoke, rebind, and approve again', async () => {
    const { app, sqlite } = await boot();
    const first = await login(app, 'vijay@sns.test', 'ChangeMe_demo_1');
    const device = deviceOnly(cookieHeader(first));
    const admin = await login(app, 'admin@example.invalid', 'ChangeMe_admin_1');
    const adminCookie = cookieHeader(admin);
    const csrf = /leaveos\.csrf=([^;]*)/.exec(adminCookie)?.[1] ?? '';
    const auth = { cookie: adminCookie, 'x-csrf-token': csrf };
    const row = (await sqlite
      .prepare(
        `SELECT b.id FROM browser_device b
           JOIN user_account ua ON ua.id = b.user_account_id
          WHERE ua.email = 'vijay@sns.test'`,
      )
      .get()) as { id: string };
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/devices/${row.id}/approve`,
      headers: auth,
    });
    const revoked = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/devices/${row.id}/revoke`,
      headers: auth,
    });
    expect(revoked.statusCode).toBe(200);

    const afterRevoke = await login(app, 'vijay@sns.test', 'ChangeMe_demo_1', device);
    expect(afterRevoke.statusCode).toBe(403);
    expect((afterRevoke.json() as { error: { code: string } }).error.code).toBe(
      'DEVICE_PENDING_APPROVAL',
    );
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/devices/${row.id}/approve`,
      headers: auth,
    });
    expect((await login(app, 'vijay@sns.test', 'ChangeMe_demo_1', device)).statusCode).toBe(200);

    const ramesh = (await sqlite
      .prepare(`SELECT id FROM user_account WHERE email = 'ramesh@sns.test'`)
      .get()) as { id: string };
    const rebound = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/devices/${row.id}/rebind`,
      headers: auth,
      payload: { userId: ramesh.id },
    });
    expect(rebound.statusCode).toBe(200);
    expect((await login(app, 'vijay@sns.test', 'ChangeMe_demo_1', device)).statusCode).toBe(403);
    expect((await login(app, 'ramesh@sns.test', 'ChangeMe_demo_1', device)).statusCode).toBe(200);
  });

  it('blocks a different LAN address when IP match is on', async () => {
    const { app, sqlite } = await boot();
    const admin = await login(app, 'admin@example.invalid', 'ChangeMe_admin_1');
    const adminCookie = cookieHeader(admin);
    const csrf = /leaveos\.csrf=([^;]*)/.exec(adminCookie)?.[1] ?? '';
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/device-binding',
      headers: { cookie: adminCookie, 'x-csrf-token': csrf },
      payload: { enabled: true, requireApproval: false, ipMatch: true },
    });
    expect(saved.statusCode).toBe(200);

    const first = await login(app, 'vijay@sns.test', 'ChangeMe_demo_1', '', '10.0.0.8');
    expect(first.statusCode).toBe(200);
    const device = deviceOnly(cookieHeader(first));
    const moved = await login(app, 'vijay@sns.test', 'ChangeMe_demo_1', device, '10.0.0.9');
    expect(moved.statusCode).toBe(403);
    expect((moved.json() as { error: { code: string } }).error.code).toBe('DEVICE_IP_MISMATCH');
    const row = (await sqlite
      .prepare(`SELECT after_json FROM audit_event WHERE action = 'auth.device_ip_mismatch'`)
      .get()) as { after_json: string };
    expect(JSON.parse(row.after_json).ip).toBe('10.0.0.9');
  });

  it('does not block anyone when binding is turned off', async () => {
    const { app } = await boot({ LEAVEOS_ENFORCE_WORKSTATION: 'false' });
    const first = await login(app, 'vijay@sns.test', 'ChangeMe_demo_1');
    expect(first.statusCode).toBe(200);
    const device = deviceOnly(cookieHeader(first));
    const other = await login(app, 'ramesh@sns.test', 'ChangeMe_demo_1', device);
    expect(other.statusCode).toBe(200);
  });

  it('refuses device settings to someone who cannot manage browsers', async () => {
    const { app } = await boot({ LEAVEOS_ENFORCE_WORKSTATION: 'false' });
    const vijay = await login(app, 'vijay@sns.test', 'ChangeMe_demo_1');
    const cookie = cookieHeader(vijay);
    const csrf = /leaveos\.csrf=([^;]*)/.exec(cookie)?.[1] ?? '';
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/device-binding',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: { enabled: false, requireApproval: false, ipMatch: false },
    });
    expect(res.statusCode).toBe(403);
  });
});
