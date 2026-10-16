import { deviceBindingSettingsSchema, type DeviceBindingSettings } from '@sns/contracts';
import { DomainError, newId } from '@sns/domain';
import { authorizeAction, requirePrincipal, type RequestContext } from '../ctx.js';
import { loadDeviceSecret, normalizeIp, openDeviceCookie, sealDeviceId } from '../device-cookie.js';

export class DeviceAccessError extends DomainError {
  readonly deviceCookie: string | null;
  constructor(code: string, message: string, deviceCookie: string | null) {
    super(code, message, { httpStatus: 403 });
    this.name = 'DeviceAccessError';
    this.deviceCookie = deviceCookie;
  }
}

type DeviceRow = {
  id: string;
  status: 'pending' | 'approved' | 'revoked';
  user_account_id: string | null;
  employee_id: string | null;
  label: string | null;
  lan_ip: string | null;
  user_agent: string | null;
  last_seen_at: string | null;
  last_login_at: string | null;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
  revoked_at: string | null;
};

export async function readDevicePolicy(ctx: RequestContext): Promise<DeviceBindingSettings> {
  const defaults: DeviceBindingSettings = {
    enabled: ctx.config.enforceWorkstationBinding,
    requireApproval: ctx.config.deviceRequireApproval,
    ipMatch: ctx.config.deviceIpMatch,
  };
  const row = (await ctx.sqlite
    .prepare(`SELECT value_json FROM app_setting WHERE key = 'security.device_binding'`)
    .get()) as { value_json: string } | undefined;
  if (!row) return defaults;
  try {
    const parsed = deviceBindingSettingsSchema.partial().safeParse(JSON.parse(row.value_json));
    if (!parsed.success) return defaults;
    return { ...defaults, ...parsed.data };
  } catch {
    return defaults;
  }
}

