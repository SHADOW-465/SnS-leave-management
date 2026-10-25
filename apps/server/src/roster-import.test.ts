import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyPassword } from '@sns/auth';
import { loadConfig } from '@sns/config';
import { openDatabase, type Db } from '@sns/database';
import { buildApp } from './app.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const opened: { sqlite: Db; dir: string }[] = [];

afterEach(async () => {
  for (const { sqlite, dir } of opened.splice(0)) {
    try {
      await sqlite.close();
    } catch {
      /* closed by the test before the importer ran */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function rosterCsv() {
  const lines = ['employee_id,name'];
  for (let i = 1; i <= 33; i += 1) {
    lines.push(`SYN-${String(i).padStart(3, '0')},Synthetic${i} Example`);
  }
  return lines.join('\n');
}

/** The scripts are plain JavaScript outside the server project, so the test runs them in Node. */
function nodeScript(source: string, arg: string) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', source, '--', arg], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
}

function convertRoster(text: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-convert-'));
  const input = path.join(dir, 'in.csv');
  fs.writeFileSync(input, text);
  const result = nodeScript(
    `import { convertRoster } from './scripts/roster-to-import.mjs';
     import fs from 'node:fs';
     process.stdout.write(convertRoster(fs.readFileSync(process.argv[1], 'utf8')));`,
    input,
  );
  fs.rmSync(dir, { recursive: true, force: true });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

describe('roster import', () => {
  it('converts employee_id and name into the import columns, with staff and blanks', () => {
    const csv = convertRoster(`${rosterCsv()}\nSYN-034,Solo`);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'employee_code,first_name,last_name,work_email,joined_on,department_code,manager_code,role',
    );
    expect(lines).toHaveLength(35);
    expect(lines[1]).toBe('SYN-001,Synthetic1,Example,,,,,staff');
    expect(lines[34]).toBe('SYN-034,Solo,,,,,,staff');
    expect(csv).not.toContain('@');
  });

  it('refuses the repository database and the installed data folder', () => {
    const source = `import { assertImportDbAllowed } from './scripts/import-roster.mjs';
      try {
        assertImportDbAllowed(process.argv[1]);
      } catch (error) {
        process.stderr.write(error instanceof Error ? error.message : 'refused');
        process.exit(1);
      }`;
    const repoDb = path.join(repoRoot, 'data', 'db', 'app.db');
    const office = nodeScript(source, repoDb);
    expect(office.status).toBe(1);
    expect(office.stderr).toMatch(/temp directory/);
    const installed = nodeScript(source, 'C:\\ProgramData\\SimonAndSons\\LeaveOS\\db\\app.db');
    expect(installed.status).toBe(1);
    expect(installed.stderr).toMatch(/temp directory|installed Leave OS/);
  });

  it('upserts 33 synthetic staff into a throwaway database without printing passwords', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-roster-'));
    const dbPath = path.join(dir, 'app.db');
    const sqlite = await openDatabase(dbPath);
    opened.push({ sqlite, dir });
    const app = await buildApp(loadConfig({ LEAVEOS_DATA_DIR: dir, LEAVEOS_ENV: 'test' }), sqlite);
    await app.ready();
    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: {
        companyName: 'Test Co',
        timezone: 'UTC',
        leaveYearStartMonth: 1,
        leaveYearStartDay: 1,
        adminName: 'Ada Example',
        adminEmail: 'admin@example.invalid',
        adminPassword: 'ChangeMe_admin_1',
        loadSampleData: false,
      },
    });
    expect(setup.statusCode).toBe(200);
    await app.close();
    await sqlite.close();

    const rosterPath = path.join(dir, 'roster.csv');
    const importPath = path.join(dir, 'import.csv');
    const credPath = path.join(dir, 'credentials.csv');
    fs.writeFileSync(rosterPath, rosterCsv());
    const converted = convertRoster(fs.readFileSync(rosterPath, 'utf8'));
    fs.writeFileSync(importPath, converted);
    expect(converted.trim().split('\n')).toHaveLength(34);

    const run = (csv = importPath) =>
      spawnSync(
        process.execPath,
        [
          path.join(repoRoot, 'scripts', 'import-roster.mjs'),
          '--db',
          dbPath,
          '--csv',
          csv,
          '--credentials-out',
          credPath,
          '--joined-on',
          '2024-04-01',
        ],
        { encoding: 'utf8', cwd: repoRoot },
      );

    const first = run();
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout.trim()).toBe('created=33 updated=0');

    const creds = fs.readFileSync(credPath, 'utf8').trim().split('\n').slice(1);
    expect(creds).toHaveLength(33);
    const passwords = creds.map((line) => line.split(',')[1] ?? '');
    const leaked = passwords.some(
      (secret) =>
        secret.length > 0 && (first.stdout.includes(secret) || first.stderr.includes(secret)),
    );
    expect(leaked).toBe(false);

    const check = await openDatabase(dbPath);
    opened.push({ sqlite: check, dir });
    const count = (await check
      .prepare(`SELECT COUNT(*) AS n FROM employee WHERE employee_code LIKE 'SYN-%'`)
      .get()) as { n: number };
    expect(Number(count.n)).toBe(33);
    const sample = (await check
      .prepare(
        `SELECT ua.password_hash AS hash, ua.must_change_password AS mustChange, r.code AS role,
                e.work_email AS email, e.joined_on AS joined, e.first_name AS first
           FROM employee e
           JOIN user_account ua ON ua.employee_id = e.id
           JOIN user_role ur ON ur.user_account_id = ua.id
           JOIN role r ON r.id = ur.role_id
          WHERE e.employee_code = 'SYN-001'`,
      )
      .get()) as {
      hash: string;
      mustChange: number;
      role: string;
      email: string;
      joined: string;
      first: string;
    };
    expect(sample.role).toBe('employee');
    expect(sample.email).toBe('syn-001@example.invalid');
    expect(sample.joined).toBe('2024-04-01');
    expect(sample.first).toBe('Synthetic1');
    expect(Number(sample.mustChange)).toBe(1);
    expect(await verifyPassword(sample.hash, passwords[0] ?? '')).toBe(true);
    const ledger = (await check
      .prepare(
        `SELECT COUNT(*) AS n FROM balance_ledger bl
           JOIN employee e ON e.id = bl.employee_id WHERE e.employee_code LIKE 'SYN-%'`,
      )
      .get()) as { n: number };
    expect(Number(ledger.n)).toBe(0);
    await check.close();

    const renamed = converted.replaceAll('Synthetic', 'Renamed');
    const renamedPath = path.join(dir, 'import-renamed.csv');
    fs.writeFileSync(renamedPath, renamed);
    const second = run(renamedPath);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout.trim()).toBe('created=0 updated=33');
    const again = await openDatabase(dbPath);
    const after = (await again
      .prepare(
        `SELECT e.first_name AS first, ua.password_hash AS hash, ua.must_change_password AS mustChange
           FROM employee e JOIN user_account ua ON ua.employee_id = e.id
          WHERE e.employee_code = 'SYN-001'`,
      )
      .get()) as { first: string; hash: string; mustChange: number };
    expect(after.first).toBe('Renamed1');
    expect(after.hash).toBe(sample.hash);
    expect(Number(after.mustChange)).toBe(1);
    const still = (await again
      .prepare(`SELECT COUNT(*) AS n FROM employee WHERE employee_code LIKE 'SYN-%'`)
      .get()) as { n: number };
    expect(Number(still.n)).toBe(33);
    await again.close();
  }, 120_000);
});
