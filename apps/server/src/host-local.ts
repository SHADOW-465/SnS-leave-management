import { spawnSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';

export function isLoopback(ip: string | undefined): boolean {
  const value = (ip ?? '').replace(/^::ffff:/i, '').toLowerCase();
  return value === '127.0.0.1' || value === '::1' || value === 'localhost';
}

function isUsefulLanIp(address: string): boolean {
  return !address.startsWith('169.254.');
}

/** Non-virtual IPv4 addresses first, then virtual adapters. Link-local addresses are skipped. */
export function lanAddresses(): string[] {
  const preferred: string[] = [];
  const other: string[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal || !isUsefulLanIp(addr.address)) continue;
      const virtual = /vEthernet|VirtualBox|Docker|WSL|Loopback|Hyper-V/i.test(name);
      (virtual ? other : preferred).push(addr.address);
    }
  }
  return [...new Set([...preferred, ...other])];
}

/** First non-virtual IPv4 address colleagues on the office LAN can open. */
export function lanAddress(): string | null {
  return lanAddresses()[0] ?? null;
}

const SERVICE = 'LeaveOS';

export function serviceHeadline(state: string): string {
  if (state === 'running') return 'Running';
  if (state === 'stopped') return 'Stopped';
  if (state === 'not-queried') return 'Not queried';
  return 'Unknown';
}

export function serviceStatus(env: string): { state: string; detail: string; label: string } {
  if (env === 'test' || process.platform !== 'win32') {
    return {
      state: 'not-queried',
      label: serviceHeadline('not-queried'),
      detail: 'Windows service control is skipped in this environment.',
    };
  }
  const result = spawnSync('sc.exe', ['query', SERVICE], { encoding: 'utf8', windowsHide: true });
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  const state = /RUNNING/.test(text) ? 'running' : /STOPPED/.test(text) ? 'stopped' : 'unknown';
  return { state, label: serviceHeadline(state), detail: text.slice(0, 400) };
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
