import postgres from 'postgres';
import { PG_APPEND_ONLY_TRIGGERS, toPostgresQuery, toPostgresSql } from './dialect.js';
import type { Db, Statement } from './types.js';

function coerceRow(row: Record<string, unknown> | undefined): unknown {
  if (!row) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'bigint') out[k] = Number(v);
    else if (typeof v === 'string' && (k === 'n' || k === 'changes') && /^-?\d+$/.test(v)) {
      out[k] = Number(v);
    } else out[k] = v;
  }
  return out;
}

function splitSql(sql: string): string[] {
  const parts: string[] = [];
  let buf = '';
  let inDollar = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql.startsWith('$$', i)) {
      inDollar = !inDollar;
      buf += '$$';
      i++;
      continue;
    }
    if (!inDollar && sql[i] === ';') {
      if (buf.trim()) parts.push(buf.trim());
      buf = '';
      continue;
    }
    buf += sql[i];
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

export function openPostgres(url: string, execSchema: (sql: string) => string): Db {
  const sql = postgres(url, {
    // One connection so BEGIN/COMMIT in withTx applies to the same session.
    // Preview/verification only — SQLite remains the office product.
    max: 1,
    idle_timeout: 20,
    ssl: url.includes('supabase') || url.includes('sslmode=require') ? 'require' : undefined,
    prepare: false,
  });

  const db: Db = {
    dialect: 'postgres',
    prepare(text: string): Statement {
      return {
        async get(...params: unknown[]) {
          const q = toPostgresQuery(text, params);
          const rows = await sql.unsafe(q.text, q.values as never[]);
          return coerceRow(rows[0] as Record<string, unknown> | undefined);
        },
        async all(...params: unknown[]) {
          const q = toPostgresQuery(text, params);
          const rows = await sql.unsafe(q.text, q.values as never[]);
          return (rows as Record<string, unknown>[]).map((r) => coerceRow(r) as unknown);
        },
        async run(...params: unknown[]) {
          const q = toPostgresQuery(text, params);
          const rows = await sql.unsafe(q.text, q.values as never[]);
          return { changes: rows.count ?? 0 };
        },
      };
    },
    async exec(text: string) {
      const translated = toPostgresSql(execSchema(text));
      for (const stmt of splitSql(translated)) {
        await sql.unsafe(stmt);
      }
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
  return db;
}

export { PG_APPEND_ONLY_TRIGGERS };
