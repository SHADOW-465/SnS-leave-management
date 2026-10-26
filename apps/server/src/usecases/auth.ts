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
import { requirePrincipal, type RequestContext } from '../ctx.js';
import { addHoursIso } from '../time.js';
import { uniqueUsername } from '../username.js';
import { claimDeviceForLogin } from './devices.js';
import { weekendDaysFor } from './leave.js';
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
export function isOfficeNetwork(rawIp: string | null | undefined): boolean {
  if (!rawIp) return false;
  let ip = rawIp.trim();
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.')) return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (m && m[1]) {
    const octet = parseInt(m[1], 10);
    if (octet >= 16 && octet <= 31) return true;
  }
  if (
    process.env.OFFICE_IP &&
    process.env.OFFICE_IP.split(',')
      .map((s) => s.trim())
      .includes(ip)
  ) {
    return true;
  }
  return false;
}

/** Failed sign-ins allowed in the window before the next try is refused, whatever the password. */
export const LOGIN_WINDOW_MINUTES = 15;
export const LOGIN_LIMIT_PER_IP = 20;
export const LOGIN_LIMIT_PER_NAME = 10;

/**
 * The per-account lockout only protects accounts that exist. This limits by the address the
 * attempts come from and by the name tried, so guessing across many accounts, or at a name
 * that does not exist, is slowed too.
 */
async function assertNotRateLimited(ctx: RequestContext, identifier: string): Promise<void> {
  const since = new Date(Date.parse(ctx.now) - LOGIN_WINDOW_MINUTES * 60_000).toISOString();
  const count = async (column: 'ip' | 'email_attempted', value: string | null) => {
    if (!value) return 0;
    const row = (await ctx.sqlite
      .prepare(
        column === 'ip'
          ? `SELECT COUNT(*) AS n FROM login_attempt WHERE succeeded = 0 AND created_at > ? AND ip = ?`
          : `SELECT COUNT(*) AS n FROM login_attempt WHERE succeeded = 0 AND created_at > ? AND LOWER(TRIM(email_attempted)) = LOWER(?)`,
      )
      .get(since, value)) as { n: number };
    return Number(row.n);
  };
  if (
    (await count('ip', ctx.ip || null)) >= LOGIN_LIMIT_PER_IP ||
    (await count('email_attempted', identifier)) >= LOGIN_LIMIT_PER_NAME
  ) {
    throw new DomainError(
      'LOGIN_RATE_LIMITED',
      `Too many failed sign-in attempts. Wait ${LOGIN_WINDOW_MINUTES} minutes and try again.`,
      { httpStatus: 429 },
    );
  }
}

// ponytail: in-process queue, fine for the single server process this product runs.
const signInQueue = new Map<string, Promise<unknown>>();
function oneAtATime<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (signInQueue.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => undefined);
  signInQueue.set(key, tail);
  void tail.then(() => {
    if (signInQueue.get(key) === tail) signInQueue.delete(key);
  });
  return run;
}

