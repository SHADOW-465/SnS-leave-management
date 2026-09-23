/**
 * Leave types: the kinds of leave people can apply for (Annual Leave, Sick Leave…).
 *
 * A type is only a name and a code; how many days it gives and how they are counted live
 * in its policy, which is versioned on Leave configuration. Types are never deleted —
 * archiving hides one from new requests and keeps every past balance and report intact.
 */
import { withTx } from '@sns/database';
import {
  DomainError,
  LEAVE_TYPE_TEMPLATES,
  defaultRulesForCode,
  parseRules,
  type LeavePolicyRules,
} from '@sns/domain';
import { newId } from '@sns/domain';
import { authorizeAction, requirePrincipal, type RequestContext } from '../ctx.js';
import { audit } from './leave.js';
import { currentPeriodId, grantOpeningBalances } from './setup.js';

const COLOURS = [
  'accent',
  'status-approved',
  'status-pending',
  'status-neutral',
  'status-rejected',
];

function describe(rules: LeavePolicyRules, isPaid: boolean): string {
  const days = (h: number) => (Number.isInteger(h / 2) ? String(h / 2) : (h / 2).toFixed(1));
  if (rules.accrualMethod === 'none' || rules.entitlementHalfDays <= 0) {
    return isPaid
      ? 'No balance is credited automatically'
      : 'Unpaid — no balance, deducted from pay';
  }
  if (rules.accrualMethod === 'monthly') {
    return `${days(Math.round(rules.entitlementHalfDays / 12))} days credited every month (${days(rules.entitlementHalfDays)} a year)`;
  }
  return `${days(rules.entitlementHalfDays)} days at the start of each leave year`;
}

export async function listLeaveTypes(ctx: RequestContext) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'leave.policy.read', null);
  const rows = (await ctx.sqlite
    .prepare(
      `SELECT t.id, t.code, t.name, t.is_paid AS "isPaid", t.colour_token AS colour,
              t.archived_at AS "archivedAt",
              (SELECT v.rules_json FROM leave_policy_version v
                WHERE v.leave_type_id = t.id AND v.published_at IS NOT NULL
                ORDER BY v.version_no DESC LIMIT 1) AS rules,
              (SELECT COUNT(*) FROM leave_request r WHERE r.leave_type_id = t.id) AS requests,
              (SELECT COUNT(*) FROM leave_request r
                WHERE r.leave_type_id = t.id AND r.status IN ('pending_approval', 'cancellation_requested')) AS pending
         FROM leave_type t
        ORDER BY t.archived_at IS NOT NULL, t.name`,
    )
    .all()) as {
    id: string;
    code: string;
    name: string;
    isPaid: number;
    colour: string;
    archivedAt: string | null;
    rules: string | null;
    requests: number;
    pending: number;
  }[];
  return {
    types: rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      isPaid: Number(r.isPaid) === 1,
      colour: r.colour,
      archived: Boolean(r.archivedAt),
      summary: r.rules
        ? describe(parseRules(r.rules), Number(r.isPaid) === 1)
        : 'No rules published yet',
      requests: Number(r.requests),
      pending: Number(r.pending),
    })),
    templates: LEAVE_TYPE_TEMPLATES,
    colours: COLOURS,
  };
}

/**
 * Adds a leave type, starting from a template's rules (or a blank unpaid-style set). It
 * takes effect from the start of the current leave year and everyone's balance for it is
 * opened straight away, so it can be applied for immediately.
 */
export async function createLeaveType(
  ctx: RequestContext,
  input: {
    name: string;
    code: string;
    isPaid: boolean;
    template: string | null;
    colour?: string;
    rules?: Partial<LeavePolicyRules>;
  },
) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'leave.policy.manage', null);
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  if (name.length < 2)
    throw new DomainError('NAME_REQUIRED', 'Give the leave type a name.', { httpStatus: 400 });
  if (!/^[A-Z][A-Z0-9]{1,7}$/.test(code)) {
    throw new DomainError(
      'BAD_CODE',
      'The code is 2–8 letters or digits, starting with a letter, e.g. CL.',
      {
        httpStatus: 400,
      },
    );
  }
  const clash = (await ctx.sqlite
    .prepare(`SELECT code, name FROM leave_type WHERE code = ? OR LOWER(name) = LOWER(?)`)
    .get(code, name)) as { code: string; name: string } | undefined;
  if (clash) {
    throw new DomainError(
      'DUPLICATE',
      `${clash.name} (${clash.code}) already exists. Restore it instead of adding it again.`,
      {
        httpStatus: 409,
      },
    );
  }
  if (input.template && !LEAVE_TYPE_TEMPLATES.some((t) => t.code === input.template)) {
    throw new DomainError('BAD_TEMPLATE', 'Unknown template.', { httpStatus: 400 });
  }
  const rules: LeavePolicyRules = input.template
    ? defaultRulesForCode(input.template)
    : input.rules
      ? parseRules(input.rules)
      : { ...defaultRulesForCode('__blank__'), entitlementHalfDays: 0, accrualMethod: 'none' };
  if (!input.isPaid) {
    rules.negativeBalanceAllowed = true;
    rules.entitlementHalfDays = 0;
    rules.accrualMethod = 'none';
  }
  const periodId = await currentPeriodId(ctx);
  const period = (await ctx.sqlite
    .prepare(`SELECT starts_on AS "startsOn" FROM leave_period WHERE id = ?`)
    .get(periodId)) as { startsOn: string };
  const id = newId();
  const colour = COLOURS.includes(input.colour ?? '')
    ? input.colour!
    : input.isPaid
      ? 'accent'
      : 'status-neutral';
  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite
      .prepare(
        `INSERT INTO leave_type (id, code, name, colour_token, is_paid, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, code, name, colour, input.isPaid ? 1 : 0, ctx.now, p.userId, ctx.now, p.userId);
    const versionId = newId();
    await ctx.sqlite
      .prepare(
        `INSERT INTO leave_policy_version (id, leave_type_id, version_no, effective_from, rules_json, published_at, published_by, created_at, created_by)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        versionId,
        id,
        period.startsOn,
        JSON.stringify(rules),
        ctx.now,
        p.userId,
        ctx.now,
        p.userId,
      );
    await ctx.sqlite
      .prepare(
        `INSERT INTO policy_assignment (id, leave_policy_version_id, scope_type, scope_id, priority) VALUES (?, ?, 'company', 'company', 0)`,
      )
      .run(newId(), versionId);
    // Open this year's balance for everyone. Types they already have are left alone.
    const people = (await ctx.sqlite
      .prepare(`SELECT id FROM employee WHERE status != 'exited'`)
      .all()) as { id: string }[];
    for (const person of people) await grantOpeningBalances(ctx, person.id, periodId, p.userId);
    await audit(ctx, 'leave.type.created', 'leave_type', id, null, {
      code,
      name,
      isPaid: input.isPaid,
      template: input.template,
    });
  });
  return {
    id,
    message: `${name} added and open to everyone. ${describe(rules, input.isPaid)}. Adjust its rules on Leave configuration.`,
  };
}

