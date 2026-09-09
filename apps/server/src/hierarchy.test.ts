/**
 * Leave follows the organisation chart. A team member's request is decided by their team
 * lead so routine leave never lands on HR; a team lead goes to their department head, a
 * department head to HR, and HR to an administrator. These tests drive the real API.
 *
 * The seeded sample org is: Engineering (head: Sofia) containing the Platform team
 * (lead: Ravi, member: Amina) and Customer Support (member: Paul). Helen is HR, Ada is
 * the administrator.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@sns/database';
import { loadConfig } from '@sns/config';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';

const opened: { sqlite: Db; dir: string }[] = [];
type Session = { cookie: string; csrf: string };

let app: FastifyInstance;
let sqlite: Db;
let clTypeId: string;

function sessionFrom(res: { headers: Record<string, unknown> }): Session {
  const raw = res.headers['set-cookie'];
  const cookie = Array.isArray(raw)
    ? raw.map((c) => c.split(';')[0]).join('; ')
    : String(raw ?? '');
  return { cookie, csrf: /leaveos\.csrf=([^;]*)/.exec(cookie)?.[1] ?? '' };
}

async function signIn(email: string, password = 'ChangeMe_demo_1'): Promise<Session> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  return sessionFrom(res);
}

const auth = (s: Session) => ({ cookie: s.cookie, 'x-csrf-token': s.csrf });

async function apply(as: Session, start: string, end: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/leave-requests',
    headers: auth(as),
    payload: {
      leaveTypeId: clTypeId,
      startDate: start,
      endDate: end,
      reason: 'Exercising the approval hierarchy end to end.',
    },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { data: { id: string } }).data.id;
}

/** Who the request was actually routed to. */
async function approverEmailFor(requestId: string): Promise<string | null> {
  const row = (await sqlite
    .prepare(
      `SELECT ua.email AS email FROM approval_step_instance s
         JOIN user_account ua ON ua.id = s.approver_user_id
        WHERE s.leave_request_id = ?`,
    )
    .get(requestId)) as { email: string } | undefined;
  return row?.email ?? null;
}

beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-hier-'));
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
  const row = (await sqlite.prepare(`SELECT id FROM leave_type WHERE code = 'CL'`).get()) as {
    id: string;
  };
  clTypeId = row.id;
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

describe('routing follows the organisation chart', () => {
  it('sends a team member to their team lead, not to HR', async () => {
    const id = await apply(await signIn('amina@example.invalid'), '2026-10-05', '2026-10-07');
    expect(await approverEmailFor(id)).toBe('ravi@example.invalid');
  });

  it('sends a team lead to their department head', async () => {
    const id = await apply(await signIn('ravi@example.invalid'), '2026-10-12', '2026-10-13');
    expect(await approverEmailFor(id)).toBe('sofia@example.invalid');
  });

  it('sends a department head to HR', async () => {
    const id = await apply(await signIn('sofia@example.invalid'), '2026-10-19', '2026-10-20');
    expect(await approverEmailFor(id)).toBe('helen@example.invalid');
  });

  it('sends HR to an administrator', async () => {
    const id = await apply(await signIn('helen@example.invalid'), '2026-10-26', '2026-10-27');
    expect(await approverEmailFor(id)).toBe('admin@example.invalid');
  });

  it('records which rung decided, so an escalation is explainable', async () => {
    const id = await apply(await signIn('amina@example.invalid'), '2026-11-02', '2026-11-03');
    const row = (await sqlite
      .prepare(`SELECT escalation_reason FROM leave_request WHERE id = ?`)
      .get(id)) as { escalation_reason: string | null };
    // Routed to the first rung, so there is nothing to explain.
    expect(row.escalation_reason).toBeNull();
  });
});

