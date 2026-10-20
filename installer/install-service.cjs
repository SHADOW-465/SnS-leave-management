/**
 * Registers Leave OS with WinSW and opens the LAN ports.
 * The setup program runs this elevated.
 *
 * node.exe cannot answer the Service Control Manager, so registering it with
 * sc.exe times out (error 1053). LeaveOS-service.exe is WinSW. It installs and
 * starts the service, then this script waits until the service is Running and
 * https://127.0.0.1:8443/healthz answers.
 *
 * sc.exe is used only to stop and delete a service that WinSW did not install
 * (an older setup registered node.exe directly).
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const SERVICE = 'LeaveOS';
const DISPLAY = 'Simon and Sons Leave OS';
const PORT = process.env.LEAVEOS_PORT || '8443';

function serviceLogDir() {
  const root = process.env.PROGRAMDATA || 'C:\\ProgramData';
  return path.join(root, 'SimonAndSons', 'LeaveOS', 'logs');
}

function output(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
}

function serviceStateFromStatus(text) {
  const line = String(text ?? '');
  // WinSW v2 prints Started/Stopped; v3 prints Running.
  if (/\b(Running|Started)\b/.test(line)) return 'running';
  if (/\bStartPending\b/.test(line)) return 'start-pending';
  if (/\bStopped\b/.test(line)) return 'stopped';
  if (/\bNonExistent\b/.test(line)) return 'missing';
  return 'other';
}

function nextRunningWait(text, stoppedPolls) {
  const state = serviceStateFromStatus(text);
  if (state === 'running') return { done: true, ok: true, stoppedPolls: 0 };
  if (state === 'stopped' || state === 'missing') {
    const next = stoppedPolls + 1;
    if (next >= 3) return { done: true, ok: false, stoppedPolls: next };
    return { done: false, ok: false, stoppedPolls: next };
  }
  return { done: false, ok: false, stoppedPolls: 0 };
}

function wrapperAlreadyPresent(text) {
  return /already exists|already installed/i.test(String(text ?? ''));
}

function serviceAlreadyStarted(text) {
  return /already running|already been started|\b1056\b/i.test(String(text ?? ''));
}

function winsw(args) {
  const exe = path.join(__dirname, 'LeaveOS-service.exe');
  return spawnSync(exe, args, { encoding: 'utf8', windowsHide: true });
}

function sc(args) {
  return spawnSync('sc.exe', args, { encoding: 'utf8', windowsHide: true });
}

/** Restart after 5 s, 15 s, then 60 s; the failure count resets after a day. */
function recoveryArgs() {
  return {
    failure: [
      'failure',
      SERVICE,
      'reset=',
      '86400',
      'actions=',
      'restart/5000/restart/15000/restart/60000',
    ],
    // Also treat a non-zero exit of the wrapped process as a failure, not only a crash.
    failureFlag: ['failureflag', SERVICE, '1'],
    start: ['config', SERVICE, 'start=', 'auto'],
  };
}

