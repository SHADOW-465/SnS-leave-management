import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { parseAcMinutes, defaultBackupDir } = createRequire(import.meta.url)(
  '../../../installer/prepare-host.cjs',
) as {
  parseAcMinutes: (text: string) => number | null;
  defaultBackupDir: (programData: string) => string;
};

describe('office host preparation', () => {
  it('reads the plugged-in sleep timeout in minutes', () => {
    const sample = `
      Power Setting GUID: 29f6c1db-86da-48c5-9fdb-f2b67b1f44da  (Sleep after)
      Current AC Power Setting Index: 0x00000708
      Current DC Power Setting Index: 0x00000384
    `;
    expect(parseAcMinutes(sample)).toBe(30);
    expect(parseAcMinutes('Current AC Power Setting Index: 0x00000000')).toBe(0);
    expect(parseAcMinutes('no index here')).toBeNull();
  });

  it('keeps backups under ProgramData', () => {
    expect(defaultBackupDir('C:\\ProgramData')).toBe(
      'C:\\ProgramData\\SimonAndSons\\LeaveOS\\backups',
    );
  });
});
