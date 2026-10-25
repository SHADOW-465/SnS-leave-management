/**
 * Writes the hosted-Postgres wipe/roster scripts and the administrator's one-time password.
 * Never touches a database. Refuses an output folder inside this repository, because the
 * roster has real names and the password file is a credential.
 *
 *   cd apps/server
 *   node --import tsx ../../scripts/generate-production-sql.ts \
 *     --csv <employee_id,name file> --out-dir <folder outside the repo> \
 *     --admin SnS001 --hr SnS078 --joined-on YYYY-MM-DD
 *
 * To regenerate without changing the administrator's password (the one-time password file you
 * already hold stays valid), read the roster and password hash back from a previous run:
 *
 *   node --import tsx ../../scripts/generate-production-sql.ts \
 *     --from-existing <previous out-dir> --out-dir <same dir> --admin SnS001 --hr SnS078
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateTemporaryPassword,
  hashPassword,
  verifyPassword,
} from '../packages/auth/src/index.js';
import {
  buildInspectSql,
  buildPreviewSql,
  buildSchemaUpgradeSql,
  buildRosterSql,
  buildWipeSql,
  type RosterRow,
} from '../apps/server/src/ops/production-sql.js';
import { parseCsv } from './roster-to-import.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}

export function readRoster(csv: string): RosterRow[] {
  const rows = parseCsv(csv) as string[][];
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase().replaceAll(' ', '_'));
  const id = header.findIndex((h) => h === 'employee_id' || h === 'employee_code');
  const name = header.findIndex((h) => h === 'name');
  if (id < 0 || name < 0) throw new Error('The roster needs employee_id and name columns.');
  return rows
    .slice(1)
    .map((r) => ({ code: (r[id] ?? '').trim(), name: (r[name] ?? '').trim() }))
    .filter((r) => r.code && r.name);
}

/**
 * Reads the roster and the administrator's password hash from a previous run's 02 script, and
 * checks the hash against the saved one-time password. Prints neither.
 */
export async function readExisting(dir: string, admin: string) {
  const sql = fs.readFileSync(path.join(dir, '02_partB_employees.sql'), 'utf8');
  const block = /INSERT INTO _ops_roster VALUES\n([\s\S]*?);\n/.exec(sql)?.[1];
  if (!block) throw new Error('No roster found in 02_partB_employees.sql.');
  const roster: RosterRow[] = [];
  let hash: string | undefined;
  for (const line of block.split('\n')) {
    const f = [...line.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]!.replaceAll("''", "'"));
    if (f.length !== 7) throw new Error('Unreadable roster row in 02_partB_employees.sql.');
    const [code, first, last] = f as [string, string, string];
    roster.push({ code, name: last === '-' ? first : `${first} ${last}` });
    if (code.toLowerCase() === admin.toLowerCase()) hash = f[5];
  }
  const saved = /One-time password: (\S+)/.exec(
    fs.readFileSync(path.join(dir, 'vijay_temp_password.txt'), 'utf8'),
  )?.[1];
  if (!hash || !saved || !(await verifyPassword(hash, saved))) {
    throw new Error(
      'The saved one-time password does not match the hash in 02_partB_employees.sql.',
    );
  }
  return { roster, hash };
}

async function main() {
  const csv = arg('--csv');
  const outDir = arg('--out-dir');
  const admin = arg('--admin');
  const hr = arg('--hr');
  const existing = arg('--from-existing');
  if ((!csv && !existing) || !outDir || !admin || !hr) {
    console.error(
      'Usage: (--csv <file> | --from-existing <dir>) --out-dir <dir> --admin <code> --hr <code> [--joined-on YYYY-MM-DD]',
    );
    process.exit(2);
  }
  const out = path.resolve(outDir);
  const rel = path.relative(repoRoot, out);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    console.error('Refusing to write inside the repository. Choose a folder outside it.');
    process.exit(2);
  }
  fs.mkdirSync(out, { recursive: true });
  let roster: RosterRow[];
  let adminPasswordHash: string;
  const fresh = !existing;
  if (existing) {
    ({ roster, hash: adminPasswordHash } = await readExisting(path.resolve(existing), admin));
  } else {
    roster = readRoster(fs.readFileSync(csv!, 'utf8'));
    adminPasswordHash = '';
  }
  const temporary = generateTemporaryPassword();
  if (fresh) adminPasswordHash = await hashPassword(temporary);
  const sql = buildRosterSql({
    roster,
    adminCode: admin,
    hrCode: hr,
    adminPasswordHash,
    joinedOn: arg('--joined-on') ?? new Date().toISOString().slice(0, 10),
  });
  fs.writeFileSync(path.join(out, '00_preview_counts.sql'), buildPreviewSql());
  fs.writeFileSync(path.join(out, '01_partA_wipe_sample.sql'), buildWipeSql());
  fs.writeFileSync(path.join(out, '02_partB_employees.sql'), sql);
  fs.writeFileSync(path.join(out, '03_schema_upgrade.sql'), buildSchemaUpgradeSql());
  fs.writeFileSync(path.join(out, '99_inspect_live_schema.sql'), buildInspectSql());
  // A reused password keeps its file exactly as it is.
  if (fresh) {
    fs.writeFileSync(
      path.join(out, 'vijay_temp_password.txt'),
      `Employee ID: ${admin}\nOne-time password: ${temporary}\nYou must choose a new password at first sign-in. Delete this file afterwards.\n`,
    );
  }
  console.warn(
    `wrote 5 scripts for ${roster.length} people; administrator password ${fresh ? 'new (file written)' : 'kept (file untouched)'}`,
  );
}

void main();
