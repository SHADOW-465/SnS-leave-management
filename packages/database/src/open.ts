import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PG_APPEND_ONLY_TRIGGERS, toPostgresSql } from './dialect.js';
import { openPostgres } from './postgres.js';
import { wrapSqliteWithRaw } from './sqlite.js';
import type { Db } from './types.js';

export type { Db, Statement } from './types.js';

function sqliteSchemaToPg(sql: string): string {
  const stripped = sql.replace(/CREATE TRIGGER[\s\S]*?^END;/gm, '');
  return `${toPostgresSql(stripped)}\n${PG_APPEND_ONLY_TRIGGERS}`;
}

export async function applyPragmas(sqlite: Db): Promise<void> {
  if (sqlite.dialect !== 'sqlite') return;
  await sqlite.exec('PRAGMA foreign_keys = ON');
  await sqlite.exec('PRAGMA journal_mode = WAL');
  await sqlite.exec('PRAGMA synchronous = FULL');
  await sqlite.exec('PRAGMA busy_timeout = 5000');
  await verifyPragmas(sqlite);
}

async function pragmaValue(sqlite: Db, name: string): Promise<unknown> {
  const row = (await sqlite.prepare(`PRAGMA ${name}`).get()) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return Object.values(row)[0];
}

export async function verifyPragmas(sqlite: Db): Promise<void> {
  if (sqlite.dialect !== 'sqlite') return;
  const fk = await pragmaValue(sqlite, 'foreign_keys');
  const journal = String(await pragmaValue(sqlite, 'journal_mode')).toLowerCase();
  const sync = await pragmaValue(sqlite, 'synchronous');
  const busy = await pragmaValue(sqlite, 'busy_timeout');
  const problems: string[] = [];
  if (Number(fk) !== 1) problems.push(`foreign_keys=${fk}`);
  if (journal !== 'wal' && journal !== 'memory') problems.push(`journal_mode=${journal}`);
  if (Number(sync) !== 2) problems.push(`synchronous=${sync}`);
  if (Number(busy) < 5000) problems.push(`busy_timeout=${busy}`);
  if (problems.length) {
    throw new Error(`SQLite PRAGMAs not in effect: ${problems.join(', ')}`);
  }
}

export async function migrate(db: Db): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    ((await db.prepare('SELECT id FROM schema_migration').all()) as { id: string }[]).map(
      (r) => r.id,
    ),
  );
  const files = [
    { id: '0001_init' },
    { id: '0002_holiday_one_kind_per_date' },
    { id: '0003_team_lead_approver' },
    { id: '0004_workstation_device_binding' },
    { id: '0005_approval_controls' },
  ];
  for (const m of files) {
    if (applied.has(m.id)) continue;
    let sql = fs.readFileSync(new URL(`./sql/${m.id}.sql`, import.meta.url), 'utf8');
    if (db.dialect === 'postgres') sql = sqliteSchemaToPg(sql);
    await db.exec('BEGIN');
    try {
      await db.exec(sql);
      await db
        .prepare('INSERT INTO schema_migration (id, applied_at) VALUES (?, ?)')
        .run(m.id, new Date().toISOString());
      await db.exec('COMMIT');
    } catch (err) {
      try {
        await db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    }
  }
}

export async function openDatabase(dbPath: string): Promise<Db> {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const raw = new DatabaseSync(dbPath);
  const db = wrapSqliteWithRaw(raw);
  await applyPragmas(db);
  await migrate(db);
  await applyPragmas(db);
  return db;
}

export async function openDatabaseFromEnv(opts: {
  sqlitePath: string;
  databaseUrl?: string;
}): Promise<Db> {
  const url = opts.databaseUrl?.trim();
  if (url) {
    const db = openPostgres(url, (s) => s);
    await migrate(db);
    return db;
  }
  return openDatabase(opts.sqlitePath);
}

/** Serialises BEGIN/COMMIT on the single preview Postgres connection (Fluid concurrent requests). */
let pgTxGate: Promise<void> = Promise.resolve();

export async function withTx<T>(db: Db, fn: () => Promise<T> | T): Promise<T> {
  const run = async (): Promise<T> => {
    await db.exec(db.dialect === 'sqlite' ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try {
      const result = await fn();
      await db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        await db.exec('ROLLBACK');
      } catch {
        // already rolled back
      }
      throw err;
    }
  };
  if (db.dialect !== 'postgres') return run();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prev = pgTxGate;
  pgTxGate = next;
  await prev;
  try {
    return await run();
  } finally {
    release();
  }
}

export async function integrityCheck(db: Db): Promise<string> {
  if (db.dialect === 'postgres') {
    await db.prepare('SELECT 1 AS n').get();
    return 'ok';
  }
  const row = (await db.prepare('PRAGMA integrity_check').get()) as { integrity_check: string };
  return row.integrity_check;
}

export async function backupTo(db: Db, dest: string): Promise<void> {
  if (db.dialect !== 'sqlite') {
    throw new Error(
      'File backup is SQLite-only. Preview Postgres does not write a local .db copy.',
    );
  }
  await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const escaped = dest.replaceAll('\\', '/').replaceAll("'", "''");
  await db.exec(`VACUUM INTO '${escaped}'`);
}
