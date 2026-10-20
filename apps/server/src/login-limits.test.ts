/**
 * Sign-in rate limiting and session expiry (idle and absolute). These drive the real API.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@sns/database';
import { loadConfig } from '@sns/config';
import { newId } from '@sns/domain';
import { buildApp } from './app.js';
import { LOGIN_LIMIT_PER_IP, LOGIN_LIMIT_PER_NAME } from './usecases/auth.js';
import type { FastifyInstance } from 'fastify';

const opened: { sqlite: Db; dir: string }[] = [];
let app: FastifyInstance;
let sqlite: Db;
const ADMIN = { email: 'admin@example.invalid', password: 'ChangeMe_admin_1' };

async function boot(env: NodeJS.ProcessEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-limits-'));
  sqlite = await openDatabase(path.join(dir, 'app.db'));
  opened.push({ sqlite, dir });
  app = await buildApp(loadConfig({ LEAVEOS_DATA_DIR: dir, LEAVEOS_ENV: 'test', ...env }), sqlite);
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
      adminEmail: ADMIN.email,
      adminPassword: ADMIN.password,
    },
  });
}

function login(email: string, password: string, remoteAddress?: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
    ...(remoteAddress ? { remoteAddress } : {}),
  });
}

async function recordFailures(ip: string, name: string, count: number, at = new Date()) {
  for (let i = 0; i < count; i++) {
    await sqlite
      .prepare(
        `INSERT INTO login_attempt (id, email_attempted, succeeded, ip, user_agent, created_at, failure_reason)
         VALUES (?, ?, 0, ?, 'test', ?, 'bad_password')`,
      )
      .run(newId(), name, ip, at.toISOString());
  }
}

afterEach(async () => {
  await app?.close();
  for (const item of opened.splice(0)) {
    try {
      await item.sqlite.close();
    } catch {
      /* already closed */
    }
    fs.rmSync(item.dir, { recursive: true, force: true });
  }
});

describe('sign-in rate limiting', () => {
  beforeEach(() => boot());

  it('refuses everything from an address after too many failures, but not other addresses', async () => {
    await recordFailures('10.9.9.9', 'someone-else', LOGIN_LIMIT_PER_IP);
    const blocked = await login(ADMIN.email, ADMIN.password, '10.9.9.9');
    expect(blocked.statusCode).toBe(429);
    expect((blocked.json() as { error: { code: string } }).error.code).toBe('LOGIN_RATE_LIMITED');
    expect((await login(ADMIN.email, ADMIN.password, '10.9.9.10')).statusCode).toBe(200);
  });

  it('limits guessing at one name, including a name that does not exist', async () => {
    await recordFailures('10.9.9.20', 'nobody@example.invalid', LOGIN_LIMIT_PER_NAME);
    const blocked = await login('nobody@example.invalid', 'whatever', '10.9.9.21');
    expect(blocked.statusCode).toBe(429);
    expect((await login(ADMIN.email, ADMIN.password, '10.9.9.21')).statusCode).toBe(200);
  });

  it('forgets failures once the window has passed', async () => {
    const old = new Date(Date.now() - 16 * 60_000);
    await recordFailures('10.9.9.30', ADMIN.email, LOGIN_LIMIT_PER_IP, old);
    expect((await login(ADMIN.email, ADMIN.password, '10.9.9.30')).statusCode).toBe(200);
  });

  it('counts real wrong passwords toward the limit', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await login('ghost@example.invalid', 'nope', '10.9.9.40')).statusCode).toBe(401);
    }
    const n = (await sqlite
      .prepare(`SELECT COUNT(*) AS n FROM login_attempt WHERE ip = '10.9.9.40' AND succeeded = 0`)
      .get()) as { n: number };
    expect(Number(n.n)).toBe(3);
  });
});

describe('session expiry', () => {
  async function signedIn() {
    const res = await login(ADMIN.email, ADMIN.password);
    expect(res.statusCode).toBe(200);
    const raw = res.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw : [String(raw)])
      .map((c) => c.split(';')[0])
      .join('; ');
    return cookie;
  }
  const me = (cookie: string) =>
    app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });

  it('ends a session that has been idle too long', async () => {
    await boot();
    const cookie = await signedIn();
    expect((await me(cookie)).statusCode).toBe(200);
    const stale = new Date(Date.now() - 3 * 3600_000).toISOString();
    await sqlite.prepare(`UPDATE session SET last_seen_at = ?`).run(stale);
    expect((await me(cookie)).statusCode).toBe(401);
    const row = (await sqlite.prepare(`SELECT revoked_reason AS r FROM session`).get()) as {
      r: string;
    };
    expect(row.r).toBe('idle');
  });

  it('ends a session at its absolute limit even if it is in constant use', async () => {
    await boot();
    const cookie = await signedIn();
    const past = new Date(Date.now() - 60_000).toISOString();
    await sqlite.prepare(`UPDATE session SET expires_at = ?`).run(past);
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it('keeps a session that is active and inside both limits', async () => {
    await boot();
    const cookie = await signedIn();
    const recent = new Date(Date.now() - 30 * 60_000).toISOString();
    await sqlite.prepare(`UPDATE session SET last_seen_at = ?`).run(recent);
    expect((await me(cookie)).statusCode).toBe(200);
  });

  it('sets the absolute limit from configuration', async () => {
    await boot({ LEAVEOS_SESSION_ABSOLUTE_HOURS: '1', LEAVEOS_SESSION_IDLE_HOURS: '0.5' });
    await signedIn();
    const row = (await sqlite.prepare(`SELECT issued_at, expires_at FROM session`).get()) as {
      issued_at: string;
      expires_at: string;
    };
    const hours = (Date.parse(row.expires_at) - Date.parse(row.issued_at)) / 3600_000;
    expect(hours).toBeCloseTo(1, 1);
  });
});
