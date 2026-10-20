/**
 * In-app notifications are the only notification channel. A submitted request notifies
 * whoever it was routed to, and a decision notifies the employee. These drive the real API.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@sns/database';
import { loadConfig } from '@sns/config';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';

type Session = { cookie: string; csrf: string };
const opened: { sqlite: Db; dir: string }[] = [];
let app: FastifyInstance;
let sqlite: Db;
let typeId: string;

async function signIn(email: string): Promise<Session> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: 'ChangeMe_demo_1' },
  });
  expect(res.statusCode).toBe(200);
  const raw = res.headers['set-cookie'];
  const cookie = Array.isArray(raw)
    ? raw.map((c) => c.split(';')[0]).join('; ')
    : String(raw ?? '');
  return { cookie, csrf: /leaveos\.csrf=([^;]*)/.exec(cookie)?.[1] ?? '' };
}
const auth = (s: Session) => ({ cookie: s.cookie, 'x-csrf-token': s.csrf });

async function apply(as: Session, start: string, end: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/leave-requests',
    headers: auth(as),
    payload: { leaveTypeId: typeId, startDate: start, endDate: end, reason: 'Notification check.' },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { data: { id: string } }).data.id;
}

async function inbox(as: Session): Promise<{ kind: string; entity_id: string; body: string }[]> {
  const res = await app.inject({ method: 'GET', url: '/api/v1/notifications', headers: auth(as) });
  expect(res.statusCode).toBe(200);
  const data = (res.json() as { data: unknown }).data as
    { items?: unknown[] } | { kind: string; entity_id: string; body: string }[];
  const items = Array.isArray(data) ? data : (data.items ?? []);
  return items as { kind: string; entity_id: string; body: string }[];
}

beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-notify-'));
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
  typeId = (
    (await sqlite.prepare(`SELECT id FROM leave_type WHERE code = 'AL'`).get()) as {
      id: string;
    }
  ).id;
});

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

describe('in-app notifications', () => {
  it('notifies the reporting manager when a request is submitted', async () => {
    await sqlite.exec(
      `UPDATE employee SET manager_employee_id = (SELECT id FROM employee WHERE work_email = 'david@sns.test')
        WHERE work_email = 'vijay@sns.test'`,
    );
    const id = await apply(await signIn('vijay@sns.test'), '2026-10-05', '2026-10-05');
    const notes = await inbox(await signIn('david@sns.test'));
    expect(notes.find((n) => n.entity_id === id)?.kind).toBe('leave.submitted');
  });

  it('notifies the fallback approver when there is no reporting manager', async () => {
    await sqlite.exec(
      `UPDATE employee SET manager_employee_id = NULL WHERE work_email = 'vijay@sns.test'`,
    );
    const id = await apply(await signIn('vijay@sns.test'), '2026-10-06', '2026-10-06');
    const lead = await inbox(await signIn('john@sns.test'));
    expect(lead.find((n) => n.entity_id === id)?.kind).toBe('leave.submitted');
  });

  it('notifies the employee of an approval and of a rejection', async () => {
    const vijay = await signIn('vijay@sns.test');
    const approver = await signIn('john@sns.test');
    await sqlite.exec(
      `UPDATE employee SET manager_employee_id = NULL WHERE work_email = 'vijay@sns.test'`,
    );
    const a = await apply(vijay, '2026-10-07', '2026-10-07');
    const b = await apply(vijay, '2026-10-08', '2026-10-08');
    const approve = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${a}/approve`,
      headers: auth(approver),
      payload: { expectedVersion: 1 },
    });
    expect(approve.statusCode).toBe(200);
    const reject = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${b}/reject`,
      headers: auth(approver),
      payload: { expectedVersion: 1, reason: 'Cover needed.' },
    });
    expect(reject.statusCode).toBe(200);
    const mine = await inbox(vijay);
    expect(mine.find((n) => n.entity_id === a)?.kind).toBe('leave.approved');
    const rejected = mine.find((n) => n.entity_id === b);
    expect(rejected?.kind).toBe('leave.rejected');
    expect(rejected?.body).toContain('Cover needed.');
  });
});
