import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@sns/database';
import { loadConfig } from '@sns/config';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';

const opened: { sqlite: Db; dir: string }[] = [];

const ADMIN = { email: 'admin@example.invalid', password: 'ChangeMe_admin_1' };

async function boot(): Promise<{ app: FastifyInstance; sqlite: Db }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-att-'));
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
      adminEmail: ADMIN.email,
      adminPassword: ADMIN.password,
      loadSampleData: true,
    },
  });
  return { app, sqlite };
}

function cookiesOf(res: { headers: Record<string, unknown> }): {
  header: string;
  csrf: string;
  sid: string;
} {
  const raw = res.headers['set-cookie'];
  const header = Array.isArray(raw)
    ? raw.map((c) => c.split(';')[0]).join('; ')
    : String(raw ?? '');
  return {
    header,
    csrf: /leaveos\.csrf=([^;]*)/.exec(header)?.[1] ?? '',
    sid: /leaveos\.sid=([^;]*)/.exec(header)?.[1] ?? '',
  };
}

async function loginAs(app: FastifyInstance, creds: { email: string; password: string }) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: creds,
  });
  return cookiesOf(res);
}

afterEach(async () => {
  for (const { sqlite, dir } of opened.splice(0)) {
    try {
      await sqlite.close();
    } catch {
      // ignore
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe('Attendance signal queries, corrections, and import', () => {
  it('records a login signal automatically and lists signals with metrics', async () => {
    const { app } = await boot();
    const adminAuth = await loginAs(app, ADMIN);

    // Logging in writes a presence signal for today
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/attendance',
      headers: { cookie: adminAuth.header },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.notice).toContain('presence signals only');
    expect(body.data.rows.length).toBeGreaterThanOrEqual(1);
    expect(body.data.metrics.totalLoginSignals).toBeGreaterThanOrEqual(1);

    const firstRow = body.data.rows[0];
    expect(firstRow.source).toBe('login');
    expect(firstRow.first_login_at).toBeDefined();
  });

  it('records an immutable manual correction with reason and audit log', async () => {
    const { app, sqlite } = await boot();
    const adminAuth = await loginAs(app, ADMIN);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/attendance',
      headers: { cookie: adminAuth.header },
    });
    const rawRecord = listRes.json().data.rows[0];

    // Submit a manual correction
    const correctRes = await app.inject({
      method: 'POST',
      url: '/api/v1/attendance/corrections',
      headers: {
        cookie: adminAuth.header,
        'x-csrf-token': adminAuth.csrf,
      },
      payload: {
        attendanceRawId: rawRecord.id,
        field: 'notes',
        newValue: 'Badge swipe verified on site',
        reason: 'Badge scanner sync lag',
      },
    });
    expect(correctRes.statusCode).toBe(200);
    const correctBody = correctRes.json();
    expect(correctBody.data.field).toBe('notes');
    expect(correctBody.data.newValue).toBe('Badge swipe verified on site');
    expect(correctBody.data.reason).toBe('Badge scanner sync lag');

    // Verify raw signal table is NOT destroyed/mutated
    const checkRaw = await sqlite
      .prepare(`SELECT id, source FROM attendance_raw WHERE id = ?`)
      .get(rawRecord.id);
    expect(checkRaw).toBeDefined();

    // Verify correction row exists
    const checkCorrection = (await sqlite
      .prepare(`SELECT * FROM attendance_correction WHERE attendance_raw_id = ?`)
      .all(rawRecord.id)) as Array<{ field: string; reason: string }>;
    expect(checkCorrection.length).toBe(1);
    const firstCorr = checkCorrection[0];
    expect(firstCorr).toBeDefined();
    expect(firstCorr?.field).toBe('notes');
    expect(firstCorr?.reason).toBe('Badge scanner sync lag');

    // Verify audit log
    const checkAudit = (await sqlite
      .prepare(`SELECT * FROM audit_event WHERE action = 'attendance.corrected'`)
      .all()) as Array<{ action: string }>;
    expect(checkAudit.length).toBe(1);
  });

  it('imports external attendance signals in batch with validation', async () => {
    const { app } = await boot();
    const adminAuth = await loginAs(app, ADMIN);

    // Fetch template
    const templateRes = await app.inject({
      method: 'GET',
      url: '/api/v1/attendance/template.csv',
      headers: { cookie: adminAuth.header },
    });
    expect(templateRes.statusCode).toBe(200);
    expect(templateRes.headers['content-type']).toContain('text/csv');

    // Import batch
    const importRes = await app.inject({
      method: 'POST',
      url: '/api/v1/attendance/import',
      headers: {
        cookie: adminAuth.header,
        'x-csrf-token': adminAuth.csrf,
      },
      payload: {
        rows: [
          {
            employeeCode: 'ADM-0001',
            workDate: '2026-08-20',
            firstLoginAt: '2026-08-20T08:55:00.000Z',
            lastLoginAt: '2026-08-20T17:05:00.000Z',
            notes: 'Turnstile access log',
          },
        ],
      },
    });
    expect(importRes.statusCode).toBe(200);
    expect(importRes.json().data.importedCount).toBe(1);

    // Verify imported row shows in list
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/attendance?date=2026-08-20',
      headers: { cookie: adminAuth.header },
    });
    expect(listRes.statusCode).toBe(200);
    const rows = listRes.json().data.rows;
    expect(rows.length).toBe(1);
    expect(rows[0].source).toBe('import');
    expect(rows[0].work_date).toBe('2026-08-20');
  });
});
