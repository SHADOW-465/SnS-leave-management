/**
 * The hosted preview was seeded before hierarchical approval existed: five sample
 * people, no Sofia, no Engineering org. `seedOnEmpty` will not run again. This is
 * the backfill that `ensureDemoHierarchy` has to perform on that already-bootstrapped
 * database.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashPassword } from '@sns/auth';
import { loadConfig } from '@sns/config';
import { openDatabase, type Db } from '@sns/database';
import { newId } from '@sns/domain';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';
import { nowIso, todayInTimeZone } from './time.js';
import type { RequestContext } from './ctx.js';
import {
  completeSetup,
  DEMO_PASSWORD,
  ensureDemoHierarchy,
  grantOpeningBalances,
} from './usecases/setup.js';

const opened: { sqlite: Db; dir: string }[] = [];

function ctxFor(sqlite: Db, dir: string): RequestContext {
  return {
    requestId: 'backfill',
    sqlite,
    config: loadConfig({ LEAVEOS_DATA_DIR: dir, LEAVEOS_ENV: 'test' }),
    principal: null,
    ip: '127.0.0.1',
    userAgent: 'test',
    now: nowIso(),
    today: todayInTimeZone('UTC'),
    attachmentsRoot: path.join(dir, 'attachments'),
    backupsRoot: path.join(dir, 'backups'),
  };
}

async function seedLegacySamplePeople(ctx: RequestContext): Promise<void> {
  const location = (await ctx.sqlite.prepare(`SELECT id FROM location LIMIT 1`).get()) as {
    id: string;
  };
  const dept = (await ctx.sqlite.prepare(`SELECT id FROM department WHERE code = 'GEN'`).get()) as {
    id: string;
  };
  const job = (await ctx.sqlite.prepare(`SELECT id FROM job_title LIMIT 1`).get()) as {
    id: string;
  };
  const type = (await ctx.sqlite
    .prepare(`SELECT id FROM employment_type WHERE code = 'PERM'`)
    .get()) as { id: string };
  const period = (await ctx.sqlite.prepare(`SELECT id FROM leave_period LIMIT 1`).get()) as {
    id: string;
  };
  const actor = (await ctx.sqlite.prepare(`SELECT id FROM user_account LIMIT 1`).get()) as {
    id: string;
  };
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const people: [string, string, string, string][] = [
    ['E-1001', 'Amina', 'amina@example.invalid', 'employee'],
    ['E-1002', 'Ravi', 'ravi@example.invalid', 'manager'],
    ['E-1003', 'Helen', 'helen@example.invalid', 'hr_officer'],
    ['E-1004', 'Paul', 'paul@example.invalid', 'payroll_officer'],
    ['E-1005', 'Nora', 'nora@example.invalid', 'auditor'],
  ];
  for (const [code, first, email, role] of people) {
    const empId = newId();
    const userId = newId();
    await ctx.sqlite
      .prepare(
        `INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, location_id, department_id, job_title_id, employment_type_id, retention_class, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, 'active', '2024-01-15', ?, ?, ?, ?, 'standard', ?, ?, ?, ?)`,
      )
      .run(
        empId,
        code,
        first,
        'Example',
        email,
        location.id,
        dept.id,
        job.id,
        type.id,
        ctx.now,
        actor.id,
        ctx.now,
        actor.id,
      );
    await ctx.sqlite
      .prepare(
        `INSERT INTO user_account (id, employee_id, email, password_hash, password_algo, must_change_password, is_disabled, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, 'argon2id', 0, 0, ?, ?, ?, ?)`,
      )
      .run(userId, empId, email, passwordHash, ctx.now, actor.id, ctx.now, actor.id);
    const roleRow = (await ctx.sqlite.prepare(`SELECT id FROM role WHERE code = ?`).get(role)) as {
      id: string;
    };
    await ctx.sqlite
      .prepare(
        `INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at) VALUES (?, ?, ?, ?)`,
      )
      .run(userId, roleRow.id, actor.id, ctx.now);
    await grantOpeningBalances(ctx, empId, period.id, actor.id);
  }
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

describe('ensureDemoHierarchy backfills a pre-hierarchy preview database', () => {
  async function bootLegacy(): Promise<{
    app: FastifyInstance;
    sqlite: Db;
    ctx: RequestContext;
  }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-backfill-'));
    const sqlite = await openDatabase(path.join(dir, 'app.db'));
    opened.push({ sqlite, dir });
    const ctx = ctxFor(sqlite, dir);
    await completeSetup(ctx, {
      companyName: 'Test Co',
      timezone: 'UTC',
      leaveYearStartMonth: 1,
      leaveYearStartDay: 1,
      adminName: 'Ada Example',
      adminEmail: 'admin@example.invalid',
      adminPassword: 'ChangeMe_admin_1',
      loadSampleData: false,
    });
    await seedLegacySamplePeople(ctx);
    const app = await buildApp(ctx.config, sqlite);
    await app.ready();
    return { app, sqlite, ctx };
  }

  it('adds Sofia, seats Amina under Ravi, and can be run twice', async () => {
    const { app, sqlite, ctx } = await bootLegacy();
    const before = (await sqlite
      .prepare(`SELECT email FROM user_account WHERE email = 'sofia@example.invalid'`)
      .get()) as { email: string } | undefined;
    expect(before).toBeUndefined();

    await ensureDemoHierarchy(ctx);
    await ensureDemoHierarchy(ctx);

    const sofias = (await sqlite
      .prepare(`SELECT COUNT(*) AS n FROM user_account WHERE email = 'sofia@example.invalid'`)
      .get()) as { n: number };
    expect(sofias.n).toBe(1);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'sofia@example.invalid', password: DEMO_PASSWORD },
    });
    expect(login.statusCode).toBe(200);

    const amina = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'amina@example.invalid', password: DEMO_PASSWORD },
    });
    expect(amina.statusCode).toBe(200);
    const cookie = Array.isArray(amina.headers['set-cookie'])
      ? amina.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ')
      : String(amina.headers['set-cookie'] ?? '');
    const csrf = /leaveos\.csrf=([^;]*)/.exec(cookie)?.[1] ?? '';
    const cl = (await sqlite.prepare(`SELECT id FROM leave_type WHERE code = 'CL'`).get()) as {
      id: string;
    };
    const applied = await app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: {
        leaveTypeId: cl.id,
        startDate: '2026-10-05',
        endDate: '2026-10-07',
        reason: 'Proving the backfilled hierarchy routes to the team lead.',
      },
    });
    expect(applied.statusCode).toBe(201);
    const requestId = (applied.json() as { data: { id: string } }).data.id;
    const approver = (await sqlite
      .prepare(
        `SELECT ua.email AS email FROM approval_step_instance s
           JOIN user_account ua ON ua.id = s.approver_user_id
          WHERE s.leave_request_id = ?`,
      )
      .get(requestId)) as { email: string };
    expect(approver.email).toBe('ravi@example.invalid');
    await app.close();
  });
});