export async function login(
  ctx: RequestContext,
  input: {
    email: string;
    password: string;
    /** Ignored. Kept so older clients that still send it are not rejected. */
    workstationId?: string;
    deviceCookie?: string;
  },
) {
  // People sign in with username, work email, or employee ID (e.g. SNS-1001).
  const identifier = input.email.trim();
  await assertNotRateLimited(ctx, identifier);
  const account = (await ctx.sqlite
    .prepare(
      `SELECT ua.* FROM user_account ua
         LEFT JOIN employee e ON e.id = ua.employee_id
        WHERE LOWER(ua.email) = LOWER(?)
           OR LOWER(ua.username) = LOWER(?)
           OR (e.employee_code IS NOT NULL AND UPPER(e.employee_code) = UPPER(?))
        LIMIT 1`,
    )
    .get(identifier, identifier, identifier)) as
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
  // One attempt per account at a time, each reading the counter the previous one wrote.
  // Read once up front, a burst of parallel guesses all saw the same count across the
  // delay and the hash check, and the account never locked.
  await oneAtATime(acc.id, async () => {
    const fresh = (await ctx.sqlite
      .prepare(`SELECT failed_attempts, locked_until FROM user_account WHERE id = ?`)
      .get(acc.id)) as { failed_attempts: number; locked_until: string | null };
    if (fresh.locked_until && fresh.locked_until > new Date().toISOString()) {
      throw new DomainError(
        'ACCOUNT_LOCKED',
        'This account is locked after too many failed sign-in attempts. Try again later.',
        { httpStatus: 401 },
      );
    }
    await sleep(lockoutDelayMs(fresh.failed_attempts || 1));
    if (!(await verifyPassword(acc.password_hash, input.password))) {
      const attempts = Number(fresh.failed_attempts) + 1;
      await ctx.sqlite
        .prepare(`UPDATE user_account SET failed_attempts = ?, locked_until = ? WHERE id = ?`)
        .run(attempts, lockUntil(attempts), acc.id);
      throw await failure('bad_password');
    }
  });

  const device = await claimDeviceForLogin(ctx, acc, input.deviceCookie);
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
        `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, after_json, request_id, ip, result)
         VALUES (?, ?, ?, ?, 'auth.login', 'session', ?, ?, ?, ?, 'ok')`,
      )
      .run(
        newId(),
        ctx.now,
        acc.id,
        acc.email,
        sessionId,
        JSON.stringify({ deviceId: device.deviceId, ip: ctx.ip, at: ctx.now }),
        ctx.requestId,
        ctx.ip,
      );
  });
  await recordLoginAttendance(ctx, acc.employee_id, acc.id);
  return {
    token,
    csrf,
    expiresAt: expires,
    mustChangePassword: Boolean(acc.must_change_password),
    deviceCookie: device.deviceCookie,
  };
}
async function recordLoginAttendance(
  ctx: RequestContext,
  employeeId: string | null,
  userId: string,
) {
  if (!employeeId) return;
  if (!isOfficeNetwork(ctx.ip)) {
    try {
      await ctx.sqlite
        .prepare(
          `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, request_id, ip, result)
           VALUES (?, ?, ?, ?, 'auth.offsite_attendance_suppressed', 'attendance_raw', ?, ?, ?, 'suppressed')`,
        )
        .run(newId(), ctx.now, userId, `emp:${employeeId}`, employeeId, ctx.requestId, ctx.ip);
    } catch {
      // Attendance audit failure should not break login
    }
    return;
  }
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

async function recordLogoutAttendance(ctx: RequestContext, employeeId: string, at: string) {
  try {
    const existing = (await ctx.sqlite
      .prepare(
        `SELECT id, last_logout_at AS "lastLogoutAt" FROM attendance_raw
          WHERE employee_id = ? AND work_date = ? AND source = 'login'`,
      )
      .get(employeeId, ctx.today)) as { id: string; lastLogoutAt: string | null } | undefined;
    if (!existing) return;
    if (existing.lastLogoutAt && existing.lastLogoutAt > at) return;
    await ctx.sqlite
      .prepare(`UPDATE attendance_raw SET last_logout_at = ? WHERE id = ?`)
      .run(at, existing.id);
  } catch {
    // A failed attendance write never fails a sign-out.
  }
}
export async function logout(ctx: RequestContext, tokenHash: string) {
  const sess = (await ctx.sqlite
    .prepare(
      `SELECT ua.employee_id AS "employeeId"
         FROM session s
         JOIN user_account ua ON ua.id = s.user_account_id
        WHERE s.token_hash = ? AND s.revoked_at IS NULL`,
    )
    .get(tokenHash)) as { employeeId: string | null } | undefined;
  await ctx.sqlite
    .prepare(
      `UPDATE session SET revoked_at = ?, revoked_reason = 'logout' WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .run(ctx.now, tokenHash);
  if (sess?.employeeId) await recordLogoutAttendance(ctx, sess.employeeId, ctx.now);
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
    const emp = (await ctx.sqlite
      .prepare(`SELECT employee_id AS "employeeId" FROM user_account WHERE id = ?`)
      .get(row.user_account_id)) as { employeeId: string | null } | undefined;
    if (emp?.employeeId) await recordLogoutAttendance(ctx, emp.employeeId, row.last_seen_at);
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
  // Whether this person decides anyone's leave. A team lead is an ordinary employee
  // account, so the navigation cannot infer this from permissions alone.
  const pending = (await ctx.sqlite
    .prepare(
      `SELECT COUNT(*) AS n FROM approval_step_instance s
         JOIN leave_request r ON r.id = s.leave_request_id
        WHERE s.approver_user_id = ? AND s.status = 'pending' AND r.status = 'pending_approval'`,
    )
    .get(p.userId)) as { n: number };
  const approvesLeave =
    p.permissions.includes('leave.request.approve:company') ||
    Number(pending.n) > 0 ||
    (p.employeeId
      ? Boolean(
          await ctx.sqlite
            .prepare(
              `SELECT 1 FROM team WHERE lead_employee_id = ? AND archived_at IS NULL
               UNION SELECT 1 FROM department WHERE head_employee_id = ? AND archived_at IS NULL
               UNION SELECT 1 FROM employee WHERE manager_employee_id = ? AND status != 'exited'
               UNION SELECT 1 FROM approval_delegation
                 WHERE delegate_employee_id = ? AND starts_on <= ? AND ends_on >= ?
               LIMIT 1`,
            )
            .get(p.employeeId, p.employeeId, p.employeeId, p.employeeId, ctx.today, ctx.today),
        )
      : false);
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
    weekendDays: await weekendDaysFor(ctx),
    approvesLeave,
    pendingApprovals: Number(pending.n),
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
        `UPDATE user_account SET password_hash = ?, must_change_password = 0, failed_attempts = 0, locked_until = NULL, password_changed_at = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
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
async function hasRole(ctx: RequestContext, userId: string, role: string): Promise<boolean> {
  const row = await ctx.sqlite
    .prepare(
      `SELECT 1 AS x FROM user_role ur JOIN role r ON r.id = ur.role_id
        WHERE ur.user_account_id = ? AND r.code = ?`,
    )
    .get(userId, role);
  return Boolean(row);
}

/**
 * Writes a fresh random temporary password, forces a change at next sign-in, lifts any
 * lockout, and signs the account out everywhere. Returns the password for one-time display.
 */
async function issueTemporaryPassword(
  ctx: RequestContext,
  userId: string,
  audit: { action: string; actorUserId: string | null; actorLabel: string },
  chosen?: string,
): Promise<string> {
  const exists = await ctx.sqlite.prepare(`SELECT id FROM user_account WHERE id = ?`).get(userId);
  if (!exists) throw new DomainError('NOT_FOUND', 'Account not found.', { httpStatus: 404 });
  const temp = chosen ?? generateTemporaryPassword();
  const hash = await hashPassword(temp);
  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite
      .prepare(
        `UPDATE user_account SET password_hash = ?, must_change_password = 1, password_changed_at = ?,
                failed_attempts = 0, locked_until = NULL,
                updated_at = ?, updated_by = ? WHERE id = ?`,
      )
      .run(hash, ctx.now, ctx.now, audit.actorUserId ?? audit.actorLabel, userId);
    await ctx.sqlite
      .prepare(
        `UPDATE session SET revoked_at = ?, revoked_reason = 'admin_reset' WHERE user_account_id = ? AND revoked_at IS NULL`,
      )
      .run(ctx.now, userId);
    await ctx.sqlite
      .prepare(
        `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, request_id, result)
         VALUES (?, ?, ?, ?, ?, 'user_account', ?, ?, 'ok')`,
      )
      .run(
        newId(),
        ctx.now,
        audit.actorUserId,
        audit.actorLabel,
        audit.action,
        userId,
        ctx.requestId,
      );
  });
  return temp;
}

/**
 * Break-glass: only the host panel calls this, and the panel answers only to the host
 * computer itself. It resets an administrator account when nobody can sign in as one.
 */
export async function hostRecoverAdmin(
  ctx: RequestContext,
  userId: string,
): Promise<{ email: string; temporaryPassword: string }> {
  if (!(await hasRole(ctx, userId, 'admin'))) {
    throw new DomainError('NOT_ADMIN', 'That account is not an administrator.', {
      httpStatus: 400,
    });
  }
  const account = (await ctx.sqlite
    .prepare(`SELECT email FROM user_account WHERE id = ?`)
    .get(userId)) as { email: string } | undefined;
  const temporaryPassword = await issueTemporaryPassword(ctx, userId, {
    action: 'host.admin.recovered',
    actorUserId: null,
    actorLabel: 'host-panel',
  });
  // Break-glass also re-enables the account: a disabled last administrator is the case it exists for.
  await ctx.sqlite
    .prepare(`UPDATE user_account SET is_disabled = 0, disabled_reason = NULL WHERE id = ?`)
    .run(userId);
  return { email: account?.email ?? '', temporaryPassword };
}

export async function adminResetPassword(
  ctx: RequestContext,
  userId: string,
  chosen?: string,
): Promise<{ temporaryPassword?: string; generated: boolean }> {
  const p = requirePrincipal(ctx);
  if (p.userId === userId) {
    throw new DomainError(
      'USE_OWN_PASSWORD',
      'Change your own password from Profile → Change password. A reset is only for someone else who is locked out.',
      { httpStatus: 400 },
    );
  }
  // Only an administrator may reset an administrator, or HR could take over that account.
  if ((await hasRole(ctx, userId, 'admin')) && !p.roles.includes('admin')) {
    throw new DomainError(
      'FORBIDDEN',
      'Only an administrator can reset an administrator password.',
      {
        httpStatus: 403,
      },
    );
  }
  const temp = await issueTemporaryPassword(
    ctx,
    userId,
    {
      action: chosen ? 'user.password.temporary_set' : 'user.password.reset',
      actorUserId: p.userId,
      actorLabel: p.email,
    },
    chosen,
  );
  // A password the administrator typed is never sent back; only a generated one is shown once.
  return chosen ? { generated: false } : { temporaryPassword: temp, generated: true };
}

/**
 * Set a temporary password for an employee, by employee id. Replaces the existing password
 * (or the '!no-password-set' placeholder). If the employee has no sign-in yet, creates one
 * with username = lowercase employee code and the Employee role.
 */
export async function setEmployeeTemporaryPassword(
  ctx: RequestContext,
  employeeId: string,
  chosen?: string,
): Promise<{ temporaryPassword?: string; generated: boolean; created: boolean; username: string }> {
  const p = requirePrincipal(ctx);
  const emp = (await ctx.sqlite
    .prepare(`SELECT id, employee_code, work_email FROM employee WHERE id = ?`)
    .get(employeeId)) as { id: string; employee_code: string; work_email: string } | undefined;
  if (!emp) throw new DomainError('NOT_FOUND', 'Employee not found.', { httpStatus: 404 });
  const account = (await ctx.sqlite
    .prepare(`SELECT id, username, email FROM user_account WHERE employee_id = ?`)
    .get(employeeId)) as { id: string; username: string | null; email: string } | undefined;
  if (account) {
    const r = await adminResetPassword(ctx, account.id, chosen);
    return { ...r, created: false, username: account.username ?? account.email };
  }
  if (p.employeeId && p.employeeId === employeeId) {
    throw new DomainError('USE_OWN_PASSWORD', 'You cannot set your own password here.', {
      httpStatus: 400,
    });
  }
  const temp = chosen ?? generateTemporaryPassword();
  const hash = await hashPassword(temp);
  const userId = newId();
  const username = await uniqueUsername(ctx.sqlite, emp.employee_code || emp.work_email);
  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite
      .prepare(
        `INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, 'argon2id', 1, 0, ?, ?, ?, ?)`,
      )
      .run(userId, emp.id, emp.work_email, username, hash, ctx.now, p.userId, ctx.now, p.userId);
    const role = (await ctx.sqlite.prepare(`SELECT id FROM role WHERE code = 'employee'`).get()) as
      { id: string } | undefined;
    if (role) {
      await ctx.sqlite
        .prepare(
          `INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at) VALUES (?, ?, ?, ?)`,
        )
        .run(userId, role.id, p.userId, ctx.now);
    }
    await ctx.sqlite
      .prepare(
        `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, request_id, result)
         VALUES (?, ?, ?, ?, 'user.account.created_with_temporary_password', 'user_account', ?, ?, 'ok')`,
      )
      .run(newId(), ctx.now, p.userId, p.email, userId, ctx.requestId);
  });
  return chosen
    ? { generated: false, created: true, username }
    : { temporaryPassword: temp, generated: true, created: true, username };
}
export async function revokeSession(ctx: RequestContext, sessionId: string) {
  await ctx.sqlite
    .prepare(`UPDATE session SET revoked_at = ?, revoked_reason = 'revoked' WHERE id = ?`)
    .run(ctx.now, sessionId);
}