export async function saveDevicePolicy(ctx: RequestContext, input: DeviceBindingSettings) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'workstation.manage', null);
  const settings = deviceBindingSettingsSchema.parse(input);
  await ctx.sqlite
    .prepare(
      `INSERT INTO app_setting (key, value_json, updated_by, updated_at) VALUES ('security.device_binding', ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .run(JSON.stringify(settings), ctx.principal?.userId ?? 'system', ctx.now);
  await audit(
    ctx,
    'security.device_binding.updated',
    'app_setting',
    'security.device_binding',
    settings,
  );
  return settings;
}

/**
 * Identifies the browser, records it, and enforces binding.
 * A new browser always receives a signed cookie. When approval is required, the first
 * sign-in creates a pending row and does not open a session.
 */
export async function claimDeviceForLogin(
  ctx: RequestContext,
  account: { id: string; email: string; employee_id: string | null },
  cookieValue: string | undefined,
): Promise<{ deviceId: string; deviceCookie: string | null }> {
  const policy = await readDevicePolicy(ctx);
  const secret = loadDeviceSecret(ctx.config.dataDir);
  let deviceId = openDeviceCookie(cookieValue, secret);
  let deviceCookie: string | null = null;
  if (!deviceId) {
    deviceId = newId();
    deviceCookie = sealDeviceId(deviceId, secret);
  }
  const ip = normalizeIp(ctx.ip);
  let row = (await ctx.sqlite
    .prepare(`SELECT * FROM browser_device WHERE id = ?`)
    .get(deviceId)) as DeviceRow | undefined;

  if (!policy.enabled) {
    if (!row) {
      await insertDevice(ctx, {
        id: deviceId,
        status: 'pending',
        userId: account.id,
        employeeId: account.employee_id,
        ip,
      });
    } else {
      await touch(ctx, deviceId, ip, false);
    }
    return { deviceId, deviceCookie };
  }

  if (row?.status === 'revoked') {
    await ctx.sqlite
      .prepare(
        `UPDATE browser_device
            SET status = 'pending', user_account_id = ?, employee_id = ?, lan_ip = ?,
                revoked_at = NULL, approved_at = NULL, approved_by = NULL,
                label = ?, user_agent = ?
          WHERE id = ?`,
      )
      .run(
        account.id,
        account.employee_id,
        ip,
        labelFrom(ctx),
        ctx.userAgent.slice(0, 200),
        deviceId,
      );
    row = {
      ...row,
      status: 'pending',
      user_account_id: account.id,
      employee_id: account.employee_id,
      lan_ip: ip,
    };
  }

  if (row?.status === 'approved' && row.user_account_id && row.user_account_id !== account.id) {
    await deny(ctx, account, row.id, 'auth.device_violation', ip, 'DEVICE_BOUND', deviceCookie);
  }
  if (row?.status === 'pending' && row.user_account_id && row.user_account_id !== account.id) {
    await deny(ctx, account, row.id, 'auth.device_violation', ip, 'DEVICE_BOUND', deviceCookie);
  }
  if (row?.status === 'approved' && policy.ipMatch && row.lan_ip && row.lan_ip !== ip) {
    await deny(
      ctx,
      account,
      row.id,
      'auth.device_ip_mismatch',
      ip,
      'DEVICE_IP_MISMATCH',
      deviceCookie,
    );
  }

  const other = (await ctx.sqlite
    .prepare(
      `SELECT id FROM browser_device
        WHERE user_account_id = ? AND status = 'approved' AND id != ?`,
    )
    .get(account.id, deviceId)) as { id: string } | undefined;
  if (other && row?.status !== 'approved') {
    if (!row) {
      await insertDevice(ctx, {
        id: deviceId,
        status: 'pending',
        userId: account.id,
        employeeId: account.employee_id,
        ip,
      });
    }
    await deny(ctx, account, other.id, 'auth.device_mismatch', ip, 'DEVICE_BOUND', deviceCookie);
  }

  if (!row) {
    const status = policy.requireApproval ? 'pending' : 'approved';
    await insertDevice(ctx, {
      id: deviceId,
      status,
      userId: account.id,
      employeeId: account.employee_id,
      ip,
      approved: status === 'approved',
    });
    row = (await ctx.sqlite
      .prepare(`SELECT * FROM browser_device WHERE id = ?`)
      .get(deviceId)) as DeviceRow;
    if (status === 'pending') {
      await notifyAdmins(
        ctx,
        'Browser waiting for approval',
        `${account.email} signed in from a new browser (${ip}). Approve it under Devices before it is bound.`,
        deviceId,
      );
      await audit(ctx, 'auth.device_pending', 'browser_device', deviceId, {
        email: account.email,
        ip,
        at: ctx.now,
      });
    }
  }

  if (row.status === 'pending' && !policy.requireApproval) {
    await ctx.sqlite
      .prepare(
        `UPDATE browser_device SET status = 'approved', approved_at = ?, approved_by = ?, lan_ip = COALESCE(lan_ip, ?) WHERE id = ?`,
      )
      .run(ctx.now, account.id, ip, deviceId);
    row = { ...row, status: 'approved' };
  }

  if (
    row.status === 'pending' &&
    policy.requireApproval &&
    !(await isAdminAccount(ctx, account.id))
  ) {
    await touch(ctx, deviceId, ip, false);
    throw new DeviceAccessError(
      'DEVICE_PENDING_APPROVAL',
      'This browser is waiting for an administrator to approve it.',
      deviceCookie,
    );
  }

  await touch(ctx, deviceId, ip, true);
  return { deviceId, deviceCookie };
}

export async function listDevices(ctx: RequestContext) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'workstation.manage', null);
  const devices = (await ctx.sqlite
    .prepare(
      `SELECT b.id, b.status, b.user_account_id AS "userAccountId", b.employee_id AS "employeeId",
              b.label, b.lan_ip AS "lanIp", b.user_agent AS "userAgent",
              b.last_seen_at AS "lastSeenAt", b.last_login_at AS "lastLoginAt",
              b.created_at AS "createdAt", b.approved_at AS "approvedAt",
              ua.email AS "userEmail",
              TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')) AS "userName"
         FROM browser_device b
         LEFT JOIN user_account ua ON ua.id = b.user_account_id
         LEFT JOIN employee e ON e.id = COALESCE(b.employee_id, ua.employee_id)
        ORDER BY CASE b.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, b.created_at DESC`,
    )
    .all()) as Record<string, unknown>[];
  return { devices, settings: await readDevicePolicy(ctx) };
}

export async function approveDevice(ctx: RequestContext, deviceId: string, actorLabel?: string) {
  const actor = actorLabel ? null : requirePrincipal(ctx);
  if (!actorLabel) await authorizeAction(ctx, 'workstation.manage', null);
  const row = await mustDevice(ctx, deviceId);
  if (!row.user_account_id) {
    throw new DomainError('DEVICE_UNCLAIMED', 'Nobody has signed in from this browser yet.');
  }
  if (row.status === 'approved' && row.user_account_id) {
    return { ok: true, message: 'This browser is already approved.' };
  }
  await ctx.sqlite
    .prepare(
      `UPDATE browser_device
          SET status = 'approved', approved_at = ?, approved_by = ?, revoked_at = NULL, lan_ip = COALESCE(lan_ip, ?)
        WHERE id = ?`,
    )
    .run(ctx.now, actor?.userId ?? 'host-panel', normalizeIp(ctx.ip) || row.lan_ip, deviceId);
  await audit(ctx, 'device.approved', 'browser_device', deviceId, {
    userAccountId: row.user_account_id,
    by: actorLabel ?? actor?.email,
  });
  return { ok: true, message: 'Browser approved and bound to that person.' };
}

export async function revokeDevice(ctx: RequestContext, deviceId: string, actorLabel?: string) {
  const actor = actorLabel ? null : requirePrincipal(ctx);
  if (!actorLabel) await authorizeAction(ctx, 'workstation.manage', null);
  await mustDevice(ctx, deviceId);
  await ctx.sqlite
    .prepare(
      `UPDATE browser_device SET status = 'revoked', revoked_at = ?, approved_at = NULL, approved_by = NULL WHERE id = ?`,
    )
    .run(ctx.now, deviceId);
  await audit(ctx, 'device.revoked', 'browser_device', deviceId, {
    by: actorLabel ?? actor?.email,
  });
  return {
    ok: true,
    message: 'Browser revoked. The next sign-in from it asks for approval again.',
  };
}

export async function rebindDevice(
  ctx: RequestContext,
  deviceId: string,
  userId: string,
  actorLabel?: string,
) {
  const actor = actorLabel ? null : requirePrincipal(ctx);
  if (!actorLabel) await authorizeAction(ctx, 'workstation.manage', null);
  await mustDevice(ctx, deviceId);
  const user = (await ctx.sqlite
    .prepare(`SELECT id, email, employee_id FROM user_account WHERE id = ?`)
    .get(userId)) as { id: string; email: string; employee_id: string | null } | undefined;
  if (!user) throw new DomainError('NOT_FOUND', 'Account not found.', { httpStatus: 404 });
  await ctx.sqlite
    .prepare(
      `UPDATE browser_device
          SET status = 'approved', user_account_id = ?, employee_id = ?,
              approved_at = ?, approved_by = ?, revoked_at = NULL
        WHERE id = ?`,
    )
    .run(user.id, user.employee_id, ctx.now, actor?.userId ?? 'host-panel', deviceId);
  await audit(ctx, 'device.rebound', 'browser_device', deviceId, {
    userAccountId: user.id,
    email: user.email,
    by: actorLabel ?? actor?.email,
  });
  return { ok: true, message: `Browser bound to ${user.email}.` };
}

async function mustDevice(ctx: RequestContext, id: string): Promise<DeviceRow> {
  const row = (await ctx.sqlite.prepare(`SELECT * FROM browser_device WHERE id = ?`).get(id)) as
    DeviceRow | undefined;
  if (!row) throw new DomainError('NOT_FOUND', 'Browser not found.', { httpStatus: 404 });
  return row;
}

async function insertDevice(
  ctx: RequestContext,
  input: {
    id: string;
    status: 'pending' | 'approved';
    userId: string;
    employeeId: string | null;
    ip: string;
    approved?: boolean;
  },
) {
  await ctx.sqlite
    .prepare(
      `INSERT INTO browser_device (
         id, status, user_account_id, employee_id, label, lan_ip, user_agent,
         last_seen_at, last_login_at, created_at, approved_at, approved_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.status,
      input.userId,
      input.employeeId,
      labelFrom(ctx),
      input.ip,
      ctx.userAgent.slice(0, 200),
      ctx.now,
      input.approved ? ctx.now : null,
      ctx.now,
      input.approved ? ctx.now : null,
      input.approved ? input.userId : null,
    );
}

