#!/usr/bin/env node
/**
 * Installs Leave OS as a Windows Service so it behaves like an appliance rather than a
 * program somebody has to remember to start.
 *
 * A service starts at boot before anyone logs in, keeps running when the host user logs
 * out, restarts itself if it crashes, and cannot be closed by accident — which is the
 * whole reason not to ship this as a desktop application.
 *
 *   node scripts/service.mjs install     (needs an administrator prompt)
 *   node scripts/service.mjs status
 *   node scripts/service.mjs start | stop | restart
 *   node scripts/service.mjs uninstall
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const SERVICE = 'LeaveOS';
const DISPLAY = 'Simon & Sons Leave OS';

if (process.platform !== 'win32') {
  console.error('This installer is for Windows. On Linux or macOS use a systemd or launchd unit.');
  process.exit(1);
}

const action = (process.argv[2] ?? 'status').toLowerCase();

function sc(...args) {
  return spawnSync('sc.exe', args, { encoding: 'utf8' });
}

function isAdministrator() {
  // `sc query` on a privileged service fails with access denied for a normal user.
  const probe = spawnSync('net.exe', ['session'], { encoding: 'utf8' });
  return probe.status === 0;
}

function requireAdministrator() {
  if (isAdministrator()) return;
  console.error(
    [
      '',
      'This step needs administrator rights.',
      '',
      '  1. Press the Windows key and type: powershell',
      '  2. Right-click "Windows PowerShell" and choose "Run as administrator"',
      '  3. Type:  cd "' + repoRoot + '"',
      `  4. Type:  node scripts/service.mjs ${action}`,
      '',
    ].join('\n'),
  );
  process.exit(1);
}

/**
 * The service runs this wrapper, which is a plain Node process. Windows services must not
 * write to a console that may not exist, so output goes to a log file in the data folder.
 */
function serviceCommand() {
  const runner = path.join(repoRoot, 'scripts', 'start-leaveos.mjs');
  return `"${process.execPath}" "${runner}"`;
}

switch (action) {
  case 'install': {
    requireAdministrator();
    const existing = sc('query', SERVICE);
    if (existing.status === 0) {
      console.log(`${DISPLAY} is already installed. Use "restart" to apply changes.`);
      break;
    }
    const created = sc(
      'create',
      SERVICE,
      'binPath=',
      serviceCommand(),
      'DisplayName=',
      DISPLAY,
      'start=',
      'auto',
    );
    if (created.status !== 0) {
      console.error('Could not create the service:\n' + (created.stderr || created.stdout));
      process.exit(1);
    }
    sc(
      'description',
      SERVICE,
      'Leave management for the office network. Staff reach it in a browser.',
    );
    // Restart on failure: after 5s, then 15s, then every 60s; reset the counter daily.
    sc(
      'failure',
      SERVICE,
      'reset=',
      '86400',
      'actions=',
      'restart/5000/restart/15000/restart/60000',
    );
    console.log(`Installed "${DISPLAY}". Starting it now…`);
    sc('start', SERVICE);
    console.log('Done. It will start automatically whenever this computer boots.');
    break;
  }
  case 'uninstall': {
    requireAdministrator();
    sc('stop', SERVICE);
    const removed = sc('delete', SERVICE);
    if (removed.status !== 0) {
      console.error('Could not remove the service:\n' + (removed.stderr || removed.stdout));
      process.exit(1);
    }
    console.log(`Removed "${DISPLAY}". Your data folder was left untouched.`);
    break;
  }
  case 'start':
  case 'stop': {
    requireAdministrator();
    const r = sc(action, SERVICE);
    console.log(r.stdout || r.stderr);
    break;
  }
  case 'restart': {
    requireAdministrator();
    sc('stop', SERVICE);
    const r = sc('start', SERVICE);
    console.log(r.stdout || r.stderr);
    break;
  }
  case 'status': {
    const r = sc('query', SERVICE);
    if (r.status !== 0) {
      console.log(`"${DISPLAY}" is not installed.`);
      console.log('Install it with:  node scripts/service.mjs install');
      break;
    }
    const running = /RUNNING/.test(r.stdout);
    console.log(`"${DISPLAY}" is ${running ? 'running' : 'installed but not running'}.`);
    if (!running) console.log('Start it with:  node scripts/service.mjs start');
    break;
  }
  default:
    console.error(
      `Unknown command "${action}". Use install, uninstall, start, stop, restart, or status.`,
    );
    process.exit(1);
}
