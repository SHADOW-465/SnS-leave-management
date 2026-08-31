import { describe, expect, it } from 'vitest';
import { can, type Me } from './api.js';

describe('permission courtesy checks', () => {
  it('hides approve for employees', () => {
    const me = {
      permissions: ['leave.request.create:self'],
    } as Me;
    expect(can(me, 'leave.request.approve')).toBe(false);
  });

  it('hides company employee directory and management actions for employees', () => {
    const empMe = {
      permissions: [
        'employee.read:self',
        'employee.update:self',
        'leave.request.create:self',
        'leave.request.read:self',
      ],
    } as Me;
    expect(can(empMe, 'employee.read:company')).toBe(false);
    expect(can(empMe, 'employee.create:company')).toBe(false);
    expect(can(empMe, 'employee.update:company')).toBe(false);
    expect(can(empMe, 'employee.archive:company')).toBe(false);

    const hrMe = {
      permissions: [
        'employee.read:company',
        'employee.create:company',
        'employee.update:company',
        'employee.archive:company',
      ],
    } as Me;
    expect(can(hrMe, 'employee.read:company')).toBe(true);
    expect(can(hrMe, 'employee.create:company')).toBe(true);
    expect(can(hrMe, 'employee.update:company')).toBe(true);
    expect(can(hrMe, 'employee.archive:company')).toBe(true);
  });
});
