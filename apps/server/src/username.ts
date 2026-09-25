import type { Db } from '@sns/database';

export function sanitiseUsername(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  return cleaned.slice(0, 40);
}

export async function uniqueUsername(
  sqlite: Db,
  desired: string,
  exceptUserId?: string,
): Promise<string> {
  let base = sanitiseUsername(desired);
  if (base.length < 2) base = 'user';
  let candidate = base;
  let n = 2;
  for (;;) {
    const taken = exceptUserId
      ? await sqlite
          .prepare(`SELECT id FROM user_account WHERE LOWER(username) = LOWER(?) AND id != ?`)
          .get(candidate, exceptUserId)
      : await sqlite
          .prepare(`SELECT id FROM user_account WHERE LOWER(username) = LOWER(?)`)
          .get(candidate);
    if (!taken) return candidate;
    candidate = `${base.slice(0, 32)}${n}`;
    n += 1;
    if (n > 500) return `${base.slice(0, 24)}${Date.now().toString(36)}`;
  }
}
