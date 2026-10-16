import type { Db } from '@sns/database';
import {
  DEFAULT_LAN_HOSTNAME,
  lanHostnameSettingsSchema,
  type LanHostnameSettings,
} from '@sns/contracts';
import { newId } from '@sns/domain';
import { authorizeAction, type RequestContext } from './ctx.js';

const KEY = 'ops.hostname';

export async function readLanHostname(sqlite: Db): Promise<string> {
  const row = (await sqlite
    .prepare(`SELECT value_json FROM app_setting WHERE key = ?`)
    .get(KEY)) as { value_json: string } | undefined;
  if (!row) return DEFAULT_LAN_HOSTNAME;
  try {
    const parsed = lanHostnameSettingsSchema.safeParse(JSON.parse(row.value_json));
    return parsed.success ? parsed.data.hostname : DEFAULT_LAN_HOSTNAME;
  } catch {
    return DEFAULT_LAN_HOSTNAME;
  }
}

export async function writeLanHostname(
  sqlite: Db,
  hostname: string,
  actor: {
    userId: string | null;
    label: string;
    now: string;
    requestId: string;
    ip: string;
    userAgent: string;
  },
): Promise<LanHostnameSettings> {
  const settings = lanHostnameSettingsSchema.parse({ hostname });
  await sqlite
    .prepare(
      `INSERT INTO app_setting (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .run(KEY, JSON.stringify(settings), actor.userId ?? actor.label, actor.now);
  await sqlite
    .prepare(
      `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, after_json, request_id, ip, user_agent, result)
       VALUES (?, ?, ?, ?, 'ops.hostname.updated', 'app_setting', ?, ?, ?, ?, ?, 'ok')`,
    )
    .run(
      newId(),
      actor.now,
      actor.userId,
      actor.label,
      KEY,
      JSON.stringify(settings),
      actor.requestId,
      actor.ip,
      actor.userAgent,
    );
  return settings;
}

export async function saveLanHostname(
  ctx: RequestContext,
  input: LanHostnameSettings,
): Promise<LanHostnameSettings> {
  await authorizeAction(ctx, 'system.config.manage', null);
  return writeLanHostname(ctx.sqlite, input.hostname, {
    userId: ctx.principal?.userId ?? null,
    label: ctx.principal?.email ?? 'system',
    now: ctx.now,
    requestId: ctx.requestId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}
