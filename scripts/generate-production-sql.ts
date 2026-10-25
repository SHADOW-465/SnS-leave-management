/**
 * Writes the hosted-Postgres wipe/roster scripts and the administrator's one-time password.
 * Never touches a database. Refuses an output folder inside this repository, because the
 * roster has real names and the password file is a credential.
 *
 *   cd apps/server
 *   node --import tsx ../../scripts/generate-production-sql.ts \
 *     --csv <employee_id,name file> --out-dir <folder outside the repo> \
 *     --admin SnS001 --hr SnS078 --joined-on YYYY-MM-DD
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateTemporaryPassword, hashPassword } from '../packages/auth/src/index.js';
import {
  buildPreviewSql,
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

async function main() {
  const csv = arg('--csv');
  const outDir = arg('--out-dir');
  const admin = arg('--admin');
  const hr = arg('--hr');
  if (!csv || !outDir || !admin || !hr) {
    console.error(
      'Usage: --csv <file> --out-dir <dir> --admin <code> --hr <code> [--joined-on YYYY-MM-DD]',
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
  const roster = readRoster(fs.readFileSync(csv, 'utf8'));
  const temporary = generateTemporaryPassword();
  const sql = buildRosterSql({
    roster,
    adminCode: admin,
    hrCode: hr,
    adminPasswordHash: await hashPassword(temporary),
    joinedOn: arg('--joined-on') ?? new Date().toISOString().slice(0, 10),
  });
  fs.writeFileSync(path.join(out, '00_preview_counts.sql'), buildPreviewSql());
  fs.writeFileSync(path.join(out, '01_partA_wipe_sample.sql'), buildWipeSql());
  fs.writeFileSync(path.join(out, '02_partB_employees.sql'), sql);
  fs.writeFileSync(
    path.join(out, 'vijay_temp_password.txt'),
    `Employee ID: ${admin}\nOne-time password: ${temporary}\nYou must choose a new password at first sign-in. Delete this file afterwards.\n`,
  );
  console.warn(`wrote 3 scripts for ${roster.length} people and the administrator password file`);
}

void main();
