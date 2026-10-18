import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const {
  serviceStateFromStatus,
  nextRunningWait,
  wrapperAlreadyPresent,
  serviceAlreadyStarted,
  serviceLogDir,
} = createRequire(import.meta.url)('../../../installer/install-service.cjs') as {
  serviceStateFromStatus: (text: string) => string;
  nextRunningWait: (
    text: string,
    stoppedPolls: number,
  ) => { done: boolean; ok: boolean; stoppedPolls: number };
  wrapperAlreadyPresent: (text: string) => boolean;
  serviceAlreadyStarted: (text: string) => boolean;
  serviceLogDir: () => string;
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
});
