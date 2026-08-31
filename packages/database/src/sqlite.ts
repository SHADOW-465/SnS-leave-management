import { DatabaseSync } from 'node:sqlite';
import type { Db, Statement } from './types.js';

function bindArgs(params: unknown[]): unknown[] {
  if (params.length === 1 && Array.isArray(params[0])) return params[0] as unknown[];
  return params;
}

function wrapStatement(stmt: ReturnType<DatabaseSync['prepare']>): Statement {
  stmt.setAllowBareNamedParameters(true);
  return {
    async get(...params: unknown[]) {
      return stmt.get(...(bindArgs(params) as never[]));
    },
    async all(...params: unknown[]) {
      return stmt.all(...(bindArgs(params) as never[]));
    },
    async run(...params: unknown[]) {
      const info = stmt.run(...(bindArgs(params) as never[]));
      return { changes: Number(info.changes ?? 0) };
    },
  };
}

export function wrapSqlite(raw: DatabaseSync): Db {
  const original = raw.prepare.bind(raw);
  return {
    dialect: 'sqlite',
    prepare(sql: string) {
      return wrapStatement(original(sql));
    },
    async exec(sql: string) {
      raw.exec(sql);
    },
    async close() {
      raw.close();
    },
  };
}

export function unwrapSqlite(db: Db): DatabaseSync | undefined {
  return (db as Db & { _raw?: DatabaseSync })._raw;
}

export function wrapSqliteWithRaw(raw: DatabaseSync): Db {
  const db = wrapSqlite(raw);
  Object.defineProperty(db, '_raw', { value: raw, enumerable: false });
  return db;
}
