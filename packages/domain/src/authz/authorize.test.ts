import { describe, expect, it } from 'vitest';
import { assertNoManagerCycle, collectReports, permissionsForRoles } from './authorize.js';
import { ROLE_PERMISSIONS } from './roles.js';

describe('RBAC', () => {
  it('does not grant managers approve', () => {
    const perms = permissionsForRoles(['manager']);
    expect(perms.some((p) => p.startsWith('leave.request.approve'))).toBe(false);
    expect(ROLE_PERMISSIONS.hr_officer.some((p) => p.startsWith('leave.request.approve'))).toBe(
      true,
    );
  });

  it('resolves direct vs recursive reports on a three-level tree', () => {
    const employees = [
      { id: 'a', managerEmployeeId: null, locationId: 'l', departmentId: 'd', teamId: 't' },
      { id: 'b', managerEmployeeId: 'a', locationId: 'l', departmentId: 'd', teamId: 't' },
      { id: 'c', managerEmployeeId: 'b', locationId: 'l', departmentId: 'd', teamId: 't' },
    ];
    const { reports, recursiveReports } = collectReports(employees, 'a');
    expect([...reports]).toEqual(['b']);
    expect(recursiveReports.has('b')).toBe(true);
    expect(recursiveReports.has('c')).toBe(true);
  });

  it('handles a manager with no reports', () => {
    const { reports, recursiveReports } = collectReports(
      [{ id: 'a', managerEmployeeId: null, locationId: null, departmentId: null, teamId: null }],
      'a',
    );
    expect(reports.size).toBe(0);
    expect(recursiveReports.size).toBe(0);
  });

  it('rejects an employee as their own manager', () => {
    expect(() => assertNoManagerCycle([{ id: 'a', managerEmployeeId: null }], 'a', 'a')).toThrow(
      /own manager/,
    );
  });

  it('rejects a cycle', () => {
    expect(() =>
      assertNoManagerCycle(
        [
          { id: 'a', managerEmployeeId: 'c' },
          { id: 'b', managerEmployeeId: 'a' },
          { id: 'c', managerEmployeeId: 'b' },
        ],
        'c',
        'b',
      ),
    ).toThrow(/cycle/);
  });
});
