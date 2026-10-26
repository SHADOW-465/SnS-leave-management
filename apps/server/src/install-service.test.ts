import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const {
  serviceStateFromStatus,
  nextRunningWait,
  wrapperAlreadyPresent,
  serviceAlreadyStarted,
  serviceLogDir,
  recoveryArgs,
  isAutoStart,
  restartsOnFailure,
  firewallRuleArgs,
  firewallDeleteArgs,
  dataAclArgs,
} = createRequire(import.meta.url)('../../../installer/install-service.cjs') as {
  serviceStateFromStatus: (text: string) => string;
  nextRunningWait: (
    text: string,
    stoppedPolls: number,
  ) => { done: boolean; ok: boolean; stoppedPolls: number };
  wrapperAlreadyPresent: (text: string) => boolean;
  serviceAlreadyStarted: (text: string) => boolean;
  serviceLogDir: () => string;
  recoveryArgs: () => { failure: string[]; failureFlag: string[]; start: string[] };
  isAutoStart: (text: string) => boolean;
  restartsOnFailure: (text: string) => boolean;
  firewallRuleArgs: (name: string, protocol: string, port: string) => string[];
  firewallDeleteArgs: (name: string) => string[];
  dataAclArgs: (dir: string) => string[];
};

describe('WinSW service registration', () => {
  it('treats Running as ready and stops waiting after repeated Stopped', () => {
    expect(serviceStateFromStatus('Running\r\n')).toBe('running');
    expect(serviceStateFromStatus('StartPending')).toBe('start-pending');
    expect(serviceStateFromStatus('Stopped')).toBe('stopped');
    expect(serviceStateFromStatus('NonExistent')).toBe('missing');
    expect(nextRunningWait('Running', 2)).toEqual({ done: true, ok: true, stoppedPolls: 0 });
    // WinSW v2 (the bundled wrapper) reports a live service as Started.
    expect(nextRunningWait('Started', 0)).toEqual({ done: true, ok: true, stoppedPolls: 0 });
    expect(nextRunningWait('StartPending', 2).done).toBe(false);
    expect(nextRunningWait('Stopped', 0)).toEqual({ done: false, ok: false, stoppedPolls: 1 });
    expect(nextRunningWait('Stopped', 2)).toEqual({ done: true, ok: false, stoppedPolls: 3 });
    expect(nextRunningWait('NonExistent', 2).ok).toBe(false);
  });

  it('recognises a service that is already installed or started', () => {
    expect(wrapperAlreadyPresent('The specified service already exists.')).toBe(true);
    expect(wrapperAlreadyPresent('Access is denied.')).toBe(false);
    expect(serviceAlreadyStarted('An instance of the service is already running')).toBe(true);
    expect(serviceAlreadyStarted('error 1056')).toBe(true);
    expect(serviceAlreadyStarted('The service did not respond')).toBe(false);
    expect(serviceLogDir().replaceAll('/', '\\')).toContain('\\SimonAndSons\\LeaveOS\\logs');
  });

  it('sets automatic start and restart on failure, and checks it took', () => {
    const args = recoveryArgs();
    expect(args.start).toEqual(['config', 'LeaveOS', 'start=', 'auto']);
    expect(args.failure.join(' ')).toContain('actions= restart/5000/restart/15000/restart/60000');
    expect(args.failureFlag).toEqual(['failureflag', 'LeaveOS', '1']);
    expect(isAutoStart('        START_TYPE         : 2   AUTO_START')).toBe(true);
    expect(isAutoStart('        START_TYPE         : 2   AUTO_START  (DELAYED)')).toBe(false);
    expect(isAutoStart('        START_TYPE         : 3   DEMAND_START')).toBe(false);
    const good = 'RESTART RESTART RESTART';
    expect(restartsOnFailure(good)).toBe(true);
    expect(restartsOnFailure('FAILURE_ACTIONS : NONE')).toBe(false);
  });

  it('declares automatic start and restart actions in the service definition', () => {
    const xml = readFileSync(
      new URL('../../../installer/LeaveOS-service.xml', import.meta.url),
      'utf8',
    );
    expect(xml).toContain('<startmode>Automatic</startmode>');
    expect((xml.match(/<onfailure action="restart"/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('firewall rules', () => {
  it('accept only the local subnet, on any profile so a Public office network still works', () => {
    const args = firewallRuleArgs('Leave OS', 'TCP', '8443');
    expect(args).toContain('profile=any');
    expect(args).toContain('remoteip=localsubnet');
    expect(args).toContain('name=Leave OS');
    expect(args).toContain('localport=8443');
  });

  it('delete the old rule by the same name before adding', () => {
    expect(firewallDeleteArgs('Leave OS')).toEqual([
      'advfirewall',
      'firewall',
      'delete',
      'rule',
      'name=Leave OS',
    ]);
  });
});

describe('data folder ACL (DW-123)', () => {
  it('grants only SYSTEM and Administrators and drops inherited Users access', () => {
    const args = dataAclArgs('C:\\ProgramData\\SimonAndSons\\LeaveOS');
    expect(args).toContain('/inheritance:r');
    expect(args).toContain('*S-1-5-18:(OI)(CI)F');
    expect(args).toContain('*S-1-5-32-544:(OI)(CI)F');
    expect(args.join(' ')).not.toMatch(/S-1-5-32-545|Users|Everyone/i);
    // /T would strip inheritance from every file and lock SYSTEM out of the database.
    expect(args).not.toContain('/T');
  });
});
