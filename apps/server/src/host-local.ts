import { spawnSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';

export function isLoopback(ip: string | undefined): boolean {
  const value = (ip ?? '').replace(/^::ffff:/i, '').toLowerCase();
  return value === '127.0.0.1' || value === '::1' || value === 'localhost';
}

/** First non-virtual IPv4 address colleagues on the office LAN can open. */
export function lanAddress(): string | null {
  const preferred: string[] = [];
  const other: string[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const virtual = /vEthernet|VirtualBox|Docker|WSL|Loopback|Hyper-V/i.test(name);
      (virtual ? other : preferred).push(addr.address);
    }
  }
  return preferred[0] ?? other[0] ?? null;
}

const SERVICE = 'LeaveOS';

export function serviceStatus(env: string): { state: string; detail: string } {
  if (env === 'test' || process.platform !== 'win32') {
    return {
      state: 'not-queried',
      detail: 'Windows service control is skipped in this environment.',
    };
  }
  const result = spawnSync('sc.exe', ['query', SERVICE], { encoding: 'utf8', windowsHide: true });
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  const state = /RUNNING/.test(text) ? 'running' : /STOPPED/.test(text) ? 'stopped' : 'unknown';
  return { state, detail: text.slice(0, 400) };
}

export function serviceControl(
  action: 'start' | 'stop' | 'restart',
  env: string,
): { ok: boolean; detail: string } {
  if (env === 'test' || process.platform !== 'win32') {
    return { ok: true, detail: `Recorded ${action}. Windows was not called.` };
  }
  const steps = action === 'restart' ? (['stop', 'start'] as const) : ([action] as const);
  const lines: string[] = [];
  let ok = true;
  for (const step of steps) {
    const result = spawnSync('sc.exe', [step, SERVICE], { encoding: 'utf8', windowsHide: true });
    const text = `${result.stdout ?? ''} ${result.stderr ?? ''}`.trim();
    lines.push(text);
    if ((result.status ?? 1) !== 0 && !/\b(1056|1062)\b/.test(text)) ok = false;
  }
  return { ok, detail: lines.join(' ').slice(0, 400) || action };
}