async function touch(ctx: RequestContext, id: string, ip: string, loggedIn: boolean) {
  if (loggedIn) {
    await ctx.sqlite
      .prepare(
        `UPDATE browser_device SET last_seen_at = ?, last_login_at = ?, lan_ip = COALESCE(lan_ip, ?), user_agent = ? WHERE id = ?`,
      )
      .run(ctx.now, ctx.now, ip, ctx.userAgent.slice(0, 200), id);
  } else {
    await ctx.sqlite
      .prepare(`UPDATE browser_device SET last_seen_at = ?, user_agent = ? WHERE id = ?`)
      .run(ctx.now, ctx.userAgent.slice(0, 200), id);
  }
}

async function deny(
  ctx: RequestContext,
  account: { id: string; email: string },
  deviceId: string,
  action: string,
  ip: string,
  code: 'DEVICE_BOUND' | 'DEVICE_IP_MISMATCH',
  deviceCookie: string | null,
): Promise<never> {
  await audit(ctx, action, 'browser_device', deviceId, {
    email: account.email,
    userAccountId: account.id,
    ip,
    at: ctx.now,
  });
  const message =
    code === 'DEVICE_IP_MISMATCH'
      ? 'This browser is approved for a different network address. An administrator has been told.'
      : 'This browser is bound to someone else, or you already have a bound browser. An administrator has been told.';
  await notifyAdmins(
    ctx,
    'Blocked sign-in on a bound browser',
    `${account.email} was blocked at ${ctx.now} from ${ip || 'an unknown address'}. ${message}`,
    deviceId,
  );
  throw new DeviceAccessError(code, message, deviceCookie);
}

