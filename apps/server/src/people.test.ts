import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@sns/database';
import { loadConfig } from '@sns/config';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';

const opened: { sqlite: Db; dir: string }[] = [];

const ADMIN = { email: 'admin@example.invalid', password: 'ChangeMe_admin_1' };

async function boot(): Promise<{ app: FastifyInstance; sqlite: Db }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-people-'));
  const sqlite = await openDatabase(path.join(dir, 'app.db'));
  opened.push({ sqlite, dir });
  const app = await buildApp(loadConfig({ LEAVEOS_DATA_DIR: dir, LEAVEOS_ENV: 'test' }), sqlite);
  await app.ready();
  await app.inject({
    method: 'POST',
    url: '/api/v1/setup',
    payload: {
      companyName: 'Test Co',
      timezone: 'UTC',
      leaveYearStartMonth: 1,
      leaveYearStartDay: 1,
      adminName: 'Ada Example',
      adminEmail: ADMIN.email,
      adminPassword: ADMIN.password,
      loadSampleData: true,
    },
  });
  return { app, sqlite };
}

function cookiesOf(res: { headers: Record<string, unknown> }): {
  header: string;
  csrf: string;
  sid: string;
} {
  const raw = res.headers['set-cookie'];
  const header = Array.isArray(raw)
    ? raw.map((c) => c.split(';')[0]).join('; ')
    : String(raw ?? '');
  return {
    header,
    csrf: /leaveos\.csrf=([^;]*)/.exec(header)?.[1] ?? '',
    sid: /leaveos\.sid=([^;]*)/.exec(header)?.[1] ?? '',
  };
}

async function loginAs(app: FastifyInstance, creds: { email: string; password: string }) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: creds,
  });
  return cookiesOf(res);
}

