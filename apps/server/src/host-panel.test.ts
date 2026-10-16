import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@sns/database';
import { loadConfig, pathsFor } from '@sns/config';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';

const opened: { sqlite: Db; dir: string }[] = [];

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-host-'));
  const config = loadConfig({ LEAVEOS_DATA_DIR: dir, LEAVEOS_ENV: 'test' });
  const dbPath = pathsFor(config).db;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = await openDatabase(dbPath);
  opened.push({ sqlite, dir });
  const app = await buildApp(config, sqlite);
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
    },
  });
  return { app, sqlite, dir, dbPath };
}

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return list.map((c) => String(c).split(';')[0]).join('; ');
}

async function openPanel(app: FastifyInstance) {
  const res = await app.inject({ method: 'GET', url: '/host' });
  const token = /name="token" value="([a-f0-9]+)"/.exec(res.body)?.[1] ?? '';
  return { res, token, cookie: cookieFrom(res) };
}

afterEach(async () => {
  for (const item of opened.splice(0)) {
    await item.sqlite.close();
    fs.rmSync(item.dir, { recursive: true, force: true });
  }
});

describe('host control panel', () => {
  it('serves the panel on the loopback address and refuses a LAN address', async () => {
    const { app } = await boot();
    const local = await openPanel(app);
    expect(local.res.statusCode).toBe(200);
    expect(local.res.body).toContain('Host control');
    expect(local.res.body).toContain('No browsers are waiting');
    expect(local.res.body).toContain('No backup files yet');
    expect(local.token).toHaveLength(64);

    const remote = await app.inject({ method: 'GET', url: '/host', remoteAddress: '10.1.1.8' });
    expect(remote.statusCode).toBe(403);
    expect(remote.body).toContain('You do not have permission to view this.');

    const remoteApi = await app.inject({
      method: 'GET',
      url: '/api/v1/host/status',
      remoteAddress: '10.1.1.8',
    });
    expect(remoteApi.statusCode).toBe(403);
    expect(remoteApi.json().error.code).toBe('HOST_LOCAL_ONLY');
  });

  it('backs up, stages a restore, and approves a waiting browser', async () => {
    const { app, sqlite, dbPath } = await boot();
    const panel = await openPanel(app);
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/host/backup',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: panel.cookie },
      payload: 'token=nope',
    });
    expect(denied.statusCode).toBe(303);
    expect(denied.headers.location).toContain('error=');

    const backup = await app.inject({
      method: 'POST',
      url: '/api/v1/host/backup',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: panel.cookie },
      payload: `token=${panel.token}`,
    });
    expect(backup.statusCode).toBe(303);
    expect(String(backup.headers.location)).toContain('notice=');
    const row = (await sqlite.prepare(`SELECT path, status FROM backup_record`).get()) as {
      path: string;
      status: string;
    };
    expect(row.status).toBe('ok');
    expect(fs.existsSync(row.path)).toBe(true);

    await sqlite
      .prepare(
        `INSERT INTO browser_device (id, status, user_account_id, label, created_at)
         VALUES ('devhost000000000000000001', 'pending', (SELECT id FROM user_account LIMIT 1), 'Front desk', ?)`,
      )
      .run(new Date().toISOString());
    const approved = await app.inject({
      method: 'POST',
      url: '/api/v1/host/devices/approve',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: panel.cookie },
      payload: `token=${panel.token}&deviceId=devhost000000000000000001`,
    });
    expect(approved.statusCode).toBe(303);
    const device = (await sqlite
      .prepare(`SELECT status FROM browser_device WHERE id = 'devhost000000000000000001'`)
      .get()) as { status: string };
    expect(device.status).toBe('approved');

    const restarted = await app.inject({
      method: 'POST',
      url: '/api/v1/host/service',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: panel.cookie },
      payload: `token=${panel.token}&action=restart`,
    });
    expect(String(restarted.headers.location)).toContain('Recorded');
    const missed = await app.inject({ method: 'GET', url: '/host?q=no-such-backup-name' });
    expect(missed.body).toContain('Nothing matched');

    await sqlite
      .prepare(`UPDATE company SET name = 'Changed After Backup' WHERE id = 'company'`)
      .run();
    const file = path.basename(row.path);
    const restore = await app.inject({
      method: 'POST',
      url: '/api/v1/host/restore',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: panel.cookie },
      payload: `token=${panel.token}&file=${encodeURIComponent(file)}`,
    });
    expect(restore.statusCode).toBe(303);
    expect(fs.existsSync(`${dbPath}.restore`)).toBe(true);
    await app.close();
    await sqlite.close();
    const reopened = await openDatabase(dbPath);
    opened[0]!.sqlite = reopened;
    const company = (await reopened
      .prepare(`SELECT name FROM company WHERE id = 'company'`)
      .get()) as {
      name: string;
    };
    expect(company.name).toBe('Test Co');
    expect(fs.existsSync(`${dbPath}.restore`)).toBe(false);
  });
});
