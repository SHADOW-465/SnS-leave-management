import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Page } from '@playwright/test';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server');

export type TestServer = { url: string; pid: number; dataDir: string; stop: () => Promise<void> };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      s.close(() => resolve(typeof addr === 'object' && addr ? addr.port : 0));
    });
  });
}

/**
 * Starts the real server on loopback over HTTP with its own throwaway data folder, serving
 * the built web app. `LEAVEOS_ENV=test` keeps it away from Windows services, mDNS, and the
 * port-80 setup page. Nothing here reads or writes the developer's `./data`.
 */
export async function startServer(env: Record<string, string> = {}): Promise<TestServer> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'leaveos-e2e-'));
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: serverDir,
    env: {
      ...process.env,
      LEAVEOS_ENV: 'test',
      LEAVEOS_HOST: '127.0.0.1',
      LEAVEOS_PORT: String(port),
      LEAVEOS_BIND_ALL: 'false',
      LEAVEOS_TLS_ENABLED: 'false',
      LEAVEOS_DATA_DIR: dataDir,
      LEAVEOS_DEMO_ACCOUNTS: 'false',
      LEAVEOS_SEED_DEMO: 'false',
      LEAVEOS_ENFORCE_WORKSTATION: 'false',
      ...env,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
  const exited = new Promise<void>((r) => child.once('exit', () => r()));
  const url = `http://127.0.0.1:${port}`;
  const stop = async () => {
    // Only the PID this helper started is stopped.
    if (child.exitCode === null && child.pid) process.kill(child.pid);
    await exited;
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`Server exited early:\n${stderr}`);
    try {
      if ((await fetch(`${url}/healthz`)).ok) break;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`Server did not start:\n${stderr}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { url, pid: child.pid ?? 0, dataDir, stop };
}

/** A fresh server with only the first-run administrator, for tests that need their own clock or limits. */
export async function startBareServer(env: Record<string, string> = {}) {
  const server = await startServer(env);
  const res = await fetch(`${server.url}/api/v1/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      companyName: 'Example Co',
      timezone: 'Asia/Kolkata',
      leaveYearStartMonth: 1,
      leaveYearStartDay: 1,
      adminName: 'Ada Example',
      adminEmail: BARE_ADMIN.email,
      adminPassword: BARE_ADMIN.password,
    }),
  });
  if (!res.ok) {
    await server.stop();
    throw new Error(`Setup failed: ${res.status} ${await res.text()}`);
  }
  return server;
}

export const BARE_ADMIN = { email: 'ada@example.invalid', password: 'Example-admin-pass-1' };
export const DEMO_PASSWORD = 'ChangeMe_demo_1';
export const ADMIN = { email: 'admin@sns.test', password: 'ChangeMe_admin_1' };

/** Signs in through the form and waits until the app shell (or the forced password change) is up. */
export async function signIn(page: Page, login: string, password = DEMO_PASSWORD, base = '') {
  await page.goto(`${base}/`);
  await page.getByLabel('Username, email or employee ID').fill(login);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page
      .getByRole('button', { name: 'Sign out', exact: true })
      .or(page.getByRole('button', { name: 'Update password' }))
      .or(page.getByRole('alert')),
  ).toBeVisible();
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Leave OS' })).toBeVisible();
}

/** Today in the company time zone, the same "today" the server uses. */
function today(): Date {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  return new Date(`${iso}T00:00:00Z`);
}

/** Monday of the week `weeksAhead` weeks from now, as yyyy-mm-dd, plus `offset` days. */
export function weekday(weeksAhead: number, offset = 0): string {
  const d = today();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7) + 7 * (weeksAhead - 1) + offset);
  return d.toISOString().slice(0, 10);
}

/** Specs use this `test`: its base URL is the seeded server global-setup started. */
export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their arguments.
  baseURL: async ({}, use) => use(process.env.E2E_BASE_URL),
});

/** A request row in My requests or Approvals, picked by person and start date ("9 Nov 2026"). */
export function requestRow(page: Page, name: string, startIso: string) {
  const [y, m, d] = startIso.split('-').map(Number) as [number, number, number];
  const month = new Date(Date.UTC(y, m - 1, d)).toLocaleString('en-GB', {
    month: 'short',
    timeZone: 'UTC',
  });
  return page
    .getByRole('button', { name: `View details for ${name}` })
    .filter({ hasText: `${d} ${month}` });
}
