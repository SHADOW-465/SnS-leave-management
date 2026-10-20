import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** OWASP minimum Argon2id. Recalibrate on the real host (DW-15). */
export const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
  algorithm: 2 as const,
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  try {
    return await verify(hashValue, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function csrfEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function lockoutDelayMs(failedAttempts: number): number {
  const steps = [250, 500, 1000, 2000];
  if (failedAttempts <= 0) return 0;
  return steps[Math.min(failedAttempts - 1, steps.length - 1)] ?? 2000;
}

export function lockUntil(failedAttempts: number, now = Date.now()): string | null {
  if (failedAttempts < 5) return null;
  return new Date(now + 15 * 60 * 1000).toISOString();
}

/**
 * A fresh random first password, one per account, shown once to the administrator. No two
 * accounts ever share one, and the person must change it at first sign-in.
 */
export function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%';
  let out = '';
  for (let i = 0; i < 16; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export function sha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}
