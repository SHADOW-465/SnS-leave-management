import {
  generateTemporaryPassword,
  hashPassword,
  hashToken,
  lockUntil,
  lockoutDelayMs,
  newCsrfToken,
  newSessionToken,
  verifyPassword,
} from '@sns/auth';
import { withTx } from '@sns/database';
import { DomainError, NotAuthenticatedError, newId } from '@sns/domain';
import type { RequestContext } from '../ctx.js';
import { addHoursIso } from '../time.js';
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
export async function login(
  ctx: RequestContext,
  input: {
    email: string;
    password: string;
  },
) {
  const account = (await ctx.sqlite
    .prepare(`SELECT * FROM user_account WHERE email = ?`)
    .get(input.email)) as
    | {
        id: string;
        email: string;
        password_hash: string;
        is_disabled: number;
        failed_attempts: number;
        locked_until: string | null;
        must_change_password: number;
        employee_id: string | null;
      }
    | undefined;
  // Records the attempt and RETURNS the error, so every call site must write
  // `throw await failure(...)`. An earlier version threw inside an un-awaited async
  // helper: the rejection never propagated, so every wrong password was accepted, and
  // the unhandled rejection killed the process. Returning the error makes the throw
  // visible at the call site and lets TypeScript narrow correctly.
  const failure = async (reason: string): Promise<NotAuthenticatedError> => {
    await ctx.sqlite
      .prepare(
        `INSERT INTO login_attempt (id, email_attempted, succeeded, ip, user_agent, created_at, failure_reason)
         VALUES (?, ?, 0, ?, ?, ?, ?)`,
      )
      .run(newId(), input.email, ctx.ip, ctx.userAgent, ctx.now, reason);
    return new NotAuthenticatedError('Email or password is incorrect.');
  };
  if (!account) {
    // Same message and comparable timing as a wrong password, so the response never
    // reveals whether the address exists (SECURITY T-09).
    await sleep(250);
    throw await failure('unknown_email');
  }
  const acc = account;
  if (acc.is_disabled) {
    throw await failure('disabled');
  }
  if (acc.locked_until && acc.locked_until > ctx.now) {
    throw new DomainError(
      'ACCOUNT_LOCKED',
      'This account is locked after too many failed sign-in attempts. Try again later.',
      { httpStatus: 401 },
    );
  }
  await sleep(lockoutDelayMs(acc.failed_attempts || 1));
  const ok = await verifyPassword(acc.password_hash, input.password);
  if (!ok) {
    const attempts = acc.failed_attempts + 1;
    const until = lockUntil(attempts);
    await ctx.sqlite
      .prepare(`UPDATE user_account SET failed_attempts = ?, locked_until = ? WHERE id = ?`)
      .run(attempts, until, acc.id);
    throw await failure('bad_password');
  }
  const { token, tokenHash } = newSessionToken();
  const csrf = newCsrfToken();
  const expires = addHoursIso(ctx.now, ctx.config.sessionAbsoluteHours);
  const sessionId = newId();
  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite
      .prepare(
        `UPDATE user_account SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?`,
      )
      .run(ctx.now, acc.id);
    await ctx.sqlite
      .prepare(
        `INSERT INTO session (id, user_account_id, token_hash, csrf_token, issued_at, expires_at, last_seen_at, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(sessionId, acc.id, tokenHash, csrf, ctx.now, expires, ctx.now, ctx.ip, ctx.userAgent);
    await ctx.sqlite
      .prepare(
        `INSERT INTO login_attempt (id, email_attempted, succeeded, ip, user_agent, created_at)
         VALUES (?, ?, 1, ?, ?, ?)`,
      )
      .run(newId(), input.email, ctx.ip, ctx.userAgent, ctx.now);
    await ctx.sqlite
      .prepare(
        `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, request_id, ip, result)
         VALUES (?, ?, ?, ?, 'auth.login', 'session', ?, ?, ?, 'ok')`,
      )
      .run(newId(), ctx.now, acc.id, acc.email, sessionId, ctx.requestId, ctx.ip);
  });
  await recordLoginAttendance(ctx, acc.employee_id, acc.id);
  return {
    token,
    csrf,
    expiresAt: expires,
    mustChangePassword: Boolean(acc.must_change_password),
  };
}
async function recordLoginAttendance(
  ctx: RequestContext,
  employeeId: string | null,
  userId: string,
) {
  if (!employeeId) return;
  try {
    const existing = (await ctx.sqlite
      .prepare(
        `SELECT id FROM attendance_raw WHERE employee_id = ? AND work_date = ? AND source = 'login'`,
      )
      .get(employeeId, ctx.today)) as
      | {
          id: string;
        }
      | undefined;
    if (existing) {
      await ctx.sqlite
        .prepare(`UPDATE attendance_raw SET last_login_at = ? WHERE id = ?`)
        .run(ctx.now, existing.id);
    } else {
      await ctx.sqlite
        .prepare(
          `INSERT INTO attendance_raw (id, source, employee_id, work_date, payload_json, first_login_at, last_login_at, created_at, created_by)
           VALUES (?, 'login', ?, ?, '{}', ?, ?, ?, ?)`,
        )
        .run(newId(), employeeId, ctx.today, ctx.now, ctx.now, ctx.now, userId);
    }
  } catch {
    // A failed attendance-signal write never fails a login (F-22 / ADR 0011).
  }
}
export async function logout(ctx: RequestContext, tokenHash: string) {
  await ctx.sqlite
    .prepare(
      `UPDATE session SET revoked_at = ?, revoked_reason = 'logout' WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .run(ctx.now, tokenHash);
}
export async function resolveSession(ctx: RequestContext, token: string) {
  const tokenHash = hashToken(token);
  const row = (await ctx.sqlite
    .prepare(
      `SELECT s.*, ua.must_change_password, ua.is_disabled
       FROM session s JOIN user_account ua ON ua.id = s.user_account_id
       WHERE s.token_hash = ?`,
    )
    .get(tokenHash)) as
    | {
        id: string;
        user_account_id: string;
        csrf_token: string;
        expires_at: string;
        last_seen_at: string;
        revoked_at: string | null;
        must_change_password: number;
        is_disabled: number;
      }
    | undefined;
  if (!row || row.revoked_at || row.is_disabled) return null;
  if (row.expires_at < ctx.now) return null;
  const idleLimit = addHoursIso(row.last_seen_at, ctx.config.sessionIdleHours);
  if (idleLimit < ctx.now) {
    await ctx.sqlite
      .prepare(`UPDATE session SET revoked_at = ?, revoked_reason = 'idle' WHERE id = ?`)
      .run(ctx.now, row.id);
    return null;
  }
  await ctx.sqlite.prepare(`UPDATE session SET last_seen_at = ? WHERE id = ?`).run(ctx.now, row.id);
  return row;
}
export async function currentUserView(ctx: RequestContext) {
  const p = ctx.principal;
  if (!p) throw new NotAuthenticatedError();
  const company = (await ctx.sqlite
    .prepare(`SELECT name, timezone FROM company WHERE id = 'company'`)
    .get()) as
    | {
        name: string;
        timezone: string;
      }
    | undefined;
  const account = (await ctx.sqlite
    .prepare(`SELECT must_change_password FROM user_account WHERE id = ?`)
    .get(p.userId)) as {
    must_change_password: number;
  };
  const emp = p.employeeId
    ? ((await ctx.sqlite
        .prepare(`SELECT first_name, last_name FROM employee WHERE id = ?`)
        .get(p.employeeId)) as
        | {
            first_name: string;
            last_name: string;
          }
        | undefined)
    : undefined;
  return {
    id: p.userId,
    email: p.email,
    displayName: emp ? `${emp.first_name} ${emp.last_name}` : p.email,
    roles: p.roles,
    permissions: p.permissions,
    employeeId: p.employeeId,
    mustChangePassword: Boolean(account.must_change_password),
    companyName: company?.name ?? 'Leave OS',
    timezone: company?.timezone ?? 'UTC',
  };
}
export async function changePassword(
  ctx: RequestContext,
  input: {
    currentPassword: string;
    newPassword: string;
    currentTokenHash: string;
  },
) {
  const p = ctx.principal;
  if (!p) throw new NotAuthenticatedError();
  const account = (await ctx.sqlite
    .prepare(`SELECT password_hash FROM user_account WHERE id = ?`)
    .get(p.userId)) as {
    password_hash: string;
  };
  if (!(await verifyPassword(account.password_hash, input.currentPassword))) {
    throw new DomainError('BAD_PASSWORD', 'Current password is incorrect.', { httpStatus: 400 });
  }
  const history = (await ctx.sqlite
    .prepare(
      `SELECT password_hash FROM password_history WHERE user_account_id = ? ORDER BY created_at DESC LIMIT 5`,
    )
    .all(p.userId)) as {
    password_hash: string;
  }[];
  for (const h of history) {
    if (await verifyPassword(h.password_hash, input.newPassword)) {
      throw new DomainError('PASSWORD_REUSED', 'Choose a password you have not used recently.');
    }
  }
  const next = await hashPassword(input.newPassword);
  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite
      .prepare(
        `INSERT INTO password_history (id, user_account_id, password_hash, created_at) VALUES (?, ?, ?, ?)`,
      )
      .run(newId(), p.userId, account.password_hash, ctx.now);
    await ctx.sqlite
      .prepare(
        `UPDATE user_account SET password_hash = ?, must_change_password = 0, password_changed_at = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
      )
      .run(next, ctx.now, ctx.now, p.userId, p.userId);
    await ctx.sqlite
      .prepare(
        `UPDATE session SET revoked_at = ?, revoked_reason = 'password_change' WHERE user_account_id = ? AND revoked_at IS NULL AND token_hash != ?`,
      )
      .run(ctx.now, p.userId, input.currentTokenHash);
    await ctx.sqlite
      .prepare(
        `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, request_id, result)
         VALUES (?, ?, ?, ?, 'auth.password.changed', 'user_account', ?, ?, 'ok')`,
      )
      .run(newId(), ctx.now, p.userId, p.email, p.userId, ctx.requestId);
  });
}
export async function adminResetPassword(ctx: RequestContext, userId: string) {
  const temp = generateTemporaryPassword();
  const hash = await hashPassword(temp);
  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite
      .prepare(
        `UPDATE user_account SET password_hash = ?, must_change_password = 0, password_changed_at = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
      )
      .run(hash, ctx.now, ctx.now, ctx.principal!.userId, userId);
    await ctx.sqlite
      .prepare(
        `UPDATE session SET revoked_at = ?, revoked_reason = 'admin_reset' WHERE user_account_id = ? AND revoked_at IS NULL`,
      )
      .run(ctx.now, userId);
    await ctx.sqlite
      .prepare(
        `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, request_id, result)
         VALUES (?, ?, ?, ?, 'user.password.reset', 'user_account', ?, ?, 'ok')`,
      )
      .run(newId(), ctx.now, ctx.principal!.userId, ctx.principal!.email, userId, ctx.requestId);
  });
  return { temporaryPassword: temp };
}
export async function revokeSession(ctx: RequestContext, sessionId: string) {
  await ctx.sqlite
    .prepare(`UPDATE session SET revoked_at = ?, revoked_reason = 'revoked' WHERE id = ?`)
    .run(ctx.now, sessionId);
}
