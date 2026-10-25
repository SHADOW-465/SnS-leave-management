#!/usr/bin/env node
/**
 * Idempotent staff import for a throwaway or copied SQLite file.
 *
 * The product template (GET /api/v1/import/template.csv) has no commit route, so this
 * script upserts by employee_code. It never opens Postgres, never reads DATABASE_URL,
 * and refuses the installed Leave OS folder and this repository's data directory.
 * By default it also refuses any file that is not under the OS temp directory.
 *
 * New accounts get a random password with must_change_password = 1. Passwords are
 * written only to --credentials-out. They are never printed.
 * A second run updates names and does not rotate passwords.
 *
 * The roster has no email, join date, department, manager, location or balances.
 * Blanks are filled only where the table cannot store null:
 *   work_email     <code>@example.invalid
 *   joined_on      --joined-on, or today's UTC date
 *   department     --department-code (default GEN, the setup department)
 *   location       the first location row (Headquarters after setup)
 *   role           staff / blank → employee. administrator is refused.
 * Balances are not posted. Leave stays at zero until the normal accrual job or HR.
 *
 * Usage:
 *   node scripts/import-roster.mjs --db <app.db> --csv <import.csv> --credentials-out <file>
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '@node-rs/argon2';
import { DatabaseSync } from 'node:sqlite';
import { parseCsv } from './roster-to-import.mjs';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
  algorithm: 2,
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function newId(nowMs = Date.now()) {
  let n = BigInt(nowMs);
  let time = '';
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[Number(n % 32n)] + time;
    n /= 32n;
  }
  const bytes = randomBytes(10);
  let r = 0n;
  for (const b of bytes) r = (r << 8n) | BigInt(b);
  let rand = '';
  for (let i = 0; i < 16; i += 1) {
    rand = CROCKFORD[Number(r % 32n)] + rand;
    r /= 32n;
  }
  return time + rand;
}

export function assertImportDbAllowed(dbPath, { allowOutsideTemp = false } = {}) {
  const abs = path.resolve(dbPath);
  const norm = abs.toLowerCase();
  const tmp = path
    .resolve(os.tmpdir())
    .toLowerCase()
    .replace(/[\\/]+$/, '');
  const inTemp = norm.startsWith(`${tmp}\\`) || norm.startsWith(`${tmp}/`);
  if (!inTemp && !allowOutsideTemp) {
    throw new Error(
      'Refusing to open a database outside the temp directory. Copy it to a temp folder, or pass --allow-outside-temp for a copy you made yourself.',
    );
  }
  if (norm.includes('simonandsons')) {
    throw new Error('Refusing the installed Leave OS data folder.');
  }
  const dataRoot = path.join(repoRoot, 'data').toLowerCase();
  if (norm === dataRoot || norm.startsWith(`${dataRoot}\\`) || norm.startsWith(`${dataRoot}/`)) {
    throw new Error('Refusing the repository data directory. Use a throwaway copy.');
  }
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function placeholderEmail(code) {
  const local = code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '.');
  return `${local || 'staff'}@example.invalid`;
}

function usernameFor(code) {
  const base = code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  return (base || 'staff').slice(0, 40);
}

function staffRole(value) {
  const role = (value ?? '').trim().toLowerCase();
  if (role === '' || role === 'staff' || role === 'employee') return 'employee';
  if (role === 'admin' || role === 'administrator') {
    throw new Error('Roster import cannot grant the administrator role.');
  }
  throw new Error(`Roster import only creates staff accounts. Refusing role "${role}".`);
}

function readPeople(csvText, { joinedOn, departmentCode }) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error('The import CSV has no people.');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const codeIdx = idx('employee_code');
  const firstIdx = idx('first_name');
  const lastIdx = idx('last_name');
  if (codeIdx < 0 || firstIdx < 0) {
    throw new Error('Import CSV needs employee_code and first_name columns.');
  }
  const people = [];
  for (const raw of rows.slice(1)) {
    const code = (raw[codeIdx] ?? '').trim();
    const first = (raw[firstIdx] ?? '').trim();
    if (!code || !first) continue;
    const last = lastIdx < 0 ? '' : (raw[lastIdx] ?? '').trim();
    const email = idx('work_email') < 0 ? '' : (raw[idx('work_email')] ?? '').trim();
    const joined = idx('joined_on') < 0 ? '' : (raw[idx('joined_on')] ?? '').trim();
    const dept = idx('department_code') < 0 ? '' : (raw[idx('department_code')] ?? '').trim();
    const role = idx('role') < 0 ? '' : (raw[idx('role')] ?? '').trim();
    people.push({
      code,
      first,
      last: last || '-',
      email: email || placeholderEmail(code),
      joinedOn: joined || joinedOn,
      departmentCode: dept || departmentCode,
      role: staffRole(role),
    });
  }
  if (people.length === 0) throw new Error('The import CSV has no people.');
  return people;
}

async function importRoster({ dbPath, csvPath, credentialsOut, joinedOn, departmentCode }) {
  assertImportDbAllowed(dbPath, {
    allowOutsideTemp: process.argv.includes('--allow-outside-temp'),
  });
  if (!fs.existsSync(dbPath)) {
    throw new Error('Database file does not exist. Set up Leave OS on a copy first.');
  }
  const people = readPeople(fs.readFileSync(csvPath, 'utf8'), { joinedOn, departmentCode });
  const db = new DatabaseSync(dbPath);
  const created = [];
  let updated = 0;
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const dept = db.prepare(`SELECT id FROM department WHERE code = ?`).get(departmentCode);
    if (!dept) {
      throw new Error(
        `No department with code ${departmentCode}. Create it in Leave OS, or pass --department-code.`,
      );
    }
    const location = db.prepare(`SELECT id FROM location ORDER BY created_at LIMIT 1`).get();
    if (!location)
      throw new Error('The database has no location. Run first-run setup on the copy.');
    const actor = db
      .prepare(
        `SELECT ua.id AS id FROM user_account ua
           JOIN user_role ur ON ur.user_account_id = ua.id
           JOIN role r ON r.id = ur.role_id
          WHERE r.code = 'admin' AND ua.is_disabled = 0
          LIMIT 1`,
      )
      .get();
    if (!actor) throw new Error('The database has no active administrator. Run setup on the copy.');
    const role = db.prepare(`SELECT id FROM role WHERE code = 'employee'`).get();
    if (!role) throw new Error('The employee role is missing. The database is not set up.');
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const person of people) {
        const existing = db
          .prepare(
            `SELECT id, first_name AS first, last_name AS last FROM employee WHERE employee_code = ?`,
          )
          .get(person.code);
        if (existing) {
          if (existing.first !== person.first || existing.last !== person.last) {
            db.prepare(
              `UPDATE employee SET first_name = ?, last_name = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
            ).run(person.first, person.last, now, actor.id, existing.id);
            updated += 1;
          }
          const account = db
            .prepare(`SELECT id FROM user_account WHERE employee_id = ?`)
            .get(existing.id);
          if (!account) {
            const password = await createAccount(db, {
              person,
              employeeId: existing.id,
              roleId: role.id,
              actorId: actor.id,
              now,
            });
            created.push({ code: person.code, password });
          }
          continue;
        }
        const employeeId = newId();
        db.prepare(
          `INSERT INTO employee (
             id, employee_code, first_name, last_name, work_email, status, joined_on,
             location_id, department_id, retention_class, created_at, created_by, updated_at, updated_by
           ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 'standard', ?, ?, ?, ?)`,
        ).run(
          employeeId,
          person.code,
          person.first,
          person.last,
          person.email,
          person.joinedOn,
          location.id,
          dept.id,
          now,
          actor.id,
          now,
          actor.id,
        );
        const password = await createAccount(db, {
          person,
          employeeId,
          roleId: role.id,
          actorId: actor.id,
          now,
        });
        created.push({ code: person.code, password });
        db.prepare(
          `INSERT INTO audit_event (
             id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, after_json, result
           ) VALUES (?, ?, ?, 'roster-import', 'employee.imported', 'employee', ?, ?, 'ok')`,
        ).run(
          newId(),
          now,
          actor.id,
          employeeId,
          JSON.stringify({ employeeCode: person.code, created: true }),
        );
      }
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* already closed */
      }
      throw err;
    }
  } finally {
    db.close();
  }
  if (credentialsOut && created.length > 0) {
    const lines = ['employee_code,password'];
    for (const row of created) lines.push(`${row.code},${row.password}`);
    fs.writeFileSync(credentialsOut, `${lines.join('\n')}\n`, { flag: 'wx' });
  }
  process.stdout.write(`created=${created.length} updated=${updated}\n`);
}

