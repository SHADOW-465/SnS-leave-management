/**
 * Annual Leave is the only leave type. Nobody can add, rename or archive one, and an install
 * that still carries other types is migrated without disturbing the history on them.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '@sns/database';
import { loadConfig } from '@sns/config';
import { buildApp } from './app.js';
import { addYearlyGrantType } from './test-support.js';
import type { FastifyInstance } from 'fastify';

const opened: { sqlite: Db; dir: string }[] = [];
type Session = { cookie: string; csrf: string };
let app: FastifyInstance;
let sqlite: Db;

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-types-'));
  sqlite = await openDatabase(path.join(dir, 'app.db'));
  opened.push({ sqlite, dir });
  app = await buildApp(loadConfig({ LEAVEOS_DATA_DIR: dir, LEAVEOS_ENV: 'test' }), sqlite);
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
}

async function signIn(email: string, password: string): Promise<Session> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  const raw = res.headers['set-cookie'];
  const cookie = Array.isArray(raw)
    ? raw.map((c) => c.split(';')[0]).join('; ')
    : String(raw ?? '');
  return { cookie, csrf: /leaveos\.csrf=([^;]*)/.exec(cookie)?.[1] ?? '' };
}
const auth = (s: Session) => ({ cookie: s.cookie, 'x-csrf-token': s.csrf });

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

describe('a single leave type', () => {
  it('offers only Annual Leave, at 2 days a month', async () => {
    await boot();
    const admin = await signIn('admin@example.invalid', 'ChangeMe_admin_1');
    const types = await app.inject({
      method: 'GET',
      url: '/api/v1/leave-types',
      headers: auth(admin),
    });
    const list = (types.json() as { data: { code: string }[] }).data;
    expect(list.map((t) => t.code)).toEqual(['AL']);
    const policies = await app.inject({
      method: 'GET',
      url: '/api/v1/policies',
      headers: auth(admin),
    });
    const rules = JSON.parse(
      (policies.json() as { data: { rules_json: string }[] }).data[0]!.rules_json,
    ) as { entitlementHalfDays: number; accrualMethod: string };
    expect(rules.accrualMethod).toBe('monthly');
    expect(rules.entitlementHalfDays / 2).toBe(24);
  });

  it('has no way to add, rename or archive a type', async () => {
    await boot();
    const admin = await signIn('admin@example.invalid', 'ChangeMe_admin_1');
    for (const [method, url] of [
      ['GET', '/api/v1/admin/leave-types'],
      ['POST', '/api/v1/admin/leave-types'],
      ['PATCH', '/api/v1/admin/leave-types/x'],
      ['PUT', '/api/v1/admin/leave-types/x/archived'],
    ] as const) {
      const res = await app.inject({ method, url, headers: auth(admin), payload: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it('migrates other types away and keeps their history in reports', async () => {
    await boot();
    const cl = await addYearlyGrantType(sqlite);
    const vijay = await signIn('vijay@sns.test', 'ChangeMe_demo_1');
    const submitted = await app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: auth(vijay),
      payload: {
        leaveTypeId: cl,
        startDate: '2026-10-05',
        endDate: '2026-10-05',
        reason: 'Before the migration.',
      },
    });
    expect(submitted.statusCode).toBe(201);
    const requestId = (submitted.json() as { data: { id: string } }).data.id;

    await sqlite.exec(`DELETE FROM schema_migration WHERE id = '0014_single_leave_type'`);
    await migrate(sqlite);

    const archived = (await sqlite
      .prepare(`SELECT code FROM leave_type WHERE archived_at IS NOT NULL`)
      .all()) as { code: string }[];
    expect(archived.map((t) => t.code)).toEqual(['CL']);
    const kept = (await sqlite
      .prepare(`SELECT leave_type_id FROM leave_request WHERE id = ?`)
      .get(requestId)) as { leave_type_id: string };
    expect(kept.leave_type_id).toBe(cl);

    const types = await app.inject({
      method: 'GET',
      url: '/api/v1/leave-types',
      headers: auth(vijay),
    });
    expect((types.json() as { data: { code: string }[] }).data.map((t) => t.code)).toEqual(['AL']);
    const refused = await app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: auth(vijay),
      payload: {
        leaveTypeId: cl,
        startDate: '2026-10-12',
        endDate: '2026-10-12',
        reason: 'Archived type.',
      },
    });
    expect(refused.statusCode).toBe(400);

    const admin = await signIn('admin@example.invalid', 'ChangeMe_admin_1');
    for (const url of [
      '/api/v1/reports/annual',
      '/api/v1/reports?year=2026&month=10',
      '/api/v1/reports/export.csv?year=2026&month=10',
      '/api/v1/ledger',
    ]) {
      const res = await app.inject({ method: 'GET', url, headers: auth(admin) });
      expect(res.statusCode, url).toBe(200);
    }
  });
});
