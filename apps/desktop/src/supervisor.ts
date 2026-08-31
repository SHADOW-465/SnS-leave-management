import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, pathsFor } from '@sns/config';

/**
 * Process supervisor. Closing a terminal with Ctrl+C stops this supervisor;
 * operators should run it as a Windows service or via the future Electron
 * control panel (unsigned installer is deferred — D-19 / DW-14).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const dirs = pathsFor(config);

let child: ChildProcess | null = null;
let restarts = 0;
let windowStart = Date.now();
let stopping = false;

function start() {
  if (stopping) return;
  const serverEntry = path.resolve(here, '../../server/src/index.ts');
  child = spawn(process.execPath, ['--import', 'tsx', serverEntry], {
    stdio: 'inherit',
    env: { ...process.env },
    cwd: path.resolve(here, '../../..'),
  });
  child.on('exit', (code) => {
    child = null;
    if (stopping) return;
    const now = Date.now();
    if (now - windowStart > 10 * 60_000) {
      windowStart = now;
      restarts = 0;
    }
    restarts += 1;
    if (restarts > 5) {
      process.stderr.write(
        `Leave OS server exited (code ${code}) more than 5 times in 10 minutes. Staying down.\n`,
      );
      process.exit(1);
    }
    const delay = [1000, 5000, 15000, 60000][Math.min(restarts - 1, 3)] ?? 60000;
    setTimeout(start, delay);
  });
}

process.on('SIGINT', () => {
  stopping = true;
  child?.kill('SIGINT');
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopping = true;
  child?.kill('SIGTERM');
  process.exit(0);
});

process.stdout.write(
  `Leave OS supervisor. Data dir: ${dirs.root}. Window close of any UI must not stop this process.\n`,
);
start();
