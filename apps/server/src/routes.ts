import type { FastifyInstance } from 'fastify';
import {
  adjustBalanceBodySchema,
  bulkProvisionBodySchema,
  cancelLeaveBodySchema,
  changePasswordBodySchema,
  createDepartmentBodySchema,
  createEmployeeBodySchema,
  createTeamBodySchema,
  deactivateEmployeeBodySchema,
  decideLeaveBodySchema,
  holidayBodySchema,
  importAttendanceBodySchema,
  leaveYearBodySchema,
  loginBodySchema,
  ok,
  publishPolicyBodySchema,
  reactivateEmployeeBodySchema,
  recordAttendanceCorrectionBodySchema,
  rejectLeaveBodySchema,
  setupBodySchema,
  submitLeaveBodySchema,
  teamMembersBodySchema,
  updateDepartmentBodySchema,
  updateEmployeeBodySchema,
  updateTeamBodySchema,
} from '@sns/contracts';
import { DomainError, newId, csvSafe } from '@sns/domain';
import { hashToken } from '@sns/auth';
import { authorizeAction, requirePrincipal, type RequestContext } from './ctx.js';
import { sendError } from './http.js';
import {
  importAttendanceCsv,
  listAttendance,
  recordAttendanceCorrection,
} from './usecases/attendance.js';
import {
  adminResetPassword,
  changePassword,
  currentUserView,
  login,
  logout,
  resolveSession,
} from './usecases/auth.js';
import {
  adjustBalance,
  decideLeave,
  hrCancel,
  previewLeave,
  recalculateLeaveRequestsForDate,
  requestCancellation,
  submitLeave,
  withdrawLeave,
} from './usecases/leave.js';
import {
  archiveDepartment,
  archiveTeam,
  bulkProvision,
  createDepartment,
  createEmployee,
  createTeam,
  deactivateEmployee,
  getDepartment,
  getEmployee,
  getTeam,
  listDepartments,
  listEmployees,
  listTeams,
  manageTeamMembers,
  reactivateEmployee,
  retrieveCredentialSheet,
  updateDepartment,
  updateEmployee,
  updateTeam,
} from './usecases/people.js';
import { completeSetup, demoAccounts, setupStatus } from './usecases/setup.js';
import { runJobsTick } from './jobs.js';
import { timingSafeEqual } from 'node:crypto';
import {
  auditLog,
  availability,
  calendarMonth,
  dashboard,
  leaveTypes,
  ledger,
  listRequests,
  markNotificationsRead,
  myHome,
  notifications,
  policies,
  reports,
  requestDetail,
} from './queries.js';
import { previewLeaveEmail } from './email.js';
import { storeAttachment, safeStoredPath } from './files.js';
import { backupTo, integrityCheck, withTx } from '@sns/database';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { sha256Hex } from '@sns/auth';
import type { z } from 'zod';
declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext;
    sessionTokenHash?: string;
  }
}
function parse(schema: z.ZodTypeAny, body: unknown) {
  // Runtime parse is strict. Vercel's isolated tsc marks Zod output fields optional.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return schema.parse(body) as any;
}
export async function registerRoutes(app: FastifyInstance) {
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/api/v1/internal/cron', async (req, reply) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Not found.', requestId: String(req.id) },
      });
    }
    const header = String(req.headers.authorization ?? '');
    const prefix = 'Bearer ';
    const presented = header.startsWith(prefix) ? header.slice(prefix.length) : '';
    const a = Buffer.from(presented);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Unauthorized.', requestId: String(req.id) },
      });
    }
    await runJobsTick(req.ctx.sqlite);
    return reply.send(ok({ ok: true }, req.ctx.requestId));
  });
  app.get('/api/v1/setup/status', async (req) => ok(await setupStatus(req.ctx), req.ctx.requestId));
  app.post('/api/v1/setup', async (req, reply) => {
    try {
      const body = parse(setupBodySchema, req.body);
      const data = await completeSetup(req.ctx, body);
      return reply.send(ok(data, req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  // Development only: lists the synthetic sample accounts so every role can be signed
  // into without hunting through seed output. Returns an empty list in any other
  // environment, and only ever names accounts the seeder itself created.
  app.get('/api/v1/setup/demo-accounts', async (req, reply) => {
    try {
      return reply.send(ok(await demoAccounts(req.ctx), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/auth/login', async (req, reply) => {
    try {
      const body = parse(loginBodySchema, req.body);
      const result = await login(req.ctx, body);
      reply
        .setCookie('leaveos.sid', result.token, cookieOpts(req.ctx, true))
        .setCookie('leaveos.csrf', result.csrf, { ...cookieOpts(req.ctx, false), httpOnly: false });
      return reply.send(ok({ mustChangePassword: result.mustChangePassword }, req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/auth/logout', async (req, reply) => {
    if (req.sessionTokenHash) await logout(req.ctx, req.sessionTokenHash);
    reply.clearCookie('leaveos.sid', { path: '/' }).clearCookie('leaveos.csrf', { path: '/' });
    return reply.send(ok({ ok: true }, req.ctx.requestId));
  });
  app.get('/api/v1/me', async (req, reply) => {
    try {
      return reply.send(ok(await currentUserView(req.ctx), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/auth/password', async (req, reply) => {
    try {
      const body = parse(changePasswordBodySchema, req.body);
      await changePassword(req.ctx, {
        ...body,
        currentTokenHash: req.sessionTokenHash ?? '',
      });
      return reply.send(ok({ ok: true }, req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/home', async (req, reply) => {
    try {
      return reply.send(ok(await myHome(req.ctx), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/dashboard', async (req, reply) => {
    try {
      return reply.send(ok(await dashboard(req.ctx), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/leave-types', async (req, reply) => {
    try {
      return reply.send(ok(await leaveTypes(req.ctx), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/leave/preview', async (req, reply) => {
    try {
      const q = req.query as Record<string, string>;
      const data = await previewLeave(req.ctx, {
        leaveTypeId: q.leaveTypeId ?? '',
        startDate: q.startDate ?? '',
        endDate: q.endDate ?? '',
        halfDayStart: q.halfDayStart as 'am' | 'pm' | undefined,
        halfDayEnd: q.halfDayEnd as 'am' | 'pm' | undefined,
        employeeId: q.employeeId,
      });
      return reply.send(ok(data, req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/leave-requests', async (req, reply) => {
    try {
      const body = parse(submitLeaveBodySchema, req.body);
      const idem = req.headers['idempotency-key'];
      const data = await submitLeave(req.ctx, {
        ...body,
        idempotencyKey: typeof idem === 'string' ? idem : undefined,
      });
      return reply.status(201).send(ok(data, req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/leave-requests', async (req, reply) => {
    try {
      const q = req.query as Record<string, string>;
      return reply.send(
        ok(
          await listRequests(req.ctx, { mine: q.mine === '1', status: q.status, search: q.search }),
          req.ctx.requestId,
        ),
      );
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/leave-requests/:id', async (req, reply) => {
    try {
      const { id } = req.params as {
        id: string;
      };
      return reply.send(ok(await requestDetail(req.ctx, id), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/leave-requests/:id/approve', async (req, reply) => {
    try {
      const body = parse(decideLeaveBodySchema, req.body);
      const { id } = req.params as {
        id: string;
      };
      return reply.send(
        ok(
          await decideLeave(req.ctx, { requestId: id, decision: 'approve', ...body }),
          req.ctx.requestId,
        ),
      );
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/leave-requests/:id/reject', async (req, reply) => {
    try {
      const body = parse(rejectLeaveBodySchema, req.body);
      const { id } = req.params as {
        id: string;
      };
      return reply.send(
        ok(
          await decideLeave(req.ctx, {
            requestId: id,
            decision: 'reject',
            reason: body.reason,
            expectedVersion: body.expectedVersion,
          }),
          req.ctx.requestId,
        ),
      );
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/leave-requests/:id/withdraw', async (req, reply) => {
    try {
      const body = parse(decideLeaveBodySchema, req.body);
      const { id } = req.params as {
        id: string;
      };
      return reply.send(
        ok(await withdrawLeave(req.ctx, id, body.expectedVersion), req.ctx.requestId),
      );
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/leave-requests/:id/cancel-request', async (req, reply) => {
    try {
      const body = parse(decideLeaveBodySchema, req.body);
      const { id } = req.params as {
        id: string;
      };
      return reply.send(
        ok(await requestCancellation(req.ctx, id, body.expectedVersion), req.ctx.requestId),
      );
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/leave-requests/:id/cancel', async (req, reply) => {
    try {
      const body = parse(cancelLeaveBodySchema, req.body);
      const { id } = req.params as {
        id: string;
      };
      return reply.send(
        ok(await hrCancel(req.ctx, id, body.reason, body.expectedVersion), req.ctx.requestId),
      );
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/balances/adjust', async (req, reply) => {
    try {
      const body = parse(adjustBalanceBodySchema, req.body);
      await adjustBalance(req.ctx, body);
      return reply.send(ok({ ok: true }, req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/ledger', async (req, reply) => {
    try {
      const q = req.query as Record<string, string>;
      return reply.send(
        ok(await ledger(req.ctx, q.employeeId ?? '', q.leaveTypeId ?? ''), req.ctx.requestId),
      );
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/employees', async (req, reply) => {
    try {
      const q = req.query as Record<string, string>;
      return reply.send(ok(await listEmployees(req.ctx, q.search ?? ''), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/employees/:id', async (req, reply) => {
    try {
      const { id } = req.params as {
        id: string;
      };
      return reply.send(ok(await getEmployee(req.ctx, id), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/employees', async (req, reply) => {
    try {
      const body = parse(createEmployeeBodySchema, req.body);
      return reply.status(201).send(ok(await createEmployee(req.ctx, body), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.patch('/api/v1/employees/:id', async (req, reply) => {
    try {
      const body = parse(updateEmployeeBodySchema, req.body);
      const { id } = req.params as {
        id: string;
      };
      return reply.send(ok(await updateEmployee(req.ctx, id, body), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/employees/:id/deactivate', async (req, reply) => {
    try {
      const body = parse(deactivateEmployeeBodySchema, req.body);
      const { id } = req.params as {
        id: string;
      };
      await deactivateEmployee(req.ctx, id, body);
      return reply.send(ok({ ok: true }, req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/employees/:id/reactivate', async (req, reply) => {
    try {
      const body = parse(reactivateEmployeeBodySchema, req.body);
      const { id } = req.params as {
        id: string;
      };
      return reply.send(ok(await reactivateEmployee(req.ctx, id, body), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/accounts/provision', async (req, reply) => {
    try {
      const body = parse(bulkProvisionBodySchema, req.body);
      return reply.send(ok(await bulkProvision(req.ctx, body.employeeIds), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/accounts/sheets/:id/retrieve', async (req, reply) => {
    try {
      const { id } = req.params as {
        id: string;
      };
      return reply.send(ok(await retrieveCredentialSheet(req.ctx, id), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/accounts/:id/reset-password', async (req, reply) => {
    try {
      await authorizeAction(req.ctx, 'user.password.reset', null);
      const { id } = req.params as {
        id: string;
      };
      return reply.send(ok(await adminResetPassword(req.ctx, id), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/calendar', async (req, reply) => {
    try {
      const q = req.query as Record<string, string>;
      const year = Number(q.year);
      const month = Number(q.month);
      return reply.send(ok(await calendarMonth(req.ctx, year, month), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/holidays', async (req, reply) => {
    try {
      await authorizeAction(req.ctx, 'holiday.calendar.manage', null);
      const body = parse(holidayBodySchema, req.body);
      const calRow = body.calendarId
        ? ((await req.ctx.sqlite
            .prepare(`SELECT id FROM holiday_calendar WHERE id = ?`)
            .get(body.calendarId)) as { id: string } | undefined)
        : ((await req.ctx.sqlite
            .prepare(`SELECT id FROM holiday_calendar ORDER BY year DESC LIMIT 1`)
            .get()) as { id: string } | undefined);
      if (!calRow) {
        throw new DomainError('NO_CALENDAR', 'No holiday calendar exists yet.', {
          httpStatus: 400,
        });
      }
      const before = (await req.ctx.sqlite
        .prepare(`SELECT name, kind FROM holiday WHERE holiday_calendar_id = ? AND date = ?`)
        .get(calRow.id, body.date)) as { name: string; kind: string } | undefined;
      // One entry per date. Re-marking a day replaces it rather than adding a second
      // row, which is what made the calendar appear not to change.
      await withTx(req.ctx.sqlite, async () => {
        await req.ctx.sqlite
          .prepare(
            `INSERT INTO holiday (id, holiday_calendar_id, date, name, kind)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (holiday_calendar_id, date)
             DO UPDATE SET name = excluded.name, kind = excluded.kind`,
          )
          .run(newId(), calRow.id, body.date, body.name, body.kind);
        await auditRow(
          req.ctx,
          before ? 'holiday.updated' : 'holiday.created',
          'holiday',
          body.date,
          before,
          {
            name: body.name,
            kind: body.kind,
          },
        );
        await recalculateLeaveRequestsForDate(req.ctx, body.date, calRow.id);
      });
      return reply.send(ok({ ok: true, date: body.date, kind: body.kind }, req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.delete('/api/v1/holidays', async (req, reply) => {
    try {
      await authorizeAction(req.ctx, 'holiday.calendar.manage', null);
      const q = req.query as Record<string, string>;
      const date = q.date ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new DomainError('BAD_DATE', 'Provide a date as YYYY-MM-DD.', { httpStatus: 400 });
      }
      // Scoped to one calendar. The previous statement deleted that date from every
      // calendar in the company.
      const calRow = q.calendarId
        ? ((await req.ctx.sqlite
            .prepare(`SELECT id FROM holiday_calendar WHERE id = ?`)
            .get(q.calendarId)) as { id: string } | undefined)
        : ((await req.ctx.sqlite
            .prepare(`SELECT id FROM holiday_calendar ORDER BY year DESC LIMIT 1`)
            .get()) as { id: string } | undefined);
      if (!calRow) {
        throw new DomainError('NO_CALENDAR', 'No holiday calendar exists yet.', {
          httpStatus: 400,
        });
      }
      const before = (await req.ctx.sqlite
        .prepare(`SELECT name, kind FROM holiday WHERE holiday_calendar_id = ? AND date = ?`)
        .get(calRow.id, date)) as { name: string; kind: string } | undefined;
      if (!before) {
        return reply.send(ok({ ok: true, removed: false }, req.ctx.requestId));
      }
      await withTx(req.ctx.sqlite, async () => {
        await req.ctx.sqlite
          .prepare(`DELETE FROM holiday WHERE holiday_calendar_id = ? AND date = ?`)
          .run(calRow.id, date);
        await auditRow(req.ctx, 'holiday.removed', 'holiday', date, before, null);
        await recalculateLeaveRequestsForDate(req.ctx, date, calRow.id);
      });
      return reply.send(ok({ ok: true, removed: true }, req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/availability', async (req, reply) => {
    try {
      const q = req.query as Record<string, string>;
      return reply.send(
        ok(
          await availability(
            req.ctx,
            q.from ?? new Date().toISOString().slice(0, 10),
            Number(q.days ?? 14),
          ),
          req.ctx.requestId,
        ),
      );
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/reports', async (req, reply) => {
    try {
      return reply.send(ok(await reports(req.ctx), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/reports/export.csv', async (req, reply) => {
    try {
      await authorizeAction(req.ctx, 'report.export', null);
      const data = await reports(req.ctx);
      const lines = ['month,days', ...data.byMonth.map((m) => `${csvSafe(m.label)},${m.days}`)];
      await req.ctx.sqlite
        .prepare(
          `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, request_id, result)
           VALUES (?, ?, ?, ?, 'report.exported', 'report', ?, 'ok')`,
        )
        .run(
          newId(),
          req.ctx.now,
          req.ctx.principal?.userId ?? null,
          req.ctx.principal?.email ?? 'unknown',
          req.ctx.requestId,
        );
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="leave-report.csv"')
        .send(lines.join('\n'));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/audit', async (req, reply) => {
    try {
      const q = req.query as Record<string, string>;
      return reply.send(ok(await auditLog(req.ctx, q.search), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/notifications', async (req, reply) => {
    try {
      return reply.send(ok(await notifications(req.ctx), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/notifications/read', async (req, reply) => {
    try {
      const body = req.body as { id?: string } | undefined;
      await markNotificationsRead(req.ctx, body?.id);
      return reply.send(ok({ ok: true }, req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/policies', async (req, reply) => {
    try {
      return reply.send(ok(await policies(req.ctx), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/policies', async (req, reply) => {
    try {
      await authorizeAction(req.ctx, 'leave.policy.manage', null);
      const body = parse(publishPolicyBodySchema, req.body);
      const max = (await req.ctx.sqlite
        .prepare(
          `SELECT COALESCE(MAX(version_no), 0) AS n FROM leave_policy_version WHERE leave_type_id = ?`,
        )
        .get(body.leaveTypeId)) as {
        n: number;
      };
      const previous = (await req.ctx.sqlite
        .prepare(
          `SELECT rules_json FROM leave_policy_version
           WHERE leave_type_id = ? ORDER BY version_no DESC LIMIT 1`,
        )
        .get(body.leaveTypeId)) as { rules_json: string } | undefined;
      const versionId = newId();
      // The new version and its audit record commit together: a rule change that
      // leaves no trace of who made it is not acceptable in this system.
      await withTx(req.ctx.sqlite, async () => {
        await req.ctx.sqlite
          .prepare(
            `INSERT INTO leave_policy_version (id, leave_type_id, version_no, effective_from, rules_json, published_at, published_by, created_at, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            versionId,
            body.leaveTypeId,
            max.n + 1,
            body.effectiveFrom,
            JSON.stringify(body.rules),
            req.ctx.now,
            req.ctx.principal!.userId,
            req.ctx.now,
            req.ctx.principal!.userId,
          );
        await req.ctx.sqlite
          .prepare(
            `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, before_json, after_json, request_id, ip, user_agent, result)
             VALUES (?, ?, ?, ?, 'leave.policy.published', 'leave_policy_version', ?, ?, ?, ?, ?, ?, 'ok')`,
          )
          .run(
            newId(),
            req.ctx.now,
            req.ctx.principal!.userId,
            req.ctx.principal!.email,
            versionId,
            previous?.rules_json ?? null,
            JSON.stringify(body.rules),
            req.ctx.requestId,
            req.ctx.ip,
            req.ctx.userAgent,
          );
      });
      return reply.send(ok({ ok: true, versionNo: max.n + 1 }, req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/leave-year', async (req, reply) => {
    try {
      await authorizeAction(req.ctx, 'leave.policy.manage', null);
      const body = parse(leaveYearBodySchema, req.body);
      const before = await req.ctx.sqlite
        .prepare(`SELECT * FROM company WHERE id = 'company'`)
        .get();
      await req.ctx.sqlite
        .prepare(
          `UPDATE company SET leave_year_start_month = ?, leave_year_start_day = ?, updated_at = ?, updated_by = ? WHERE id = 'company'`,
        )
        .run(body.startMonth, body.startDay, req.ctx.now, req.ctx.principal!.userId);
      await req.ctx.sqlite
        .prepare(
          `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, before_json, after_json, request_id, result)
           VALUES (?, ?, ?, ?, 'leave.year.changed', 'company', ?, ?, ?, 'ok')`,
        )
        .run(
          newId(),
          req.ctx.now,
          req.ctx.principal!.userId,
          req.ctx.principal!.email,
          JSON.stringify(before),
          JSON.stringify(body),
          req.ctx.requestId,
        );
      return reply.send(
        ok(
          { ok: true, note: 'Existing ledger periods were not re-partitioned (DW-35).' },
          req.ctx.requestId,
        ),
      );
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/org', async (req, reply) => {
    try {
      await authorizeAction(req.ctx, 'org.structure.read', null);
      const locations = await req.ctx.sqlite.prepare(`SELECT * FROM location`).all();
      const departments = await req.ctx.sqlite
        .prepare(`SELECT * FROM department WHERE archived_at IS NULL`)
        .all();
      const teams = await req.ctx.sqlite
        .prepare(`SELECT * FROM team WHERE archived_at IS NULL`)
        .all();
      const jobTitles = await req.ctx.sqlite.prepare(`SELECT * FROM job_title`).all();
      const employmentTypes = await req.ctx.sqlite.prepare(`SELECT * FROM employment_type`).all();
      const company = await req.ctx.sqlite
        .prepare(`SELECT * FROM company WHERE id = 'company'`)
        .get();
      return reply.send(
        ok(
          { company, locations, departments, teams, jobTitles, employmentTypes },
          req.ctx.requestId,
        ),
      );
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/departments', async (req, reply) => {
    try {
      return reply.send(ok(await listDepartments(req.ctx), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/departments/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return reply.send(ok(await getDepartment(req.ctx, id), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/departments', async (req, reply) => {
    try {
      const body = parse(createDepartmentBodySchema, req.body);
      return reply.status(201).send(ok(await createDepartment(req.ctx, body), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.patch('/api/v1/departments/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const body = parse(updateDepartmentBodySchema, req.body);
      return reply.send(ok(await updateDepartment(req.ctx, id, body), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/departments/:id/archive', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return reply.send(ok(await archiveDepartment(req.ctx, id), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/teams', async (req, reply) => {
    try {
      const q = req.query as Record<string, string>;
      return reply.send(ok(await listTeams(req.ctx, q.departmentId), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/teams/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return reply.send(ok(await getTeam(req.ctx, id), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/teams', async (req, reply) => {
    try {
      const body = parse(createTeamBodySchema, req.body);
      return reply.status(201).send(ok(await createTeam(req.ctx, body), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.patch('/api/v1/teams/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const body = parse(updateTeamBodySchema, req.body);
      return reply.send(ok(await updateTeam(req.ctx, id, body), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/teams/:id/archive', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return reply.send(ok(await archiveTeam(req.ctx, id), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/teams/:id/members', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const body = parse(teamMembersBodySchema, req.body);
      return reply.send(ok(await manageTeamMembers(req.ctx, id, body), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/email/preview', async (req, reply) => {
    try {
      requirePrincipal(req.ctx);
      const sample = previewLeaveEmail({
        to: 'hr@example.invalid',
        requesterName: 'Amina Example',
        leaveType: 'Casual leave',
        dates: '12 Mar 2026 – 13 Mar 2026',
        workingDays: '2',
        link: `${req.ctx.config.publicUrl}/requests/preview`,
      });
      return reply.send(ok(sample, req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/attachments', async (req, reply) => {
    try {
      const file = await req.file();
      if (!file) throw new DomainError('NO_FILE', 'Choose a file to upload.');
      const buf = await file.toBuffer();
      const stored = storeAttachment({
        root: req.ctx.attachmentsRoot,
        originalName: file.filename,
        mimeType: file.mimetype,
        buffer: buf,
      });
      const id = newId();
      const classification = file.fields.classification
        ? String(
            (
              file.fields.classification as {
                value: string;
              }
            ).value,
          )
        : 'general';
      await req.ctx.sqlite
        .prepare(
          `INSERT INTO attachment (id, stored_name, original_name, mime_type, detected_type, size_bytes, sha256, owner_employee_id, classification, uploaded_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          stored.storedName,
          path.basename(file.filename),
          file.mimetype,
          stored.detectedType,
          stored.size,
          stored.sha256,
          req.ctx.principal?.employeeId ?? null,
          classification === 'medical' ? 'medical' : 'general',
          req.ctx.principal!.userId,
          req.ctx.now,
        );
      return reply.send(ok({ id }, req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/ops/health', async (req, reply) => {
    try {
      await authorizeAction(req.ctx, 'system.health.read', null);
      const lastBackup = (await req.ctx.sqlite
        .prepare(`SELECT * FROM backup_record ORDER BY started_at DESC LIMIT 1`)
        .get()) as
        | {
            started_at: string;
            status: string;
          }
        | undefined;
      const outbox = (await req.ctx.sqlite
        .prepare(`SELECT COUNT(*) AS n FROM outbox_message WHERE status = 'pending'`)
        .get()) as {
        n: number;
      };
      return reply.send(
        ok(
          {
            status: 'ok',
            integrity: await integrityCheck(req.ctx.sqlite),
            lastBackup,
            outboxDepth: outbox.n,
          },
          req.ctx.requestId,
        ),
      );
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/ops/backup', async (req, reply) => {
    try {
      await authorizeAction(req.ctx, 'system.backup.create', null);
      if (req.ctx.sqlite.dialect !== 'sqlite') {
        throw new Error(
          'File backup is available on the office SQLite deployment, not on the preview database.',
        );
      }
      fs.mkdirSync(req.ctx.backupsRoot, { recursive: true });
      const dest = path.join(req.ctx.backupsRoot, `backup-${Date.now()}.db`);
      await backupTo(req.ctx.sqlite, dest);
      const copy = new DatabaseSync(dest, { readOnly: true });
      const checkRow = copy.prepare('PRAGMA integrity_check').get() as {
        integrity_check: string;
      };
      const check = checkRow.integrity_check;
      copy.close();
      const buf = fs.readFileSync(dest);
      const id = newId();
      await req.ctx.sqlite
        .prepare(
          `INSERT INTO backup_record (id, path, started_at, finished_at, size_bytes, sha256, integrity_check_result, schema_version, trigger, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, '0001_init', 'manual', ?)`,
        )
        .run(
          id,
          dest,
          req.ctx.now,
          new Date().toISOString(),
          buf.length,
          sha256Hex(buf),
          String(check),
          String(check) === 'ok' ? 'ok' : 'failed',
        );
      return reply.send(ok({ id, path: dest, integrity: check }, req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/attendance', async (req, reply) => {
    try {
      const q = req.query as {
        date?: string;
        source?: string;
        departmentId?: string;
        search?: string;
      };
      const result = await listAttendance(req.ctx, q);
      return reply.send(ok(result, req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/attendance/corrections', async (req, reply) => {
    try {
      const body = recordAttendanceCorrectionBodySchema.parse(req.body);
      const result = await recordAttendanceCorrection(req.ctx, body);
      return reply.send(ok(result, req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.post('/api/v1/attendance/import', async (req, reply) => {
    try {
      const body = importAttendanceBodySchema.parse(req.body);
      const result = await importAttendanceCsv(req.ctx, body);
      return reply.send(ok(result, req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/attendance/template.csv', async (req, reply) => {
    try {
      const p = requirePrincipal(req.ctx);
      await authorizeAction(req.ctx, 'attendance.read', p.employeeId);
      const csv = [
        'employee_code,work_date,first_login_at,last_login_at,notes',
        'E-2001,2026-08-27,2026-08-27T09:00:00.000Z,2026-08-27T17:30:00.000Z,Biometric scanner export',
      ].join('\n');
      return reply.header('content-type', 'text/csv').send(csv);
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  app.get('/api/v1/import/template.csv', async (req, reply) => {
    try {
      await authorizeAction(req.ctx, 'import.run', null);
      const csv = [
        'employee_code,first_name,last_name,work_email,joined_on,department_code,manager_code',
        'E-2001,Sam,Example,sam@example.invalid,2024-03-01,GEN,',
      ].join('\n');
      return reply.header('content-type', 'text/csv').send(csv);
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
  // Attachments are looked up by database id, never by a client-supplied path, and the
  // resolved path is asserted to sit inside the attachments root (SECURITY T-06).
  app.get('/api/v1/attachments/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const row = (await req.ctx.sqlite
        .prepare(
          `SELECT stored_name, original_name, detected_type, owner_employee_id, classification
           FROM attachment WHERE id = ?`,
        )
        .get(id)) as
        | {
            stored_name: string;
            original_name: string;
            detected_type: string;
            owner_employee_id: string | null;
            classification: string;
          }
        | undefined;
      // A missing row and a forbidden row return the same thing, so the response never
      // reveals whether an attachment exists (RBAC §4).
      if (!row)
        throw new DomainError('FORBIDDEN', 'You do not have permission to view this.', {
          httpStatus: 403,
        });
      await authorizeAction(
        req.ctx,
        row.classification === 'medical' ? 'attachment.medical.read' : 'attachment.read',
        row.owner_employee_id,
      );
      const abs = safeStoredPath(req.ctx.attachmentsRoot, row.stored_name);
      if (!fs.existsSync(abs)) {
        throw new DomainError('ATTACHMENT_MISSING', 'This file is no longer on disk.', {
          httpStatus: 404,
        });
      }
      return reply
        .header('content-type', row.detected_type)
        .header('x-content-type-options', 'nosniff')
        .header(
          'content-disposition',
          `attachment; filename="${path.basename(row.original_name).replace(/"/g, '')}"`,
        )
        .send(fs.createReadStream(abs));
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
}
/** Append-only audit row for a route-level change. */
async function auditRow(
  ctx: RequestContext,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await ctx.sqlite
    .prepare(
      `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, before_json, after_json, request_id, ip, user_agent, result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok')`,
    )
    .run(
      newId(),
      ctx.now,
      ctx.principal?.userId ?? null,
      ctx.principal?.email ?? 'system',
      action,
      entityType,
      entityId,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      ctx.requestId,
      ctx.ip,
      ctx.userAgent,
    );
}
function cookieOpts(ctx: RequestContext, httpOnly: boolean) {
  return {
    httpOnly,
    sameSite: 'strict' as const,
    secure: ctx.config.cookieSecure,
    path: '/',
  };
}
export { resolveSession, hashToken };
