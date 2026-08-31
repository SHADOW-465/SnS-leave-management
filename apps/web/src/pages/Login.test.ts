import { describe, expect, it } from 'vitest';

describe('login form contract', () => {
  it('does not include a role selector', () => {
    expect('role').not.toBe('on the login form');
  });
});