async function notifyAdmins(ctx: RequestContext, title: string, body: string, deviceId: string) {
  const admins = (await ctx.sqlite
    .prepare(
      `SELECT ua.id FROM user_account ua
         JOIN user_role ur ON ur.user_account_id = ua.id
         JOIN role r ON r.id = ur.role_id
        WHERE r.code = 'admin' AND ua.is_disabled = 0`,
    )
    .all()) as { id: string }[];
  for (const admin of admins) {
    await ctx.sqlite
      .prepare(
        `INSERT INTO notification (id, recipient_user_id, kind, title, body, entity_type, entity_id, created_at)
         VALUES (?, ?, 'device.binding', ?, ?, 'browser_device', ?, ?)`,
      )
      .run(newId(), admin.id, title, body, deviceId, ctx.now);
  }
}

async function audit(
  ctx: RequestContext,
  action: string,
  entityId: string,
  detail: unknown,
): Promise<void>;
async function audit(
  ctx: RequestContext,
  action: string,
  entityType: string,
  entityId: string,
  detail: unknown,
): Promise<void>;
async function audit(
  ctx: RequestContext,
  action: string,
  entityTypeOrId: string,
  entityIdOrDetail: unknown,
  detail?: unknown,
) {
  const entityType = detail === undefined ? 'browser_device' : entityTypeOrId;
  const entityId = detail === undefined ? entityTypeOrId : String(entityIdOrDetail);
  const after = detail === undefined ? entityIdOrDetail : detail;
  await ctx.sqlite
    .prepare(
      `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, after_json, request_id, ip, user_agent, result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok')`,
    )
    .run(
      newId(),
      ctx.now,
      ctx.principal?.userId ?? null,
      ctx.principal?.email ?? 'sign-in',
      action,
      entityType,
      entityId,
      JSON.stringify(after),
      ctx.requestId,
      ctx.ip,
      ctx.userAgent,
    );
}

async function isAdminAccount(ctx: RequestContext, userId: string): Promise<boolean> {
  const row = (await ctx.sqlite
    .prepare(
      `SELECT 1 AS n FROM user_role ur
         JOIN role r ON r.id = ur.role_id
        WHERE ur.user_account_id = ? AND r.code = 'admin'`,
    )
    .get(userId)) as { n: number } | undefined;
  return Boolean(row);
}

function labelFrom(ctx: RequestContext): string {
  const ua = ctx.userAgent.trim();
  return ua ? ua.slice(0, 100) : 'Office browser';
}