describe('the team lead can actually decide', () => {
  it('approves their own team member without company-wide rights', async () => {
    const amina = await signIn('amina@example.invalid');
    const ravi = await signIn('ravi@example.invalid');
    const id = await apply(amina, '2026-10-05', '2026-10-07');

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/leave-requests/${id}`,
      headers: { cookie: ravi.cookie },
    });
    const version = (detail.json() as { data: { version: number } }).data.version;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${id}/approve`,
      headers: auth(ravi),
      payload: { expectedVersion: version },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { status: string } }).data.status).toBe('approved');

    const ledger = (await sqlite
      .prepare(`SELECT entry_type FROM balance_ledger WHERE source_id = ? ORDER BY created_at`)
      .all(id)) as { entry_type: string }[];
    expect(ledger.map((r) => r.entry_type)).toEqual(['PENDING_HOLD', 'HOLD_RELEASE', 'DEDUCTION']);
  });

  it('cannot decide a request routed to someone else', async () => {
    // Paul is in a different team; Ravi is not his approver.
    const paul = await signIn('paul@example.invalid');
    const ravi = await signIn('ravi@example.invalid');
    const id = await apply(paul, '2026-10-05', '2026-10-06');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${id}/approve`,
      headers: auth(ravi),
      payload: { expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('cannot decide their own request', async () => {
    const ravi = await signIn('ravi@example.invalid');
    const id = await apply(ravi, '2026-10-12', '2026-10-13');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${id}/approve`,
      headers: auth(ravi),
      payload: { expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('escalation when a rung is unavailable', () => {
  it('goes to the department head when the team has no lead', async () => {
    await sqlite.exec(`UPDATE team SET lead_employee_id = NULL WHERE name = 'Platform'`);
    const id = await apply(await signIn('amina@example.invalid'), '2026-10-05', '2026-10-07');
    expect(await approverEmailFor(id)).toBe('sofia@example.invalid');
    const row = (await sqlite
      .prepare(`SELECT escalation_reason FROM leave_request WHERE id = ?`)
      .get(id)) as { escalation_reason: string | null };
    expect(row.escalation_reason).toBe('no_team_lead');
  });

  it('goes to HR when neither the lead nor the head is available', async () => {
    await sqlite.exec(`UPDATE team SET lead_employee_id = NULL WHERE name = 'Platform'`);
    await sqlite.exec(`UPDATE department SET head_employee_id = NULL WHERE code = 'ENG'`);
    const id = await apply(await signIn('amina@example.invalid'), '2026-10-05', '2026-10-07');
    expect(await approverEmailFor(id)).toBe('helen@example.invalid');
  });

  it('skips a lead whose account is disabled', async () => {
    await sqlite.exec(
      `UPDATE user_account SET is_disabled = 1 WHERE email = 'ravi@example.invalid'`,
    );
    const id = await apply(await signIn('amina@example.invalid'), '2026-10-05', '2026-10-07');
    expect(await approverEmailFor(id)).toBe('sofia@example.invalid');
  });

  it('refuses clearly when nobody can approve, rather than failing obscurely', async () => {
    await sqlite.exec(`UPDATE team SET lead_employee_id = NULL`);
    await sqlite.exec(`UPDATE department SET head_employee_id = NULL`);
    await sqlite.exec(
      `UPDATE user_account SET is_disabled = 1
        WHERE id IN (SELECT ur.user_account_id FROM user_role ur
                     JOIN role r ON r.id = ur.role_id WHERE r.code IN ('hr_officer','admin'))`,
    );
    const amina = await signIn('amina@example.invalid');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: auth(amina),
      payload: {
        leaveTypeId: clTypeId,
        startDate: '2026-10-05',
        endDate: '2026-10-07',
        reason: 'Nobody is left to approve this request.',
      },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NO_APPROVER');
    expect(body.error.message).toContain('no team lead is appointed');
  });
});

describe('HR and administrators keep their override', () => {
  it('lets HR decide a request routed to a team lead', async () => {
    const amina = await signIn('amina@example.invalid');
    const helen = await signIn('helen@example.invalid');
    const id = await apply(amina, '2026-10-05', '2026-10-07');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${id}/approve`,
      headers: auth(helen),
      payload: { expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(200);
  });

  it('still refuses an ordinary employee', async () => {
    const amina = await signIn('amina@example.invalid');
    const paul = await signIn('paul@example.invalid');
    const id = await apply(amina, '2026-10-05', '2026-10-07');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${id}/approve`,
      headers: auth(paul),
      payload: { expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(403);
  });
});