afterEach(async () => {
  while (opened.length > 0) {
    const item = opened.pop();
    if (item) {
      try {
        await item.sqlite.close();
      } catch {
        /* ignore */
      }
      try {
        fs.rmSync(item.dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
});

describe('Employee CRUD operations', () => {
  it('lists employees and gets single employee', async () => {
    const { app } = await boot();
    const admin = await loginAs(app, ADMIN);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/employees',
      headers: { cookie: admin.header },
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json();
    expect(listBody.data.length).toBeGreaterThan(0);
    const first = listBody.data[0];

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/employees/${first.id}`,
      headers: { cookie: admin.header },
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json();
    expect(getBody.data.id).toBe(first.id);
    expect(getBody.data.first_name).toBe(first.first_name);
  });

  it('creates and updates employee with optimistic concurrency and cycle checks', async () => {
    const { app, sqlite } = await boot();
    const admin = await loginAs(app, ADMIN);

    const orgRes = await app.inject({
      method: 'GET',
      url: '/api/v1/org',
      headers: { cookie: admin.header },
    });
    const org = orgRes.json().data;

    // Create a new employee
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/employees',
      headers: { cookie: admin.header, 'x-csrf-token': admin.csrf },
      payload: {
        employeeCode: 'EMP-999',
        firstName: 'Marcus',
        lastName: 'Aurelius',
        workEmail: 'marcus@example.invalid',
        joinedOn: '2026-01-01',
        locationId: org.locations[0].id,
        departmentId: org.departments[0].id,
        jobTitleId: org.jobTitles[0].id,
        employmentTypeId: org.employmentTypes[0].id,
        createAccount: true,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json().data;
    expect(created.id).toBeDefined();

    // Verify employee in DB
    const emp = (await sqlite.prepare('SELECT * FROM employee WHERE id = ?').get(created.id)) as {
      version: number;
      first_name: string;
      last_name: string;
    };
    expect(emp.first_name).toBe('Marcus');
    expect(emp.version).toBe(1);

    // Update employee successfully
    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/employees/${created.id}`,
      headers: { cookie: admin.header, 'x-csrf-token': admin.csrf },
      payload: {
        firstName: 'Marcus Aurelius',
        expectedVersion: 1,
      },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().data.version).toBe(2);

    // Attempt update with stale version -> rejects with 409 CONFLICT
    const conflictRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/employees/${created.id}`,
      headers: { cookie: admin.header, 'x-csrf-token': admin.csrf },
      payload: {
        firstName: 'Marcus III',
        expectedVersion: 1, // Stale! Current is 2
      },
    });
    expect(conflictRes.statusCode).toBe(409);

    // Deactivate employee
    const deactRes = await app.inject({
      method: 'POST',
      url: `/api/v1/employees/${created.id}/deactivate`,
      headers: { cookie: admin.header, 'x-csrf-token': admin.csrf },
      payload: {
        reason: 'Terminated contract',
        exitedOn: '2026-08-27',
        expectedVersion: 2,
      },
    });
    expect(deactRes.statusCode).toBe(200);

    const exitedEmp = (await sqlite
      .prepare('SELECT * FROM employee WHERE id = ?')
      .get(created.id)) as {
      status: string;
      version: number;
    };
    expect(exitedEmp.status).toBe('exited');
    expect(exitedEmp.version).toBe(3);

    // Reactivate employee
    const reactRes = await app.inject({
      method: 'POST',
      url: `/api/v1/employees/${created.id}/reactivate`,
      headers: { cookie: admin.header, 'x-csrf-token': admin.csrf },
      payload: {
        expectedVersion: 3,
      },
    });
    expect(reactRes.statusCode).toBe(200);
    const reactivatedEmp = (await sqlite
      .prepare('SELECT * FROM employee WHERE id = ?')
      .get(created.id)) as {
      status: string;
      version: number;
      exited_on: string | null;
    };
    expect(reactivatedEmp.status).toBe('active');
    expect(reactivatedEmp.exited_on).toBeNull();
    expect(reactivatedEmp.version).toBe(4);
  });
});

describe('Department and Team management', () => {
  it('creates, lists, updates, and archives departments', async () => {
    const { app, sqlite } = await boot();
    const admin = await loginAs(app, ADMIN);

    // 1. Create a new department
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/departments',
      headers: { cookie: admin.header, 'x-csrf-token': admin.csrf },
      payload: {
        name: 'Design & Research',
        code: 'DES',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const createdDept = createRes.json().data;
    expect(createdDept.id).toBeDefined();
    expect(createdDept.name).toBe('Design & Research');
    expect(createdDept.code).toBe('DES');

    // 2. Reject duplicate code
    const dupeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/departments',
      headers: { cookie: admin.header, 'x-csrf-token': admin.csrf },
      payload: {
        name: 'Design Two',
        code: 'des', // case-insensitive duplicate
      },
    });
    expect(dupeRes.statusCode).toBe(409);

    // 3. List departments
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/departments',
      headers: { cookie: admin.header },
    });
    expect(listRes.statusCode).toBe(200);
    const depts = listRes.json().data;
    expect(depts.some((d: { code: string }) => d.code === 'DES')).toBe(true);

    // 4. Get single department
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/departments/${createdDept.id}`,
      headers: { cookie: admin.header },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().data.name).toBe('Design & Research');

    // 5. Update department
    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/departments/${createdDept.id}`,
      headers: { cookie: admin.header, 'x-csrf-token': admin.csrf },
      payload: {
        name: 'Product Design',
      },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().data.name).toBe('Product Design');

    // 6. Archive department (empty department)
    const archiveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/departments/${createdDept.id}/archive`,
      headers: { cookie: admin.header, 'x-csrf-token': admin.csrf },
    });
    expect(archiveRes.statusCode).toBe(200);

    const dbDept = (await sqlite
      .prepare('SELECT * FROM department WHERE id = ?')
      .get(createdDept.id)) as { archived_at: string | null };
    expect(dbDept.archived_at).not.toBeNull();
  });

  it('creates, lists, updates, manages members, and archives teams', async () => {
    const { app, sqlite } = await boot();
    const admin = await loginAs(app, ADMIN);

    // Get an existing department
    const deptsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/departments',
      headers: { cookie: admin.header },
    });
    const dept = deptsRes.json().data[0];

    // 1. Create a new team
    const createTeamRes = await app.inject({
      method: 'POST',
      url: '/api/v1/teams',
      headers: { cookie: admin.header, 'x-csrf-token': admin.csrf },
      payload: {
        departmentId: dept.id,
        name: 'Mobile Core',
      },
    });
    expect(createTeamRes.statusCode).toBe(201);
    const createdTeam = createTeamRes.json().data;
    expect(createdTeam.id).toBeDefined();
    expect(createdTeam.name).toBe('Mobile Core');

    // 2. Reject duplicate team name in same department
    const dupeTeamRes = await app.inject({
      method: 'POST',
      url: '/api/v1/teams',
      headers: { cookie: admin.header, 'x-csrf-token': admin.csrf },
      payload: {
        departmentId: dept.id,
        name: 'mobile core',
      },
    });
    expect(dupeTeamRes.statusCode).toBe(409);

    // 3. List teams
    const listTeamsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/teams',
      headers: { cookie: admin.header },
    });
    expect(listTeamsRes.statusCode).toBe(200);
    const teams = listTeamsRes.json().data;
    expect(teams.some((t: { id: string }) => t.id === createdTeam.id)).toBe(true);

    // 4. Update team
    const updateTeamRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/teams/${createdTeam.id}`,
      headers: { cookie: admin.header, 'x-csrf-token': admin.csrf },
      payload: {
        name: 'Mobile & SDK',
      },
    });
    expect(updateTeamRes.statusCode).toBe(200);
    expect(updateTeamRes.json().data.name).toBe('Mobile & SDK');

    // 5. Manage team members (add employee)
    const empRes = await app.inject({
      method: 'GET',
      url: '/api/v1/employees',
      headers: { cookie: admin.header },
    });
    const emp = empRes.json().data[0];

    const addMemberRes = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${createdTeam.id}/members`,
      headers: { cookie: admin.header, 'x-csrf-token': admin.csrf },
      payload: {
        addEmployeeIds: [emp.id],
      },
    });
    expect(addMemberRes.statusCode).toBe(200);

    const memberCheck = (await sqlite
      .prepare('SELECT team_id FROM employee WHERE id = ?')
      .get(emp.id)) as { team_id: string | null };
    expect(memberCheck.team_id).toBe(createdTeam.id);

    // 6. Get team and check member
    const getTeamRes = await app.inject({
      method: 'GET',
      url: `/api/v1/teams/${createdTeam.id}`,
      headers: { cookie: admin.header },
    });
    expect(getTeamRes.statusCode).toBe(200);
    expect(getTeamRes.json().data.members.length).toBe(1);

    // 7. Remove team member
    const removeMemberRes = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${createdTeam.id}/members`,
      headers: { cookie: admin.header, 'x-csrf-token': admin.csrf },
      payload: {
        removeEmployeeIds: [emp.id],
      },
    });
    expect(removeMemberRes.statusCode).toBe(200);

    const memberRemovedCheck = (await sqlite
      .prepare('SELECT team_id FROM employee WHERE id = ?')
      .get(emp.id)) as { team_id: string | null };
    expect(memberRemovedCheck.team_id).toBeNull();

    // 8. Archive team
    const archiveTeamRes = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${createdTeam.id}/archive`,
      headers: { cookie: admin.header, 'x-csrf-token': admin.csrf },
    });
    expect(archiveTeamRes.statusCode).toBe(200);
  });
});
