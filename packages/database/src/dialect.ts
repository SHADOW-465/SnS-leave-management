const INSERT_OR_IGNORE = /INSERT\s+OR\s+IGNORE\s+INTO/gi;

export function toPostgresSql(sql: string): string {
  let s = sql.replace(/\bdatetime\s*\(\s*'now'\s*\)/gi, `(now() AT TIME ZONE 'utc')::text`);
  s = s.replace(/\bdate\s*\(\s*'now'\s*\)/gi, `CURRENT_DATE::text`);
  s = s.replace(
    /GROUP_CONCAT\s*\(\s*([^,()]+)\s*,\s*'([^']*)'\s*\)/gi,
    (_m, expr: string, sep: string) => `string_agg((${expr.trim()})::text, '${sep}')`,
  );
  s = s.replace(/\bcolumn TEXT\b/g, '"column" TEXT');
  s = s.replace(/CREATE TABLE (?!IF NOT EXISTS)/gi, 'CREATE TABLE IF NOT EXISTS ');
  s = s.replace(
    /DELETE FROM holiday\s+WHERE rowid NOT IN \([\s\S]*?\);/i,
    `DELETE FROM holiday a USING holiday b
 WHERE a.holiday_calendar_id = b.holiday_calendar_id AND a.date = b.date AND a.ctid < b.ctid;`,
  );
  if (INSERT_OR_IGNORE.test(s)) {
    INSERT_OR_IGNORE.lastIndex = 0;
    s = s.replace(INSERT_OR_IGNORE, 'INSERT INTO');
    if (!/ON\s+CONFLICT/i.test(s)) {
      s = s.replace(/\s*;\s*$/, '');
      s = `${s} ON CONFLICT DO NOTHING`;
    }
  }
  return s;
}

export function toPostgresQuery(
  sql: string,
  params: unknown[],
): { text: string; values: unknown[] } {
  const text0 = toPostgresSql(sql);
  if (params.length === 1 && isPlainObject(params[0])) {
    const obj = params[0] as Record<string, unknown>;
    const names: string[] = [];
    const text = text0.replace(/@(\w+)/g, (_, name: string) => {
      names.push(name);
      return `$${names.length}`;
    });
    return { text, values: names.map((n) => nullish(obj[n])) };
  }
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  let i = 0;
  const text = text0.replace(/\?/g, () => `$${++i}`);
  return { text, values: (flat as unknown[]).map(nullish) };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array);
}

function nullish(v: unknown): unknown {
  return v === undefined ? null : v;
}

export const PG_APPEND_ONLY_TRIGGERS = `
CREATE OR REPLACE FUNCTION leaveos_forbid_balance_ledger() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'balance_ledger is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION leaveos_forbid_audit_event() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS balance_ledger_no_update ON balance_ledger;
DROP TRIGGER IF EXISTS balance_ledger_no_delete ON balance_ledger;
DROP TRIGGER IF EXISTS audit_event_no_update ON audit_event;
DROP TRIGGER IF EXISTS audit_event_no_delete ON audit_event;

CREATE TRIGGER balance_ledger_no_update BEFORE UPDATE ON balance_ledger
  FOR EACH ROW EXECUTE FUNCTION leaveos_forbid_balance_ledger();
CREATE TRIGGER balance_ledger_no_delete BEFORE DELETE ON balance_ledger
  FOR EACH ROW EXECUTE FUNCTION leaveos_forbid_balance_ledger();
CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION leaveos_forbid_audit_event();
CREATE TRIGGER audit_event_no_delete BEFORE DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION leaveos_forbid_audit_event();
`;
