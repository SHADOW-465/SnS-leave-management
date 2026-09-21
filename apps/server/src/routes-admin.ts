import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import {
  bulkHolidayBodySchema,
  importHolidaysBodySchema,
  createDelegationBodySchema,
  setAllowanceBodySchema,
  ok,
  reassignRequestBodySchema,
  setApproverBodySchema,
  setDisabledBodySchema,
  setOverrideBodySchema,
  setRolesBodySchema,
} from '@sns/contracts';
import type { RoleCode } from '@sns/domain';
import { authorizeAction } from './ctx.js';
import { sendError } from './http.js';
import {
  approvalMap,
  createDelegation,
  deleteDelegation,
  listUsers,
  reassignRequest,
  releaseWorkstations,
  revokeUserSessions,
  setAccountDisabled,
  setDepartmentHead,
  setOverride,
  setTeamLead,
  setUserRoles,
} from './usecases/admin.js';
import {
  applyHolidays,
  importHolidays,
  listAllowances,
  setAllowances,
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
    '/api/v1/admin/overrides/:employeeId',
    handle((req) => {
      const b = body(setOverrideBodySchema, req);
      return setOverride(req.ctx, param(req, 'employeeId'), b.approverEmployeeId, b.note ?? null);
    }),
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

  // Allowances and the calendar in bulk
  app.get(
    '/api/v1/allowances',
    handle((req) => listAllowances(req.ctx)),
  );
  app.put(
    '/api/v1/allowances',
    handle((req) => setAllowances(req.ctx, body(setAllowanceBodySchema, req))),
  );
  app.post(
    '/api/v1/holidays/bulk',
    handle((req) => applyHolidays(req.ctx, body(bulkHolidayBodySchema, req))),
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
