import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  newId,
  parsePermission,
  type RoleCode,
} from '@sns/domain';
import type { Db } from './open.js';

export async function seedSystem(sqlite: Db, actor = 'system'): Promise<void> {
  const now = new Date().toISOString();
  const insertRole = sqlite.prepare(
    `INSERT OR IGNORE INTO role (id, code, name, is_system) VALUES (@id, @code, @name, 1)`,
  );
  const insertPerm = sqlite.prepare(
    `INSERT OR IGNORE INTO permission (id, code, resource, action, scope, description)
     VALUES (@id, @code, @resource, @action, @scope, @description)`,
  );
  const insertRp = sqlite.prepare(
    `INSERT OR IGNORE INTO role_permission (role_id, permission_id) VALUES (?, ?)`,
  );

  const roleIds = new Map<RoleCode, string>();
  for (const r of SYSTEM_ROLES) {
    const existing = (await sqlite.prepare('SELECT id FROM role WHERE code = ?').get(r.code)) as
      { id: string } | undefined;
    const id = existing?.id ?? newId();
    await insertRole.run({ id, code: r.code, name: r.name });
    roleIds.set(r.code, id);
  }

  const permIds = new Map<string, string>();
  for (const code of PERMISSIONS) {
    const existing = (await sqlite
      .prepare('SELECT id FROM permission WHERE code = ?')
      .get(code)) as { id: string } | undefined;
    const id = existing?.id ?? newId();
    const p = parsePermission(code);
    await insertPerm.run({
      id,
      code,
      resource: p.resource,
      action: p.action,
      scope: p.scope,
      description: code,
    });
    permIds.set(code, id);
  }

  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS) as [RoleCode, readonly string[]][]) {
    const rid = roleIds.get(role);
    if (!rid) continue;
    for (const code of perms) {
      const pid = permIds.get(code);
      if (pid) await insertRp.run(rid, pid);
    }
  }

  await sqlite
    .prepare(
      `INSERT OR IGNORE INTO app_setting (key, value_json, updated_by, updated_at)
       VALUES ('email.enabled', 'false', ?, ?)`,
    )
    .run(actor, now);
}

export async function isBootstrapped(sqlite: Db): Promise<boolean> {
  const row = (await sqlite.prepare('SELECT COUNT(*) AS n FROM user_account').get()) as {
    n: number;
  };
  return row.n > 0;
}
