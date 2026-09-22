/**
 * Leave follows the organisation chart. Everyone's request goes to their reporting
 * manager; when there is none, or they cannot decide, it walks the ladder — team lead,
 * department head, HR, administrator. These tests drive the real API.
 *
 * The sample org (Simon & Sons): Production (head: David, reports to Rajesh the MD)
 * contains the Printing team (lead: John, member: Vijay). Ramesh (payroll) and Anitha (HR)
 * report to Rajesh. The administrator is set up by the test.
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
    const id = await apply(await signIn('vijay@sns.test'), '2026-10-05', '2026-10-07');
    expect(await approverEmailFor(id)).toBe('john@sns.test');
  });

  it('sends a team lead to their department head', async () => {
    const id = await apply(await signIn('john@sns.test'), '2026-10-12', '2026-10-13');
    expect(await approverEmailFor(id)).toBe('david@sns.test');
  });

  it('sends a department head to their reporting manager, the MD', async () => {
    const id = await apply(await signIn('david@sns.test'), '2026-10-19', '2026-10-20');
    expect(await approverEmailFor(id)).toBe('rajesh@sns.test');
  });

  it('sends a department head with no reporting manager to HR', async () => {
    await sqlite.exec(
      `UPDATE employee SET manager_employee_id = NULL WHERE work_email = 'david@sns.test'`,
    );
    const id = await apply(await signIn('david@sns.test'), '2026-10-19', '2026-10-20');
    expect(await approverEmailFor(id)).toBe('anitha@sns.test');
  });

  it('sends HR with no reporting manager to an administrator', async () => {
    await sqlite.exec(
      `UPDATE employee SET manager_employee_id = NULL WHERE work_email = 'anitha@sns.test'`,
    );
    const id = await apply(await signIn('anitha@sns.test'), '2026-10-26', '2026-10-27');
    expect(await approverEmailFor(id)).toBe('admin@example.invalid');
  });

  it('records which rung decided, so an escalation is explainable', async () => {
    const id = await apply(await signIn('vijay@sns.test'), '2026-11-02', '2026-11-03');
    const row = (await sqlite
      .prepare(`SELECT escalation_reason FROM leave_request WHERE id = ?`)
      .get(id)) as { escalation_reason: string | null };
    // Routed to the first rung, so there is nothing to explain.
    expect(row.escalation_reason).toBeNull();
  });
});

describe('the team lead can actually decide', () => {
  it('approves their own team member without company-wide rights', async () => {
    const amina = await signIn('vijay@sns.test');
    const ravi = await signIn('john@sns.test');
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
    const paul = await signIn('ramesh@sns.test');
    const ravi = await signIn('john@sns.test');
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
    const ravi = await signIn('john@sns.test');
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
  // With no reporting managers assigned, requests fall back to the ladder.
  beforeEach(async () => {
    await sqlite.exec(`UPDATE employee SET manager_employee_id = NULL`);
  });

  it('goes to the team lead when no reporting manager is assigned', async () => {
    const id = await apply(await signIn('vijay@sns.test'), '2026-10-05', '2026-10-07');
    expect(await approverEmailFor(id)).toBe('john@sns.test');
  });

  it('goes to the department head when the team has no lead', async () => {
    await sqlite.exec(`UPDATE team SET lead_employee_id = NULL WHERE name = 'Printing'`);
    const id = await apply(await signIn('vijay@sns.test'), '2026-10-05', '2026-10-07');
    expect(await approverEmailFor(id)).toBe('david@sns.test');
    const row = (await sqlite
      .prepare(`SELECT escalation_reason FROM leave_request WHERE id = ?`)
      .get(id)) as { escalation_reason: string | null };
    expect(row.escalation_reason).toBe('no_team_lead');
  });

  it('goes to HR when neither the lead nor the head is available', async () => {
    await sqlite.exec(`UPDATE team SET lead_employee_id = NULL WHERE name = 'Printing'`);
    await sqlite.exec(`UPDATE department SET head_employee_id = NULL WHERE code = 'PRD'`);
    const id = await apply(await signIn('vijay@sns.test'), '2026-10-05', '2026-10-07');
    expect(await approverEmailFor(id)).toBe('anitha@sns.test');
  });

  it('skips a lead whose account is disabled', async () => {
    await sqlite.exec(`UPDATE user_account SET is_disabled = 1 WHERE email = 'john@sns.test'`);
    const id = await apply(await signIn('vijay@sns.test'), '2026-10-05', '2026-10-07');
    expect(await approverEmailFor(id)).toBe('david@sns.test');
  });

  it('refuses clearly when nobody can approve, rather than failing obscurely', async () => {
    await sqlite.exec(`UPDATE team SET lead_employee_id = NULL`);
    await sqlite.exec(`UPDATE department SET head_employee_id = NULL`);
    await sqlite.exec(
      `UPDATE user_account SET is_disabled = 1
        WHERE id IN (SELECT ur.user_account_id FROM user_role ur
                     JOIN role r ON r.id = ur.role_id WHERE r.code IN ('hr_officer','admin'))`,
    );
    const amina = await signIn('vijay@sns.test');
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
    const amina = await signIn('vijay@sns.test');
    const helen = await signIn('anitha@sns.test');
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
    const amina = await signIn('vijay@sns.test');
    const paul = await signIn('ramesh@sns.test');
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

describe('Downstream higher-up notifications and on-behalf leave', () => {
  it('notifies Dept Head and HR when Team Lead approves leave, but notifies NO higher-up on rejection', async () => {
    const amina = await signIn('vijay@sns.test');
    const ravi = await signIn('john@sns.test');

    const sofiaUser = (await sqlite
      .prepare(`SELECT id FROM user_account WHERE email = 'david@sns.test'`)
      .get()) as { id: string };
    const helenUser = (await sqlite
      .prepare(`SELECT id FROM user_account WHERE email = 'anitha@sns.test'`)
      .get()) as { id: string };
    const aminaUser = (await sqlite
      .prepare(`SELECT id FROM user_account WHERE email = 'vijay@sns.test'`)
      .get()) as { id: string };

    // 1. Amina applies for leave
    const idApprove = await apply(amina, '2026-10-05', '2026-10-07');

    // Ravi (Team Lead) approves
    const resApprove = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${idApprove}/approve`,
      headers: auth(ravi),
      payload: { expectedVersion: 1 },
    });
    expect(resApprove.statusCode).toBe(200);

    // Amina receives leave.approved
    const aminaNotesApprove = (await sqlite
      .prepare(`SELECT kind FROM notification WHERE recipient_user_id = ? AND entity_id = ?`)
      .all(aminaUser.id, idApprove)) as { kind: string }[];
    expect(aminaNotesApprove.map((n) => n.kind)).toContain('leave.approved');

    // Sofia (Department Head) receives informational notification
    const sofiaNotes = (await sqlite
      .prepare(`SELECT kind FROM notification WHERE recipient_user_id = ? AND entity_id = ?`)
      .all(sofiaUser.id, idApprove)) as { kind: string }[];
    expect(sofiaNotes.map((n) => n.kind)).toContain('leave.approved.informational');

    // Helen (HR Officer) receives informational notification
    const helenNotes = (await sqlite
      .prepare(`SELECT kind FROM notification WHERE recipient_user_id = ? AND entity_id = ?`)
      .all(helenUser.id, idApprove)) as { kind: string }[];
    expect(helenNotes.map((n) => n.kind)).toContain('leave.approved.informational');

    // 2. Amina applies for another period, which Ravi rejects
    const idReject = await apply(amina, '2026-10-12', '2026-10-14');
    const resReject = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${idReject}/reject`,
      headers: auth(ravi),
      payload: { expectedVersion: 1, reason: 'Staffing conflict during deployment.' },
    });
    expect(resReject.statusCode).toBe(200);

    // Amina receives leave.rejected
    const aminaNotesReject = (await sqlite
      .prepare(`SELECT kind FROM notification WHERE recipient_user_id = ? AND entity_id = ?`)
      .all(aminaUser.id, idReject)) as { kind: string }[];
    expect(aminaNotesReject.map((n) => n.kind)).toContain('leave.rejected');

    // Higher-ups (Sofia and Helen) receive ZERO notifications for rejected request
    const sofiaRejectNotes = (await sqlite
      .prepare(`SELECT kind FROM notification WHERE recipient_user_id = ? AND entity_id = ?`)
      .all(sofiaUser.id, idReject)) as { kind: string }[];
    expect(sofiaRejectNotes).toHaveLength(0);

    const helenRejectNotes = (await sqlite
      .prepare(`SELECT kind FROM notification WHERE recipient_user_id = ? AND entity_id = ?`)
      .all(helenUser.id, idReject)) as { kind: string }[];
    expect(helenRejectNotes).toHaveLength(0);
  });

  it('allows Team Lead to submit sudden leave on behalf of absent team member with audit and notification', async () => {
    const ravi = await signIn('john@sns.test');
    const aminaEmp = (await sqlite
      .prepare(`SELECT id FROM employee WHERE work_email = 'vijay@sns.test'`)
      .get()) as { id: string };
    const aminaUser = (await sqlite
      .prepare(`SELECT id FROM user_account WHERE email = 'vijay@sns.test'`)
      .get()) as { id: string };

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: auth(ravi),
      payload: {
        leaveTypeId: clTypeId,
        startDate: '2026-10-19',
        endDate: '2026-10-20',
        reason: 'Amina called at 8:15 AM — emergency transit breakdown.',
        employeeId: aminaEmp.id,
      },
    });
    expect(res.statusCode).toBe(201);
    const reqId = (res.json() as { data: { id: string } }).data.id;

    // Leave request belongs to Amina, submitted by Ravi
    const reqRow = (await sqlite
      .prepare(`SELECT employee_id, submitted_by FROM leave_request WHERE id = ?`)
      .get(reqId)) as { employee_id: string; submitted_by: string };
    expect(reqRow.employee_id).toBe(aminaEmp.id);

    // Amina was notified of on-behalf submission
    const aminaNotes = (await sqlite
      .prepare(`SELECT kind, body FROM notification WHERE recipient_user_id = ? AND entity_id = ?`)
      .all(aminaUser.id, reqId)) as { kind: string; body: string }[];
    expect(aminaNotes.map((n) => n.kind)).toContain('leave.submitted_on_behalf');

    // Audit event recorded
    const auditRow = (await sqlite
      .prepare(
        `SELECT action FROM audit_event WHERE entity_id = ? AND action = 'leave.request.submitted_on_behalf'`,
      )
      .get(reqId)) as { action: string } | undefined;
    expect(auditRow).toBeDefined();

    // Ravi (Team Lead) can approve it
    const resApprove = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${reqId}/approve`,
      headers: auth(ravi),
      payload: { expectedVersion: 1 },
    });
    expect(resApprove.statusCode).toBe(200);
  });
});

describe('Office Security: Workstation Binding & Network Perimeter', () => {
  it('enforces 1:1 workstation device pairing and rejects cross-account logins in production', async () => {
    const prodApp = await buildApp(
      loadConfig({
        LEAVEOS_DATA_DIR: opened[0]!.dir,
        LEAVEOS_ENV: 'production',
        LEAVEOS_ENFORCE_WORKSTATION: 'true',
      }),
      sqlite,
    );
    await prodApp.ready();

    // 1. Amina logs in from Workstation-101 -> pairs device
    const res1 = await prodApp.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'vijay@sns.test',
        password: 'ChangeMe_demo_1',
        workstationId: 'ws-terminal-101',
      },
    });
    expect(res1.statusCode).toBe(200);

    // Binding exists in workstation_device
    const device = (await sqlite
      .prepare(`SELECT * FROM workstation_device WHERE device_fingerprint = 'ws-terminal-101'`)
      .get()) as { employee_id: string; is_active: number } | undefined;
    expect(device).toBeDefined();
    expect(device?.is_active).toBe(1);

    // 2. Paul attempts to log in on Workstation-101 in production -> 403 WORKSTATION_MISMATCH
    const resPaul = await prodApp.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'ramesh@sns.test',
        password: 'ChangeMe_demo_1',
        workstationId: 'ws-terminal-101',
      },
    });
    expect(resPaul.statusCode).toBe(403);
    const bodyPaul = resPaul.json() as { error: { code: string; message: string } };
    expect(bodyPaul.error.code).toBe('WORKSTATION_MISMATCH');

    // Violation logged to audit_event
    const auditViolation = (await sqlite
      .prepare(`SELECT * FROM audit_event WHERE action = 'auth.workstation_violation'`)
      .get()) as { action: string } | undefined;
    expect(auditViolation).toBeDefined();

    // 3. Amina logs in again on her assigned workstation -> succeeds
    const resAminaAgain = await prodApp.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'vijay@sns.test',
        password: 'ChangeMe_demo_1',
        workstationId: 'ws-terminal-101',
      },
    });
    expect(resAminaAgain.statusCode).toBe(200);
    await prodApp.close();
  });

  it('allows cross-account login on the same machine in development mode for easy testing', async () => {
    // 1. Amina logs in from Workstation-dev
    const resAmina = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'vijay@sns.test',
        password: 'ChangeMe_demo_1',
        workstationId: 'ws-terminal-dev',
      },
    });
    expect(resAmina.statusCode).toBe(200);

    // 2. Paul logs in from the same Workstation-dev in dev mode -> succeeds without 403
    const resPaul = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'ramesh@sns.test',
        password: 'ChangeMe_demo_1',
        workstationId: 'ws-terminal-dev',
      },
    });
    expect(resPaul.statusCode).toBe(200);
  });

  it('suppresses attendance signals for offsite remote IPs', async () => {
    const aminaEmp = (await sqlite
      .prepare(`SELECT id FROM employee WHERE work_email = 'vijay@sns.test'`)
      .get()) as { id: string };

    // Offsite IP login (e.g. 203.0.113.88)
    const resOffsite = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: '203.0.113.88',
      payload: {
        email: 'vijay@sns.test',
        password: 'ChangeMe_demo_1',
      },
    });
    expect(resOffsite.statusCode).toBe(200);

    // No attendance signal created in attendance_raw
    const attRow = (await sqlite
      .prepare(`SELECT * FROM attendance_raw WHERE employee_id = ? AND source = 'login'`)
      .get(aminaEmp.id)) as { id: string } | undefined;
    expect(attRow).toBeUndefined();

    // Audit logs offsite attendance suppressed
    const auditSuppressed = (await sqlite
      .prepare(`SELECT * FROM audit_event WHERE action = 'auth.offsite_attendance_suppressed'`)
      .get()) as { action: string } | undefined;
    expect(auditSuppressed).toBeDefined();
  });
});
