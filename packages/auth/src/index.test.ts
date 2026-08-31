import { describe, expect, it } from 'vitest';
import {
  csrfEqual,
  generateTemporaryPassword,
  hashPassword,
  hashToken,
  lockUntil,
  lockoutDelayMs,
  newSessionToken,
  verifyPassword,
} from './index.js';

describe('auth primitives', () => {
  it('hashes and verifies Argon2id', async () => {
    const h = await hashPassword('correct-horse-battery');
    expect(await verifyPassword(h, 'correct-horse-battery')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
  });

  it('stores only the hash of a session token', () => {
    const { token, tokenHash } = newSessionToken();
    expect(tokenHash).toBe(hashToken(token));
    expect(tokenHash).not.toBe(token);
  });

  it('compares CSRF tokens in constant time', () => {
    const t = 'a'.repeat(32);
    expect(csrfEqual(t, t)).toBe(true);
    expect(csrfEqual(t, 'b'.repeat(32))).toBe(false);
  });

  it('locks after 5 failures', () => {
    expect(lockUntil(4)).toBeNull();
    expect(lockUntil(5)).not.toBeNull();
    expect(lockoutDelayMs(1)).toBe(250);
    expect(lockoutDelayMs(4)).toBe(2000);
  });

  it('generates a strong temporary password', () => {
    expect(generateTemporaryPassword().length).toBeGreaterThanOrEqual(12);
  });
});
