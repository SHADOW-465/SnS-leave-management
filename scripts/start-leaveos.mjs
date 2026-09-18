#!/usr/bin/env node
/**
 * One-command start for the office host.
 *
 * Binds to the LAN, prints the URL colleagues should use, and opens it locally.
 * This is deliberately a plain Node process, not a desktop app: the thing that has to
 * be reliable is the *server*, and every user (including the host) already has a
 * perfectly good client — their browser.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

/**
 * tsx is a dependency of the server package, not the workspace root, so resolve it
 * from there rather than assuming it is hoisted.
 */
function resolveTsx() {
  for (const from of [path.join(repoRoot, 'apps/server/package.json'), import.meta.url]) {
    try {
      // The package's "." export is the loader `--import tsx` would use. Resolve it by
      // hand because tsx is installed under the server package, not hoisted to the root.
      const pkg = createRequire(from).resolve('tsx/package.json');
      return pathToFileURL(path.join(path.dirname(pkg), 'dist', 'loader.mjs')).href;
    } catch {
      /* try the next resolution root */
    }
  }
  return null;
}

/** First non-internal IPv4 address — the one colleagues can actually reach. */
function lanAddress() {
  const preferred = [];
  const other = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      // Virtual adapters (WSL, Docker, VirtualBox, Hyper-V) are not reachable from
      // other machines on the office network, so rank them last.
      const virtual = /vEthernet|VirtualBox|Docker|WSL|Loopback|Hyper-V/i.test(name);
      (virtual ? other : preferred).push(a.address);
    }
  }
  return preferred[0] ?? other[0] ?? null;
}

function loadDotEnv(file = path.join(repoRoot, '.env')) {
  if (!existsSync(file)) return {};
  const res = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    res[key] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
  }
  return res;
}

const dotEnv = loadDotEnv();
const envName =
  process.env.LEAVEOS_ENV ??
  dotEnv.LEAVEOS_ENV ??
  (process.env.NODE_ENV === 'production' ? 'production' : 'development');
const isProduction = envName === 'production';

const port = Number(process.env.LEAVEOS_PORT ?? dotEnv.LEAVEOS_PORT ?? 3000);
const ip = lanAddress();

const env = {
  ...dotEnv,
  ...process.env,
  LEAVEOS_ENV: envName,
  LEAVEOS_PORT: String(port),
  LEAVEOS_DEMO_ACCOUNTS: isProduction
    ? 'false'
    : (process.env.LEAVEOS_DEMO_ACCOUNTS ?? dotEnv.LEAVEOS_DEMO_ACCOUNTS ?? 'true'),
  LEAVEOS_ENFORCE_WORKSTATION: isProduction ? 'true' : 'false',
  // Listen on every interface so other machines can connect. Without this the server
  // answers only on 127.0.0.1 and nobody else on the network can reach it.
  LEAVEOS_BIND_ALL: process.env.LEAVEOS_BIND_ALL ?? dotEnv.LEAVEOS_BIND_ALL ?? 'true',
  LEAVEOS_PUBLIC_URL:
    process.env.LEAVEOS_PUBLIC_URL ??
    dotEnv.LEAVEOS_PUBLIC_URL ??
    `http://${ip ?? 'localhost'}:${port}`,
};

const line = '─'.repeat(58);
console.log(`\n${line}`);
console.log('  Simon & Sons Leave OS');
console.log(line);
if (ip) {
  console.log(`  Staff on this network open:   http://${ip}:${port}`);
} else {
  console.log('  No network address found. This computer may be offline.');
  console.log('  Only this machine can reach it:  http://localhost:' + port);
}
console.log(`  On this computer:             http://localhost:${port}`);
console.log(line);
console.log('  Leave this window open. Closing it stops Leave OS for everyone.');
console.log(`${line}\n`);

const tsx = resolveTsx();
if (!tsx) {
  console.error('Could not find tsx. Run "pnpm install" in this folder first.\n');
  process.exit(1);
}

const child = spawn(
  process.execPath,
  ['--import', tsx, path.join(repoRoot, 'apps/server/src/index.ts')],
  { stdio: 'inherit', cwd: repoRoot, env },
);

// Give the server a moment to bind before opening a browser at it.
setTimeout(() => {
  const url = `http://localhost:${port}`;
  const opener =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref();
}, 2500);

function stop(signal) {
  child.kill(signal);
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
child.on('exit', (code) => process.exit(code ?? 0));
