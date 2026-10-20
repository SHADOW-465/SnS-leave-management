import { describe, expect, it } from 'vitest';
import { stripLeadingZeros } from './number-input.js';

describe('stripLeadingZeros', () => {
  it('turns 012 into 12, so typing 12 over a 0 gives 12', () => {
    expect(stripLeadingZeros('012')).toBe('12');
    expect(stripLeadingZeros('0012')).toBe('12');
    expect(stripLeadingZeros('-007')).toBe('-7');
  });
  it('leaves valid numbers alone', () => {
    for (const v of ['', '0', '12', '0.5', '10', '-0.5', '100'])
      expect(stripLeadingZeros(v)).toBe(v);
  });
});
