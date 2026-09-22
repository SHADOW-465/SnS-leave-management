import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import {
  bulkHolidayBodySchema,
  createLeaveTypeBodySchema,
  updateLeaveTypeBodySchema,
  createLoginBodySchema,
  updateAccountBodySchema,
  holidayFileBodySchema,
  workWeekBodySchema,
  importHolidaysBodySchema,
  createDelegationBodySchema,
  setAllowanceBodySchema,
  ok,
  reassignRequestBodySchema,
  setApproverBodySchema,
  setDisabledBodySchema,
  assignManagerBodySchema,
  setRolesBodySchema,
} from '@sns/contracts';
import { DomainError, type RoleCode } from '@sns/domain';
import { authorizeAction } from './ctx.js';
import { sendError } from './http.js';
import { readHolidaySheet, standardHolidays } from './holiday-sheet.js';
import {
  createLeaveType,
  listLeaveTypes,
  setLeaveTypeArchived,
  updateLeaveType,
} from './usecases/leave-types.js';
import {
  approvalMap,
  createLogin,
  createDelegation,
  deleteDelegation,
  listUsers,
  reassignRequest,
  releaseWorkstations,
  revokeUserSessions,
  setAccountDisabled,
  setDepartmentHead,
  assignReportingManager,
  reportingManagerHistory,
  setTeamLead,
  setUserRoles,
  updateAccount,
} from './usecases/admin.js';
import {
  applyHolidays,
  importHolidays,
  listAllowances,
  setAllowances,
  setWorkWeek,
  workWeek,
} from './usecases/allowances.js';

/** Wraps a handler so every administrator route answers with the same envelope. */
function handle(
  fn: (req: FastifyRequest) => Promise<unknown>,
): (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
  return async (req, reply) => {
    try {
      return reply.send(ok(await fn(req), req.ctx.requestId));
    } catch (err) {
      return sendError(req, reply, err);
    }
  };
}

function body<S extends z.ZodTypeAny>(schema: S, req: FastifyRequest): z.infer<S> {
  return schema.parse(req.body) as z.infer<S>;
}

function param(req: FastifyRequest, name: string): string {
  return (req.params as Record<string, string>)[name] ?? '';
}

/**
 * Administrator controls. Authorisation happens inside each use-case (ADR 0006); these
 * handlers only translate HTTP.
 */
