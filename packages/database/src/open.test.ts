import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { integrityCheck, openDatabase, withTx } from './open.js';
import type { Db } from './types.js';
import { seedSystem } from './seed-system.js';

const dirs: string[] = [];
const dbs: { close: () => Promise<void> }[] = [];

function tmpDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-'));
  dirs.push(dir);
  return path.join(dir, 'app.db');
}

afterEach(async () => {
  for (const db of dbs.splice(0)) {
    try {
      await db.close();
    } catch {
      /* already closed */
    }
  }
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('database', () => {
  it('applies migrations and verifies PRAGMAs', async () => {
    const sqlite = await openDatabase(tmpDb());
    dbs.push(sqlite);
    expect(await integrityCheck(sqlite)).toBe('ok');
    await seedSystem(sqlite);
    const roles = (await sqlite.prepare('SELECT COUNT(*) AS n FROM role').get()) as { n: number };
    expect(roles.n).toBe(6);
    await sqlite.close();
  });

  it('is idempotent when re-run', async () => {
    const p = tmpDb();
    const a = await openDatabase(p);
    const countMigrations = async (db: Db) =>
      ((await db.prepare('SELECT COUNT(*) AS n FROM schema_migration').get()) as { n: number }).n;
    const first = await countMigrations(a);
    expect(first).toBeGreaterThan(0);
    await a.close();

    // Re-opening must apply nothing new. Asserted against the first run rather than a
    // hard-coded number, so adding a migration does not break this test.
    const b = await openDatabase(p);
    dbs.push(b);
    expect(await countMigrations(b)).toBe(first);
    const ids = (await b.prepare('SELECT id FROM schema_migration').all()) as { id: string }[];
    expect(new Set(ids.map((r) => r.id)).size).toBe(ids.length);
    await b.close();
  });

  it('rejects updates to append-only tables', async () => {
    const sqlite = await openDatabase(tmpDb());
    dbs.push(sqlite);
    await sqlite
      .prepare(
        `INSERT INTO audit_event (id, occurred_at, actor_label, action, entity_type, result)
         VALUES ('a1', datetime('now'), 'sys', 'test', 'x', 'ok')`,
      )
      .run();
    await expect(
      sqlite.prepare('UPDATE audit_event SET action = ? WHERE id = ?').run('no', 'a1'),
    ).rejects.toThrow(/append-only/);
    await expect(sqlite.prepare('DELETE FROM audit_event WHERE id = ?').run('a1')).rejects.toThrow(
      /append-only/,
    );
    await sqlite.close();
  });

  it('rolls back a forced failure inside a transaction', async () => {
    const sqlite = await openDatabase(tmpDb());
    dbs.push(sqlite);
    await expect(
      withTx(sqlite, async () => {
        await sqlite
          .prepare(
            `INSERT INTO audit_event (id, occurred_at, actor_label, action, entity_type, result)
             VALUES ('t1', datetime('now'), 'sys', 'test', 'x', 'ok')`,
          )
          .run();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const n = (await sqlite.prepare('SELECT COUNT(*) AS n FROM audit_event').get()) as {
      n: number;
    };
    expect(n.n).toBe(0);
    await sqlite.close();
  });
});
