import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyPendingRestore, integrityCheck, openDatabase, withTx } from './open.js';
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
    expect(roles.n).toBe(7); // includes the Managing Director
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

  it('joins an outer transaction instead of nesting, and rolls back as one', async () => {
    const sqlite = await openDatabase(tmpDb());
    dbs.push(sqlite);
    const insert = (id: string) =>
      sqlite
        .prepare(
          `INSERT INTO audit_event (id, occurred_at, actor_label, action, entity_type, result)
           VALUES (?, datetime('now'), 'sys', 'test', 'x', 'ok')`,
        )
        .run(id);
    await expect(
      withTx(sqlite, async () => {
        await insert('outer');
        await withTx(sqlite, async () => insert('inner'));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const n = (await sqlite.prepare('SELECT COUNT(*) AS n FROM audit_event').get()) as {
      n: number;
    };
    expect(n.n).toBe(0);
    await withTx(sqlite, async () => {
      await insert('a');
      await withTx(sqlite, async () => insert('b'));
    });
    const m = (await sqlite.prepare('SELECT COUNT(*) AS n FROM audit_event').get()) as {
      n: number;
    };
    expect(m.n).toBe(2);
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

describe('restore on next start', () => {
  async function makeDb(file: string, rows: number) {
    const db = await openDatabase(file);
    await db.exec('CREATE TABLE IF NOT EXISTS probe (n INTEGER)');
    for (let i = 0; i < rows; i++) await db.prepare('INSERT INTO probe (n) VALUES (?)').run(i);
    return db;
  }
  async function probeCount(file: string): Promise<number> {
    const db = await openDatabase(file);
    dbs.push(db);
    return Number(((await db.prepare('SELECT COUNT(*) AS n FROM probe').get()) as { n: number }).n);
  }

  it('refuses a damaged backup and keeps the live database', async () => {
    const live = tmpDb();
    await (await makeDb(live, 3)).close();
    const bad = path.join(path.dirname(live), 'bad.db');
    const source = await makeDb(bad, 50);
    await source.close();
    // Keep the "SQLite format 3" header, wreck everything after the first page.
    const bytes = fs.readFileSync(bad);
    bytes.fill(0xab, 4096);
    fs.writeFileSync(`${live}.restore`, bytes);

    expect(applyPendingRestore(live)).toBe(false);
    expect(fs.existsSync(`${live}.restore`)).toBe(false);
    expect(fs.existsSync(`${live}.restore.rejected`)).toBe(true);
    expect(await probeCount(live)).toBe(3);
  });

  it('the safety copy of the live database keeps writes not yet checkpointed', async () => {
    const live = tmpDb();
    const backup = path.join(path.dirname(live), 'backup.db');
    await (await makeDb(backup, 1)).close();
    // The live database as a stopped service leaves it: recent writes still in the -wal.
    const running = await makeDb(path.join(path.dirname(live), 'running.db'), 7);
    for (const suffix of ['', '-wal']) {
      fs.copyFileSync(path.join(path.dirname(live), `running.db${suffix}`), `${live}${suffix}`);
    }
    await running.close();
    fs.copyFileSync(backup, `${live}.restore`);

    expect(applyPendingRestore(live)).toBe(true);
    expect(await probeCount(live)).toBe(1);
    const safety = fs
      .readdirSync(path.dirname(live))
      .filter((f) => f.startsWith('app.db.before-restore') && !/-(wal|shm)$/.test(f));
    expect(safety).toHaveLength(1);
    expect(await probeCount(path.join(path.dirname(live), safety[0]!))).toBe(7);
  });

  it('a second restore does not overwrite the first safety copy', async () => {
    const live = tmpDb();
    const backup = path.join(path.dirname(live), 'backup.db');
    await (await makeDb(backup, 1)).close();
    await (await makeDb(live, 5)).close();
    fs.copyFileSync(backup, `${live}.restore`);
    expect(applyPendingRestore(live)).toBe(true);
    fs.copyFileSync(backup, `${live}.restore`);
    expect(applyPendingRestore(live)).toBe(true);
    const safety = fs
      .readdirSync(path.dirname(live))
      .filter((f) => f.startsWith('app.db.before-restore') && !/-(wal|shm)$/.test(f));
    expect(safety).toHaveLength(2);
    const counts = await Promise.all(
      safety.map((f) => probeCount(path.join(path.dirname(live), f))),
    );
    expect(counts.sort()).toEqual([1, 5]);
  });
});
