/**
 * Functional framework gaps: monthly payroll columns, earned-leave monthly accrual,
 * and employee mobile on the directory.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@sns/database';
import { loadConfig } from '@sns/config';
import { defaultRulesForCode } from '@sns/domain';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';

const opened: { sqlite: Db; dir: string }[] = [];

async function boot(): Promise<{ app: FastifyInstance; sqlite: Db }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-fw-'));
  const sqlite = await openDatabase(path.join(dir, 'app.db'));
  opened.push({ sqlite, dir });
  const app = await buildApp(loadConfig({ LEAVEOS_DATA_DIR: dir, LEAVEOS_ENV: 'test' }), sqlite);
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
  return { app, sqlite };
}

function sessionFrom(res: { headers: Record<string, unknown> }) {
  const raw = res.headers['set-cookie'];
  const cookie = Array.isArray(raw)
    ? raw.map((c) => c.split(';')[0]).join('; ')
    : String(raw ?? '');
  return { cookie, csrf: /leaveos\.csrf=([^;]*)/.exec(cookie)?.[1] ?? '' };
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

describe('functional framework', () => {
  it('defaults earned leave to 24 days credited monthly', () => {
    const el = defaultRulesForCode('EL');
    expect(el.entitlementHalfDays).toBe(48);
    expect(el.accrualMethod).toBe('monthly');
  });

  it('credits monthly earned leave as ACCRUAL, not a January lump sum', async () => {
    const { app, sqlite } = await boot();
    const amina = (await sqlite
      .prepare(`SELECT id FROM employee WHERE work_email = 'amina@example.invalid'`)
      .get()) as { id: string };
    const el = (await sqlite.prepare(`SELECT id FROM leave_type WHERE code = 'EL'`).get()) as {
      id: string;
    };
    const grants = (await sqlite
      .prepare(
        `SELECT entry_type AS type, COUNT(*) AS n FROM balance_ledger
         WHERE employee_id = ? AND leave_type_id = ?
         GROUP BY entry_type`,
      )
      .all(amina.id, el.id)) as { type: string; n: number }[];
    expect(grants.find((g) => g.type === 'ENTITLEMENT_GRANT')).toBeUndefined();
    expect(grants.find((g) => g.type === 'ACCRUAL')?.n).toBeGreaterThan(0);
    await app.close();
  });

  it('returns payroll opening/earned/used/pending/closing for a month', async () => {
    const { app } = await boot();
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@example.invalid', password: 'ChangeMe_admin_1' },
    });
    const s = sessionFrom(login);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports?year=2026&month=1',
      headers: { cookie: s.cookie },
    });
    expect(res.statusCode).toBe(200);
    const payroll = (
      res.json() as {
        data: {
          payroll: {
            label: string;
            rows: { employeeCode: string; opening: number; earned: number; closing: number }[];
          };
        };
      }
    ).data.payroll;
    expect(payroll.label).toMatch(/January/);
    const amina = payroll.rows.find(
      (r) => r.employeeCode === 'E-1001' || r.employeeCode.startsWith('E-'),
    );
    expect(amina).toBeDefined();
    expect(amina!.closing).toBe(amina!.opening + amina!.earned);
    await app.close();
  });

  it('stores a mobile number on a new employee', async () => {
    const { app } = await boot();
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@example.invalid', password: 'ChangeMe_admin_1' },
    });
    const s = sessionFrom(login);
    const org = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/org',
        headers: { cookie: s.cookie },
      })
    ).json().data as {
      locations: { id: string }[];
      departments: { id: string }[];
      jobTitles: { id: string }[];
      employmentTypes: { id: string }[];
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/employees',
      headers: { cookie: s.cookie, 'x-csrf-token': s.csrf },
      payload: {
        employeeCode: 'EMP-TEL',
        firstName: 'Vijay',
        lastName: 'Example',
        workEmail: 'vijay@example.invalid',
        joinedOn: '2026-01-15',
        locationId: org.locations[0]!.id,
        departmentId: org.departments[0]!.id,
        jobTitleId: org.jobTitles[0]!.id,
        employmentTypeId: org.employmentTypes[0]!.id,
        phone: '9876543210',
        createAccount: false,
      },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;
    const got = await app.inject({
      method: 'GET',
      url: `/api/v1/employees/${id}`,
      headers: { cookie: s.cookie },
    });
    expect((got.json() as { data: { phone: string } }).data.phone).toBe('9876543210');
    await app.close();
  });
});
