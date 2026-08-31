import { describe, expect, it } from 'vitest';
import { errorEnvelopeSchema } from './envelope.js';
import { loginBodySchema } from './auth.js';

describe('contracts', () => {
  it('rejects unknown keys', () => {
    const parsed = loginBodySchema.safeParse({
      email: 'a@example.invalid',
      password: 'x',
      role: 'admin',
    });
    expect(parsed.success).toBe(false);
  });

  it('parses the error envelope', () => {
    const parsed = errorEnvelopeSchema.parse({
      error: { code: 'FORBIDDEN', message: 'No.', requestId: '01TEST' },
    });
    expect(parsed.error.code).toBe('FORBIDDEN');
  });
});