export async function updateLeaveType(
  ctx: RequestContext,
  id: string,
  input: { name?: string; isPaid?: boolean; colour?: string },
) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'leave.policy.manage', null);
  const before = (await ctx.sqlite
    .prepare(
      `SELECT name, is_paid AS "isPaid", colour_token AS colour FROM leave_type WHERE id = ?`,
    )
    .get(id)) as { name: string; isPaid: number; colour: string } | undefined;
  if (!before) throw new DomainError('NOT_FOUND', 'Leave type not found.', { httpStatus: 404 });
  const name = input.name?.trim() ?? before.name;
  if (name.length < 2)
    throw new DomainError('NAME_REQUIRED', 'Give the leave type a name.', { httpStatus: 400 });
  if (name.toLowerCase() !== before.name.toLowerCase()) {
    const clash = await ctx.sqlite
      .prepare(`SELECT id FROM leave_type WHERE LOWER(name) = LOWER(?) AND id != ?`)
      .get(name, id);
    if (clash) throw new DomainError('DUPLICATE', `${name} already exists.`, { httpStatus: 409 });
  }
  const colour = input.colour && COLOURS.includes(input.colour) ? input.colour : before.colour;
  const isPaid = input.isPaid ?? Number(before.isPaid) === 1;
  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite
      .prepare(
        `UPDATE leave_type SET name = ?, is_paid = ?, colour_token = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
      )
      .run(name, isPaid ? 1 : 0, colour, ctx.now, p.userId, id);
    await audit(ctx, 'leave.type.updated', 'leave_type', id, before, { name, isPaid, colour });
  });
  return { ok: true, message: `${name} saved.` };
}

/**
 * Archiving stops new requests of this type. It is refused while any are still waiting
 * for a decision, so nobody's pending leave is stranded.
 */
export async function setLeaveTypeArchived(ctx: RequestContext, id: string, archived: boolean) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'leave.policy.manage', null);
  const t = (await ctx.sqlite
    .prepare(`SELECT name, archived_at AS "archivedAt" FROM leave_type WHERE id = ?`)
    .get(id)) as { name: string; archivedAt: string | null } | undefined;
  if (!t) throw new DomainError('NOT_FOUND', 'Leave type not found.', { httpStatus: 404 });
  if (archived) {
    const pending = (await ctx.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM leave_request WHERE leave_type_id = ? AND status IN ('pending_approval', 'cancellation_requested')`,
      )
      .get(id)) as { n: number };
    if (Number(pending.n) > 0) {
      throw new DomainError(
        'HAS_PENDING',
        `${Number(pending.n)} ${t.name} request(s) are still waiting for a decision. Decide them first.`,
        { httpStatus: 409 },
      );
    }
    const others = (await ctx.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM leave_type WHERE archived_at IS NULL AND id != ?`)
      .get(id)) as { n: number };
    if (Number(others.n) === 0) {
      throw new DomainError('LAST_TYPE', 'At least one leave type must stay available.', {
        httpStatus: 409,
      });
    }
  }
  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite
      .prepare(`UPDATE leave_type SET archived_at = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
      .run(archived ? ctx.now : null, ctx.now, p.userId, id);
    if (!archived) {
      const periodId = await currentPeriodId(ctx);
      const people = (await ctx.sqlite
        .prepare(`SELECT id FROM employee WHERE status != 'exited'`)
        .all()) as { id: string }[];
      for (const person of people) await grantOpeningBalances(ctx, person.id, periodId, p.userId);
    }
    await audit(
      ctx,
      archived ? 'leave.type.archived' : 'leave.type.restored',
      'leave_type',
      id,
      null,
      null,
    );
  });
  return {
    ok: true,
    message: archived
      ? `${t.name} archived. Nobody can apply for it; past leave and balances stay in every report.`
      : `${t.name} is available again.`,
  };
}
