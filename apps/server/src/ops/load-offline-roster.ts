/**
 * Loads the office roster into an installed (offline, SQLite) Leave OS database.
 * Stop the LeaveOS service first, run from an elevated prompt (the data folder is
 * SYSTEM/Administrators only), then start the service again.
 *
 *   pnpm --filter @sns/server exec tsx src/ops/load-offline-roster.ts \
 *     --db "%PROGRAMDATA%\SimonAndSons\LeaveOS\db\app.db" \
 *     --hosted-sql <folder with 02_partB_employees.sql> | --csv <roster.csv> \
 *     --password-out <new file> [--admin SnS001] [--hr SnS078] [--joined-on YYYY-MM-DD]
 *     [--disable-other-admins]
 *
 * The administrator's one-time password goes only to --password-out (created new, never
 * overwritten). Nothing secret is printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '@sns/database';
import { loadOfflineRoster, rosterFromHostedSql } from './offline-roster.js';

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}

async function main() {
  const db = arg('--db');
  const out = arg('--password-out');
  const hosted = arg('--hosted-sql');
  const csv = arg('--csv');
  if (!db || !out || (!hosted && !csv)) {
    throw new Error(
      'Usage: --db <leaveos.db> --password-out <file> (--hosted-sql <dir> | --csv <file>)',
    );
  }
  if (!fs.existsSync(db))
    throw new Error('Database file does not exist. Run first-run setup first.');
  if (fs.existsSync(out)) throw new Error('--password-out already exists. Choose a new file.');
  let roster;
  if (hosted) {
    roster = rosterFromHostedSql(
      fs.readFileSync(path.join(hosted, '02_partB_employees.sql'), 'utf8'),
    );
  } else {
    const rows = fs
      .readFileSync(csv!, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
    const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase().replaceAll(' ', '_'));
    const id = header.findIndex((h) => h === 'employee_id' || h === 'employee_code');
    const name = header.findIndex((h) => h === 'name');
    if (id < 0 || name < 0) throw new Error('The roster needs employee_id and name columns.');
    roster = rows
      .slice(1)
      .map((r) => ({ code: (r[id] ?? '').trim(), name: (r[name] ?? '').trim() }))
      .filter((r) => r.code && r.name);
  }
  const admin = arg('--admin') ?? 'SnS001';
  const sqlite = await openDatabase(db);
  try {
    const res = await loadOfflineRoster(sqlite, {
      roster,
      adminCode: admin,
      hrCode: arg('--hr') ?? 'SnS078',
      joinedOn: arg('--joined-on') ?? new Date().toISOString().slice(0, 10),
      disableOtherAdmins: process.argv.includes('--disable-other-admins'),
    });
    if (res.adminTemporaryPassword) {
      fs.writeFileSync(
        out,
        `Employee ID: ${admin}\nOne-time password: ${res.adminTemporaryPassword}\nYou must choose a new password at first sign-in. Delete this file afterwards.\n`,
        { flag: 'wx' },
      );
    }
    console.warn(
      `people=${roster.length} created=${res.created} existing=${res.existing} disabled_admins=${res.disabledAdmins} admin_password=${res.adminTemporaryPassword ? 'written to file' : 'unchanged'}`,
    );
  } finally {
    await sqlite.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : 'Roster load failed.');
  process.exit(1);
});
