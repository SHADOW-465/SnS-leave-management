import { describe, expect, it } from 'vitest';
import { toPostgresQuery, toPostgresSql } from './dialect.js';

describe('toPostgresSql', () => {
  it('translates INSERT OR IGNORE to ON CONFLICT DO NOTHING', () => {
    expect(toPostgresSql('INSERT OR IGNORE INTO role (id) VALUES (?)')).toBe(
      'INSERT INTO role (id) VALUES (?) ON CONFLICT DO NOTHING',
    );
  });

  it('translates GROUP_CONCAT to string_agg', () => {
    const sql = toPostgresSql(`SELECT GROUP_CONCAT(r.code, ', ') AS roles FROM role r`);
    expect(sql).toContain(`string_agg((r.code)::text, ', ')`);
  });

  it('translates datetime(now) to timestamptz text', () => {
    expect(toPostgresSql(`SELECT datetime('now')`)).toMatch(/now\(\) AT TIME ZONE 'utc'/);
  });

  it('quotes the reserved column name and is idempotent on create table', () => {
    const sql = toPostgresSql('CREATE TABLE import_row_error (column TEXT)');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS import_row_error ("column" TEXT)');
  });

  it('rewrites sqlite rowid holiday dedupe for postgres', () => {
    const sql = toPostgresSql(`DELETE FROM holiday
WHERE rowid NOT IN (
  SELECT MAX(rowid) FROM holiday GROUP BY holiday_calendar_id, date
);`);
    expect(sql).toMatch(/ctid/);
    expect(sql).not.toMatch(/rowid/);
  });
});

describe('toPostgresQuery', () => {
  it('rewrites question-mark placeholders', () => {
    const q = toPostgresQuery('SELECT id FROM employee WHERE code = ? AND status = ?', [
      'E1',
      'active',
    ]);
    expect(q.text).toBe('SELECT id FROM employee WHERE code = $1 AND status = $2');
    expect(q.values).toEqual(['E1', 'active']);
  });

  it('rewrites named @placeholders from a plain object', () => {
    const q = toPostgresQuery('INSERT INTO role (id, code) VALUES (@id, @code)', [
      { id: 'r1', code: 'admin' },
    ]);
    expect(q.text).toBe('INSERT INTO role (id, code) VALUES ($1, $2)');
    expect(q.values).toEqual(['r1', 'admin']);
  });
});
