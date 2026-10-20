import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@sns/database';
import { loadConfig, pathsFor } from '@sns/config';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';
import { serviceHeadline } from './host-local.js';
import { noteSetupPort } from './setup-http.js';

const opened: { sqlite: Db; dir: string }[] = [];

async function boot(extra: NodeJS.ProcessEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-host-'));
  const config = loadConfig({ LEAVEOS_DATA_DIR: dir, LEAVEOS_ENV: 'test', ...extra });
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
  noteSetupPort(null);
  for (const item of opened.splice(0)) {
    await item.sqlite.close();
    fs.rmSync(item.dir, { recursive: true, force: true });
  }
});

describe('host control panel', () => {
  it('labels a running Windows service as Running', () => {
    expect(serviceHeadline('running')).toBe('Running');
    expect(serviceHeadline('stopped')).toBe('Stopped');
  });

  it('serves the panel on the loopback address and refuses a LAN address', async () => {
    const { app } = await boot();
    const local = await openPanel(app);
    expect(local.res.statusCode).toBe(200);
    expect(local.res.body).toContain('Host control');
    expect(local.res.body).toContain('id="service-state">Not queried');
    expect(local.res.body).toContain('id="staff-url">http://sns-leave:');
    expect(local.res.body).toContain('sns-leave.local');
    expect(local.res.body).toContain('/api/v1/host/qr.svg?for=hostname');
    expect(local.res.body).toContain('/api/v1/host/qr.svg?for=mdns');
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

  it('points staff links at the HTTP setup page when HTTPS is on', async () => {
    noteSetupPort(8080);
    const { app } = await boot({ LEAVEOS_TLS_ENABLED: 'true' });
    const local = await openPanel(app);
    expect(local.res.statusCode).toBe(200);
    expect(local.res.body).toContain('id="staff-url">http://sns-leave:8080');
    expect(local.res.body).toContain('id="mdns-url">http://sns-leave.local:8080');
    expect(local.res.body).toContain('alt="QR code for http://sns-leave:8080"');
    expect(local.res.body).toContain('data-for="hostname"');
    expect(local.res.body).toContain('src="/host/panel.js"');
    const panelJs = await app.inject({ method: 'GET', url: '/host/panel.js' });
    expect(panelJs.body).toContain('links.hostname');
    expect(panelJs.body).toContain('/api/v1/host/qr.svg?for=');
    expect(local.res.body).toContain('sets up trust');
    expect(local.res.body).not.toContain('https://sns-leave:8443');

    const status = await app.inject({ method: 'GET', url: '/api/v1/host/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json().links.hostname).toBe('http://sns-leave:8080');
    expect(status.json().links.mdns).toBe('http://sns-leave.local:8080');
    const qr = await app.inject({ method: 'GET', url: '/api/v1/host/qr.svg?for=hostname' });
    expect(qr.statusCode).toBe(200);
    expect(String(qr.headers['content-type'])).toContain('image/svg+xml');
    expect(qr.body).toContain('<svg');

    noteSetupPort(80);
    const plain = await openPanel(app);
    expect(plain.res.body).toContain('id="staff-url">http://sns-leave</p>');
    expect(plain.res.body).toContain('id="mdns-url">http://sns-leave.local</p>');
    expect(plain.res.body).not.toContain('http://sns-leave:80');
    const status80 = await app.inject({ method: 'GET', url: '/api/v1/host/status' });
    expect(status80.json().links.hostname).toBe('http://sns-leave');
    expect(status80.json().links.mdns).toBe('http://sns-leave.local');
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

  it('sets the backup folder from the panel, shows when the last backup ran, and restores from that folder', async () => {
    const { app, sqlite, dbPath, dir } = await boot();
    const drive = path.join(dir, 'usb-drive');
    const panel = await openPanel(app);
    const form = { 'content-type': 'application/x-www-form-urlencoded', cookie: panel.cookie };
    const saved = await app.inject({
      method: 'POST',
      url: '/api/v1/host/backup-settings',
      headers: form,
      payload: `token=${panel.token}&enabled=1&directory=${encodeURIComponent(drive)}&retentionCount=3`,
    });
    expect(String(saved.headers.location)).toContain('notice=');
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/host/backup-settings',
      headers: form,
      payload: `token=${panel.token}&directory=&retentionCount=0`,
    });
    expect(String(bad.headers.location)).toContain('error=');

    const { runScheduledBackup } = await import('./backup-job.js');
    expect(
      await runScheduledBackup(
        sqlite,
        pathsFor(loadConfig({ LEAVEOS_DATA_DIR: dir, LEAVEOS_ENV: 'test' })).backups,
      ),
    ).toBe('written');
    const files = fs.readdirSync(drive).filter((n) => n.endsWith('.db'));
    expect(files).toHaveLength(1);
    const page = await app.inject({ method: 'GET', url: '/host' });
    expect(page.body).toContain('id="last-backup"');
    expect(page.body).toMatch(/<time>\d{4}-\d{2}-\d{2}T/);
    expect(page.body).toContain(drive);

    await sqlite
      .prepare(`UPDATE company SET name = 'Changed After Backup' WHERE id = 'company'`)
      .run();
    const restore = await app.inject({
      method: 'POST',
      url: '/api/v1/host/restore',
      headers: form,
      payload: `token=${panel.token}&file=${encodeURIComponent(files[0]!)}`,
    });
    expect(String(restore.headers.location)).toContain('notice=');
    await app.close();
    await sqlite.close();
    const reopened = await openDatabase(dbPath);
    opened[0]!.sqlite = reopened;
    const company = (await reopened
      .prepare(`SELECT name FROM company WHERE id = 'company'`)
      .get()) as { name: string };
    expect(company.name).toBe('Test Co');
  });

  it('saves an office name and rejects a name with a space', async () => {
    const { app, sqlite } = await boot();
    const panel = await openPanel(app);
    const saved = await app.inject({
      method: 'POST',
      url: '/api/v1/host/hostname',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: panel.cookie },
      payload: `token=${panel.token}&hostname=Front-Desk.local`,
    });
    expect(saved.statusCode).toBe(303);
    const row = (await sqlite
      .prepare(`SELECT value_json FROM app_setting WHERE key = 'ops.hostname'`)
      .get()) as { value_json: string };
    expect(JSON.parse(row.value_json).hostname).toBe('front-desk');
    const again = await openPanel(app);
    expect(again.res.body).toContain('front-desk.local');
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/host/hostname',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: panel.cookie },
      payload: `token=${panel.token}&hostname=not%20a%20name`,
    });
    expect(String(bad.headers.location)).toContain('error=');

    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/settings/hostname' });
    expect(anonymous.statusCode).toBe(401);
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@example.invalid', password: 'ChangeMe_admin_1' },
    });
    const pairs = (
      Array.isArray(login.headers['set-cookie'])
        ? login.headers['set-cookie']
        : [String(login.headers['set-cookie'])]
    ).map((c) => String(c).split(';')[0] ?? '');
    const csrf = pairs.find((p) => p.startsWith('leaveos.csrf='))?.slice('leaveos.csrf='.length);
    const named = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/hostname',
      headers: { cookie: pairs.join('; '), 'x-csrf-token': csrf },
      payload: { hostname: 'sns-leave' },
    });
    expect(named.statusCode).toBe(200);
    expect(named.json().data.hostname).toBe('sns-leave');
  });
});