async function createAccount(db, { person, employeeId, roleId, actorId, now }) {
  const password = randomBytes(18).toString('base64url');
  const passwordHash = await hash(password, ARGON2_OPTIONS);
  const userId = newId();
  let username = usernameFor(person.code);
  let n = 2;
  while (db.prepare(`SELECT id FROM user_account WHERE LOWER(username) = LOWER(?)`).get(username)) {
    username = `${usernameFor(person.code).slice(0, 32)}${n}`;
    n += 1;
  }
  db.prepare(
    `INSERT INTO user_account (
       id, employee_id, email, username, password_hash, password_algo, must_change_password,
       is_disabled, created_at, created_by, updated_at, updated_by
     ) VALUES (?, ?, ?, ?, ?, 'argon2id', 1, 0, ?, ?, ?, ?)`,
  ).run(userId, employeeId, person.email, username, passwordHash, now, actorId, now, actorId);
  db.prepare(
    `INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at) VALUES (?, ?, ?, ?)`,
  ).run(userId, roleId, actorId, now);
  return password;
}

function isDirectRun() {
  const arg = process.argv[1];
  if (!arg) return false;
  return path.resolve(arg).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
}

if (isDirectRun()) {
  const dbPath = argValue('--db');
  const csvPath = argValue('--csv');
  if (!dbPath || !csvPath) {
    console.error(
      'Usage: node scripts/import-roster.mjs --db <app.db> --csv <import.csv> [--credentials-out <file>] [--joined-on YYYY-MM-DD] [--department-code GEN]',
    );
    process.exit(2);
  }
  importRoster({
    dbPath,
    csvPath,
    credentialsOut: argValue('--credentials-out'),
    joinedOn: argValue('--joined-on') || todayUtc(),
    departmentCode: argValue('--department-code') || 'GEN',
  }).catch((err) => {
    console.error(err instanceof Error ? err.message : 'Import failed.');
    process.exit(1);
  });
}
