import type { RequestContext } from './ctx.js';
import { NAVALUR_SEED_SQL } from './navalur-seed-sql.js';

export function splitSql(sql: string): string[] {
  const parts: string[] = [];
  let buf = '';
  let inDollar = false;
  let inComment = false;
  for (let i = 0; i < sql.length; i += 1) {
    if (!inDollar && sql.startsWith('--', i)) {
      inComment = true;
    }
    if (inComment && sql[i] === '\n') {
      inComment = false;
    }
    if (sql.startsWith('$$', i)) {
      inDollar = !inDollar;
      buf += '$$';
      i += 1;
      continue;
    }
    if (!inDollar && !inComment && sql[i] === ';') {
      if (buf.trim()) parts.push(buf.trim());
      buf = '';
      continue;
    }
    buf += sql[i];
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

/**
 * Runs the Navalur Chennai company dataset reset & seeding EXACTLY ONCE on deployment.
 * Protects against re-running: checks `demo.navalur_seed` = '2' in app_setting.
 * If already set, returns immediately without deleting or resetting anything.
 */
export async function ensureNavalurDataset(ctx: RequestContext): Promise<void> {
  try {
    const row = (await ctx.sqlite
      .prepare(`SELECT value_json FROM app_setting WHERE key = 'demo.navalur_seed'`)
      .get()) as { value_json: string } | undefined;

    if (row && (row.value_json === '"2"' || row.value_json === '2')) {
      // Already seeded with version 2! Do not touch or delete anything.
      return;
    }
  } catch {
    // Table might not exist yet if migrations haven't run, proceed
  }

  // Execute statements in order
  const statements = splitSql(NAVALUR_SEED_SQL);
  for (const stmt of statements) {
    if (!stmt.trim()) continue;
    await ctx.sqlite.exec(stmt);
  }
}