function isAutoStart(qcText) {
  return /START_TYPE\s*:\s*2\s+AUTO_START(?!\s*\(DELAYED)/i.test(String(qcText ?? ''));
}

function restartsOnFailure(qfailureText) {
  const text = String(qfailureText ?? '');
  return (text.match(/RESTART/g) ?? []).length >= 3;
}

/** Windows itself restarts the service, even if the wrapper dies. Checked, not assumed. */
function configureRecovery() {
  const args = recoveryArgs();
  for (const step of [args.start, args.failure, args.failureFlag]) {
    const done = sc(step);
    if ((done.status ?? 1) !== 0) {
      console.error(`sc.exe ${step.join(' ')} failed.`);
      console.error(output(done));
      process.exit(done.status || 1);
    }
  }
  const qc = output(sc(['qc', SERVICE]));
  const qfailure = output(sc(['qfailure', SERVICE]));
  if (!isAutoStart(qc) || !restartsOnFailure(qfailure)) {
    console.error('The Leave OS service is not set to start automatically and restart on failure.');
    console.error(qc);
    console.error(qfailure);
    process.exit(1);
  }
  console.log('Leave OS starts automatically and restarts if it stops unexpectedly.');
}

function allowInbound(name, protocol, port) {
  const firewall = spawnSync(
    'netsh',
    [
      'advfirewall',
      'firewall',
      'add',
      'rule',
      `name=${name}`,
      'dir=in',
      'action=allow',
      `protocol=${protocol}`,
      `localport=${port}`,
    ],
    { encoding: 'utf8' },
  );
  if (firewall.status !== 0) {
    console.error(firewall.stderr || firewall.stdout);
  }
}

function openFirewall() {
  allowInbound('Leave OS', 'TCP', PORT);
  allowInbound('Leave OS HTTP', 'TCP', '80,8080');
  allowInbound('Leave OS mDNS', 'UDP', '5353');
  allowInbound('Leave OS LLMNR', 'UDP', '5355');
}

function ensureWrapper() {
  const exe = path.join(__dirname, 'LeaveOS-service.exe');
  const xml = path.join(__dirname, 'LeaveOS-service.xml');
  if (!fs.existsSync(exe) || !fs.existsSync(xml)) {
    console.error('LeaveOS-service.exe and LeaveOS-service.xml must sit next to this script.');
    process.exit(1);
  }
}

async function removeExistingService() {
  winsw(['stop']);
  const removed = winsw(['uninstall']);
  if ((removed.status ?? 1) === 0) return;
  sc(['stop', SERVICE]);
  const deleted = sc(['delete', SERVICE]);
  const text = output(deleted);
  if ((deleted.status ?? 1) !== 0 && !/1060|does not exist|marked for deletion/i.test(text)) {
    console.error(output(removed));
    console.error(text);
    process.exit(deleted.status || 1);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

async function installAndStart() {
  ensureWrapper();
  const logs = serviceLogDir();
  fs.mkdirSync(logs, { recursive: true });
  console.log(`Service logs: ${logs}`);

  let installed = winsw(['install']);
  if ((installed.status ?? 1) !== 0) {
    const text = output(installed);
    if (!wrapperAlreadyPresent(text)) {
      console.error(text);
      process.exit(installed.status || 1);
    }
    console.log('A Leave OS service is already registered. Replacing it.');
    await removeExistingService();
    installed = winsw(['install']);
    if ((installed.status ?? 1) !== 0) {
      console.error(output(installed));
      process.exit(installed.status || 1);
    }
  }

  configureRecovery();

  const started = winsw(['start']);
  if ((started.status ?? 1) !== 0 && !serviceAlreadyStarted(output(started))) {
    console.error(output(started));
    process.exit(started.status || 1);
  }
  await waitUntilRunning();
  await waitUntilAnswering(PORT);
  console.log(`Registered the ${DISPLAY} service on port ${PORT}.`);
}

async function waitUntilRunning() {
  const deadline = Date.now() + 45000;
  let stoppedPolls = 0;
  while (Date.now() < deadline) {
    const status = winsw(['status']);
    const text = output(status);
    const decision = nextRunningWait(text, stoppedPolls);
    stoppedPolls = decision.stoppedPolls;
    if (decision.done) {
      if (decision.ok) {
        console.log('Leave OS service state is Running.');
        return;
      }
      console.error('Leave OS service did not reach Running.');
      console.error(text);
      console.error(`Service log folder: ${serviceLogDir()}`);
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.error('Leave OS service did not reach Running.');
  console.error(`Service log folder: ${serviceLogDir()}`);
  process.exit(1);
}

function waitUntilAnswering(port) {
  const deadline = Date.now() + 45000;
  const once = () =>
    new Promise((resolve) => {
      const req = https.get(
        {
          hostname: '127.0.0.1',
          port: Number(port),
          path: '/healthz',
          rejectUnauthorized: false,
          timeout: 2000,
        },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        },
      );
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.on('error', () => resolve(false));
    });
  const spin = async () => {
    while (Date.now() < deadline) {
      if (await once()) {
        console.log(`Leave OS is answering on https://127.0.0.1:${port}/host`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    console.error('The service reached Running. The control panel was not answering yet.');
    console.error(`Service log folder: ${serviceLogDir()}`);
    process.exit(1);
  };
  return spin();
}

async function main() {
  if (process.platform !== 'win32') {
    console.error('The Leave OS service can only be registered on Windows.');
    process.exit(1);
  }
  openFirewall();
  await installAndStart();
}

module.exports = {
  serviceStateFromStatus,
  nextRunningWait,
  wrapperAlreadyPresent,
  serviceAlreadyStarted,
  serviceLogDir,
  recoveryArgs,
  isAutoStart,
  restartsOnFailure,
};

if (require.main === module) {
  void main();
}
