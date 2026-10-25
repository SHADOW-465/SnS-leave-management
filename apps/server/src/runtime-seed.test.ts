import { describe, expect, it } from 'vitest';
import { shouldAutoSeed } from './runtime.js';

describe('preview seed freeze', () => {
  it('does not seed a hosted deploy, and still seeds an empty local database when asked', () => {
    expect(shouldAutoSeed({ seedOnEmpty: true, hostedPreview: true })).toBe(false);
    expect(shouldAutoSeed({ seedOnEmpty: false, hostedPreview: true })).toBe(false);
    expect(shouldAutoSeed({ seedOnEmpty: true, hostedPreview: false })).toBe(true);
    expect(shouldAutoSeed({ seedOnEmpty: false, hostedPreview: false })).toBe(false);
    expect(shouldAutoSeed({ seedOnEmpty: true, hostedPreview: false, dialect: 'postgres' })).toBe(
      false,
    );
  });
});
