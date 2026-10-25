import { describe, expect, it } from 'vitest';
import { canEditRoleSet, roleChoiceLocked } from './role-choices.js';

describe('role checkboxes on Users & access', () => {
  it('lets an administrator choose every role, including administrator and director', () => {
    for (const code of [
      'employee',
      'manager',
      'hr_officer',
      'payroll_officer',
      'auditor',
      'admin',
      'director',
    ]) {
      expect(roleChoiceLocked(true, code)).toBe(false);
    }
    expect(canEditRoleSet(true, ['admin'])).toBe(true);
    expect(canEditRoleSet(true, ['director'])).toBe(true);
  });

  it('stops HR and every other non-administrator from granting administrator or director', () => {
    expect(roleChoiceLocked(false, 'admin')).toBe(true);
    expect(roleChoiceLocked(false, 'director')).toBe(true);
    expect(roleChoiceLocked(false, 'employee')).toBe(false);
    expect(roleChoiceLocked(false, 'hr_officer')).toBe(false);
    expect(canEditRoleSet(false, ['employee'])).toBe(true);
    expect(canEditRoleSet(false, ['admin'])).toBe(false);
    expect(canEditRoleSet(false, ['hr_officer', 'director'])).toBe(false);
  });
});
