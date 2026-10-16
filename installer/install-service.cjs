/**
 * Registers Leave OS with the Windows Service Control Manager and opens the LAN port.
 * The setup program runs this elevated. node-windows is used when that package is
 * installed; otherwise this uses sc.exe, which is the same registrar scripts/service.mjs uses.
 */
const { spawnSync } = require('node:child_process');
const https = require('node:https');
const path = require('node:path');

const SERVICE = 'LeaveOS';
const DISPLAY = 'Simon & Sons Leave OS';
const PORT = process.env.LEAVEOS_PORT || '8443';
const node = path.join(__dirname, 'node.exe');
const runner = path.join(__dirname, 'leaveos-run.cjs');

function sc(args) {
  return spawnSync('sc.exe', args, { encoding: 'utf8' });
}

function openFirewall() {
  const firewall = spawnSync(
    'netsh',
    [
      'advfirewall',
      'firewall',
      'add',
      'rule',
      'name=Leave OS',
      'dir=in',
      'action=allow',
      'protocol=TCP',
      `localport=${PORT}`,
    ],
    { encoding: 'utf8' },
  );
  if (firewall.status !== 0) {
    console.error(firewall.stderr || firewall.stdout);
  }
}

async function installWithServiceControl() {
  const bin = `"${node}" "${runner}"`;
  const existing = sc(['query', SERVICE]);
  if (existing.status !== 0) {
    const created = sc([
      'create',
      SERVICE,
      'binPath=',
      bin,
      'start=',
      'auto',
      'DisplayName=',
      DISPLAY,
    ]);
    if (created.status !== 0) {
      console.error(created.stderr || created.stdout);
      process.exit(created.status || 1);
    }
  }
  sc(['description', SERVICE, 'Leave management for the office network. Staff use a browser.']);
  sc([
    'failure',
    SERVICE,
    'reset=',
    '86400',
    'actions=',
    'restart/5000/restart/15000/restart/60000',
  ]);
  const started = sc(['start', SERVICE]);
  if (started.status !== 0 && !/1056|already been started/i.test(started.stdout + started.stderr)) {
    console.error(started.stderr || started.stdout);
  }
  await waitUntilAnswering(PORT);
  console.log(`Registered the ${DISPLAY} service on port ${PORT}.`);
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
      await new Promise((r) => setTimeout(r, 500));
    }
    console.error('The service was registered. The control panel was not answering yet.');
  };
  return spin();
}

function installWithNodeWindows() {
  const { Service } = require('node-windows');
  const svc = new Service({
    name: DISPLAY,
    description: 'Leave management for the office network. Staff use a browser.',
    script: runner,
    execPath: node,
    wait: 2,
    grow: 0.5,
  });
  svc.on('alreadyinstalled', () => {
    console.log('Service is already installed.');
    process.exit(0);
  });
  svc.on('install', () => {
    svc.start();
    console.log(`Registered ${DISPLAY} with node-windows.`);
  });
  svc.on('error', (err) => {
    console.error(err);
    process.exit(1);
  });
  svc.install();
}

if (process.platform !== 'win32') {
  console.error('The Leave OS service can only be registered on Windows.');
  process.exit(1);
}

openFirewall();
try {
  require.resolve('node-windows');
  installWithNodeWindows();
} catch {
  void installWithServiceControl();
}
