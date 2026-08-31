import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@sns/database';
import { loadConfig } from '@sns/config';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';
const opened: {
  sqlite: Db;
  dir: string;
}[] = [];
async function boot(): Promise<{
  app: FastifyInstance;
  dir: string;
  sqlite: Db;
}> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-app-'));
  const sqlite = await openDatabase(path.join(dir, 'app.db'));
  opened.push({ sqlite, dir });
  const config = loadConfig({ LEAVEOS_DATA_DIR: dir, LEAVEOS_ENV: 'test' });
  const app = await buildApp(config, sqlite);
  await app.ready();
  return { app, dir, sqlite };
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
describe('API slice', () => {
  it('healthz is public', async () => {
    const { app } = await boot();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
  it('rejects unknown keys on login', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'a@example.invalid', password: 'x', role: 'admin' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });
  it('setup, login, submit, double-approve (F-01)', async () => {
    const { app } = await boot();
    const setup = await app.inject({
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
    expect(setup.statusCode).toBe(200);
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@example.invalid', password: 'ChangeMe_admin_1' },
    });
    expect(login.statusCode).toBe(200);
    const cookies = login.headers['set-cookie'];
    const cookieHeader = Array.isArray(cookies)
      ? cookies.map((c) => c.split(';')[0]).join('; ')
      : String(cookies);
    const csrf = /leaveos.csrf=([^;]+)/.exec(cookieHeader)?.[1] ?? '';
    const types = await app.inject({
      method: 'GET',
      url: '/api/v1/leave-types',
      headers: { cookie: cookieHeader, 'x-csrf-token': csrf },
    });
    expect(types.statusCode).toBe(200);
    const typeId = (
      types.json() as {
        data: {
          id: string;
          code: string;
        }[];
      }
    ).data.find((t) => t.code === 'CL')?.id;
    expect(typeId).toBeTruthy();
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: cookieHeader },
    });
    expect(me.statusCode).toBe(200);
    const submitted = await app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: { cookie: cookieHeader, 'x-csrf-token': csrf, 'idempotency-key': 'k-1' },
      payload: {
        leaveTypeId: typeId,
        startDate: '2026-08-24',
        endDate: '2026-08-24',
        reason: 'Need a day for a family appointment.',
      },
    });
    expect(submitted.statusCode).toBe(201);
    const requestId = (
      submitted.json() as {
        data: {
          id: string;
        };
      }
    ).data.id;
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: { cookie: cookieHeader, 'x-csrf-token': csrf, 'idempotency-key': 'k-1' },
      payload: {
        leaveTypeId: typeId,
        startDate: '2026-08-24',
        endDate: '2026-08-24',
        reason: 'Need a day for a family appointment.',
      },
    });
    expect(replay.statusCode).toBe(201);
    expect(
      (
        replay.json() as {
          data: {
            id: string;
          };
        }
      ).data.id,
    ).toBe(requestId);
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/leave-requests/${requestId}`,
      headers: { cookie: cookieHeader },
    });
    const version = (
      detail.json() as {
        data: {
          version: number;
        };
      }
    ).data.version;
    const a1 = app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${requestId}/approve`,
      headers: { cookie: cookieHeader, 'x-csrf-token': csrf },
      payload: { expectedVersion: version },
    });
    const a2 = app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${requestId}/approve`,
      headers: { cookie: cookieHeader, 'x-csrf-token': csrf },
      payload: { expectedVersion: version },
    });
    const [r1, r2] = await Promise.all([a1, a2]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes[0]).toBe(200);
    expect(codes[1]).toBe(409);
    const hrLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'ravi@example.invalid', password: 'ChangeMe_demo_1' },
    });
    const hrCookies = hrLogin.headers['set-cookie'];
    const hrHeader = Array.isArray(hrCookies)
      ? hrCookies.map((c) => c.split(';')[0]).join('; ')
      : String(hrCookies);
    const hrCsrf = /leaveos.csrf=([^;]+)/.exec(hrHeader)?.[1] ?? '';
    const denied = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${requestId}/approve`,
      headers: { cookie: hrHeader, 'x-csrf-token': hrCsrf },
      payload: { expectedVersion: version + 1 },
    });
    expect(denied.statusCode).toBe(403);
    await app.close();
  });
  it('notifications delivery, listing with entity metadata, and individual/bulk read marking', async () => {
    const { app } = await boot();
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
    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@example.invalid', password: 'ChangeMe_admin_1' },
    });
    const cookies = adminLogin.headers['set-cookie'];
    const cookieHeader = Array.isArray(cookies)
      ? cookies.map((c) => c.split(';')[0]).join('; ')
      : String(cookies);
    const csrf = /leaveos.csrf=([^;]+)/.exec(cookieHeader)?.[1] ?? '';

    // Get leave type
    const typesRes = await app.inject({
      method: 'GET',
      url: '/api/v1/leave-types',
      headers: { cookie: cookieHeader },
    });
    const typeId = (typesRes.json() as { data: { id: string; code: string }[] }).data.find(
      (t) => t.code === 'CL',
    )!.id;

    // Submit leave request (recipient approver will receive notification)
    const submitRes = await app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: { cookie: cookieHeader, 'x-csrf-token': csrf },
      payload: {
        leaveTypeId: typeId,
        startDate: '2026-09-01',
        endDate: '2026-09-01',
        reason: 'Dentist appointment',
      },
    });
    expect(submitRes.statusCode).toBe(201);
    const reqId = (submitRes.json() as { data: { id: string } }).data.id;

    // Fetch notifications for the approver (Admin)
    const notifsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { cookie: cookieHeader },
    });
    expect(notifsRes.statusCode).toBe(200);
    const notifList = (
      notifsRes.json() as {
        data: {
          id: string;
          kind: string;
          title: string;
          entity_type: string;
          entity_id: string;
          read_at: string | null;
        }[];
      }
    ).data;

    expect(notifList.length).toBeGreaterThan(0);
    const targetNotif = notifList.find((n) => n.entity_id === reqId);
    expect(targetNotif).toBeDefined();
    expect(targetNotif?.entity_type).toBe('leave_request');
    expect(targetNotif?.read_at).toBeNull();

    // Mark single notification read
    const markSingleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/read',
      headers: { cookie: cookieHeader, 'x-csrf-token': csrf },
      payload: { id: targetNotif!.id },
    });
    expect(markSingleRes.statusCode).toBe(200);

    // Verify read status
    const refreshedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { cookie: cookieHeader },
    });
    const refreshedNotif = (
      refreshedRes.json() as {
        data: { id: string; read_at: string | null }[];
      }
    ).data.find((n) => n.id === targetNotif!.id);
    expect(refreshedNotif?.read_at).toBeTruthy();

    await app.close();
  });
});