export async function registerAdminRoutes(app: FastifyInstance) {
  // Who approves whom
  app.get(
    '/api/v1/admin/approval-map',
    handle((req) => approvalMap(req.ctx)),
  );
  app.put(
    '/api/v1/admin/teams/:id/lead',
    handle((req) =>
      setTeamLead(req.ctx, param(req, 'id'), body(setApproverBodySchema, req).employeeId),
    ),
  );
  app.put(
    '/api/v1/admin/departments/:id/head',
    handle((req) =>
      setDepartmentHead(req.ctx, param(req, 'id'), body(setApproverBodySchema, req).employeeId),
    ),
  );
  app.put(
    '/api/v1/admin/reporting-managers',
    handle((req) => assignReportingManager(req.ctx, body(assignManagerBodySchema, req))),
  );
  app.get(
    '/api/v1/employees/:id/manager-history',
    handle((req) => reportingManagerHistory(req.ctx, param(req, 'id'))),
  );
  app.post(
    '/api/v1/admin/delegations',
    handle((req) => {
      const b = body(createDelegationBodySchema, req);
      return createDelegation(req.ctx, { ...b, note: b.note ?? null });
    }),
  );
  app.delete(
    '/api/v1/admin/delegations/:id',
    handle((req) => deleteDelegation(req.ctx, param(req, 'id'))),
  );
  app.post(
    '/api/v1/leave-requests/:id/reassign',
    handle((req) => {
      const b = body(reassignRequestBodySchema, req);
      return reassignRequest(req.ctx, param(req, 'id'), b.approverEmployeeId, b.note ?? null);
    }),
  );

  // Users and access
  app.get(
    '/api/v1/admin/users',
    handle((req) => listUsers(req.ctx)),
  );
  app.post(
    '/api/v1/admin/users',
    handle((req) => {
      const b = body(createLoginBodySchema, req);
      return createLogin(req.ctx, { ...b, roles: b.roles as RoleCode[] });
    }),
  );
  app.patch(
    '/api/v1/admin/users/:id',
    handle((req) => updateAccount(req.ctx, param(req, 'id'), body(updateAccountBodySchema, req))),
  );
  app.put(
    '/api/v1/admin/users/:id/roles',
    handle((req) =>
      setUserRoles(req.ctx, param(req, 'id'), body(setRolesBodySchema, req).roles as RoleCode[]),
    ),
  );
  app.put(
    '/api/v1/admin/users/:id/disabled',
    handle((req) =>
      setAccountDisabled(req.ctx, param(req, 'id'), body(setDisabledBodySchema, req).disabled),
    ),
  );
  app.post(
    '/api/v1/admin/users/:id/release-workstation',
    handle((req) => releaseWorkstations(req.ctx, param(req, 'id'))),
  );
  app.post(
    '/api/v1/admin/users/:id/sign-out-everywhere',
    handle((req) => revokeUserSessions(req.ctx, param(req, 'id'), req.sessionTokenHash ?? null)),
  );

  // Leave types
  app.get(
    '/api/v1/admin/leave-types',
    handle((req) => listLeaveTypes(req.ctx)),
  );
  app.post(
    '/api/v1/admin/leave-types',
    handle((req) => createLeaveType(req.ctx, body(createLeaveTypeBodySchema, req))),
  );
  app.patch(
    '/api/v1/admin/leave-types/:id',
    handle((req) =>
      updateLeaveType(req.ctx, param(req, 'id'), body(updateLeaveTypeBodySchema, req)),
    ),
  );
  app.put(
    '/api/v1/admin/leave-types/:id/archived',
    handle((req) =>
      setLeaveTypeArchived(req.ctx, param(req, 'id'), body(setDisabledBodySchema, req).disabled),
    ),
  );

  // Allowances and the calendar in bulk
  app.get(
    '/api/v1/allowances',
    handle((req) => listAllowances(req.ctx)),
  );
  app.put(
    '/api/v1/allowances',
    handle((req) => setAllowances(req.ctx, body(setAllowanceBodySchema, req))),
  );
  app.get(
    '/api/v1/settings/work-week',
    handle((req) => workWeek(req.ctx)),
  );
  app.put(
    '/api/v1/settings/work-week',
    handle((req) => setWorkWeek(req.ctx, body(workWeekBodySchema, req).weekendDays)),
  );
  app.post(
    '/api/v1/holidays/bulk',
    handle((req) => applyHolidays(req.ctx, body(bulkHolidayBodySchema, req))),
  );
  app.post(
    '/api/v1/holidays/import-file',
    handle(async (req) => {
      await authorizeAction(req.ctx, 'holiday.calendar.manage', null);
      const b = body(holidayFileBodySchema, req);
      const { rows, problems } = readHolidaySheet(Buffer.from(b.contentBase64, 'base64'));
      if (!rows.length) {
        throw new DomainError(
          'NOTHING_TO_IMPORT',
          problems[0] ?? 'No holidays were found in that file.',
          {
            httpStatus: 400,
            details: problems.slice(0, 10).map((m) => ({ path: 'file', message: m })),
          },
        );
      }
      const result = await importHolidays(req.ctx, {
        rows: rows.slice(0, 400),
        calendarId: b.calendarId,
      });
      return {
        ...result,
        problems,
        message:
          result.message + (problems.length ? ` ${problems.length} row(s) could not be read.` : ''),
      };
    }),
  );
  app.post(
    '/api/v1/holidays/load-standard',
    handle(async (req) => {
      const year = Number((req.body as { year?: unknown } | undefined)?.year);
      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        throw new DomainError('BAD_YEAR', 'Choose a year between 2000 and 2100.', {
          httpStatus: 400,
        });
      }
      const result = await importHolidays(req.ctx, { rows: standardHolidays(year) });
      return {
        ...result,
        message: `${result.message} Add festivals whose dates change each year (Pongal, Deepavali and so on) from the official list.`,
      };
    }),
  );
  app.post(
    '/api/v1/holidays/import',
    handle((req) => importHolidays(req.ctx, body(importHolidaysBodySchema, req))),
  );
  app.get('/api/v1/holidays/template.csv', async (req, reply) => {
    try {
      await authorizeAction(req.ctx, 'holiday.calendar.manage', null);
      const csv = 'date,name,kind\n2026-01-01,New Year,public\n2026-01-15,Pongal,public\n';
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="holiday-template.csv"')
        .send(csv);
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
}
