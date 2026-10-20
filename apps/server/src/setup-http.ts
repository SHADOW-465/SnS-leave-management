import { createServer, type RequestListener, type Server } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
// Static import so esbuild bundles qrcode; the installer ships no node_modules for it.
import QRCode from 'qrcode';
import { setupStaffUrls } from './discovery.js';
import { lanAddress } from './host-local.js';
import { CA_FILE } from './tls.js';

type QrModule = {
  toString: (text: string, opts: { type: 'svg'; margin: number }) => Promise<string>;
};

export const SETUP_PORTS = [80, 8080] as const;

export type SetupLog = (message: string) => void;

/** http.sys (PID 4) reports EACCES or EADDRINUSE when it already holds the port. */
export function setupListenErrorFallsBack(code: string | undefined): boolean {
  return code === 'EADDRINUSE' || code === 'EACCES';
}

let activePort: number | null = null;

export function currentSetupPort(): number | null {
  return activePort;
}

export function noteSetupPort(port: number | null): void {
  activePort = port;
}

export function safeHost(header: string | undefined, fallback: string): string {
  const raw = (header ?? '').split(',')[0]?.trim() ?? '';
  const host = raw.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (/^[A-Za-z0-9.-]{1,253}$/.test(host)) return host;
  return fallback;
}

export function setupOrigin(host: string, port: number): string {
  return port === 80 ? `http://${host}/` : `http://${host}:${port}/`;
}

export function trustHelperCmd(caPem: string, httpsUrl: string): string {
  const body = caPem.replace(/\r/g, '').trim();
  const lines = [
    '@echo off',
    'setlocal',
    'set "CRT=%TEMP%\\LeaveOS-root.crt"',
    '> "%CRT%" (',
    ...body.split('\n').map((line) => `echo ${line}`),
    ')',
    'certutil -user -addstore Root "%CRT%"',
    'if errorlevel 1 (',
    '  echo Leave OS could not trust the office certificate for this Windows user.',
    '  pause',
    '  exit /b 1',
    ')',
    `start "" "${httpsUrl}"`,
    '',
  ];
  return lines.join('\r\n');
}

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Names the office certificate is issued for. The trust probe must use one of these: probing
 * whatever name the browser happened to type (a computer name, a changed IP) fails the
 * certificate check on a computer that does trust the root.
 */
export function certificateHosts(input: {
  hostname: string;
  address: string | null;
  requestHost: string;
}): string[] {
  const name = input.hostname.trim().toLowerCase() || 'sns-leave';
  const known = [
    name,
    `${name}.local`,
    ...(input.address ? [input.address] : []),
    'localhost',
    '127.0.0.1',
  ];
  const asked = input.requestHost.toLowerCase();
  return known.includes(asked) ? [asked, ...known.filter((h) => h !== asked)] : known;
}

export function setupPageHtml(input: {
  setupUrl: string;
  httpsPort: number;
  qrSvg: string;
  probeHosts: string[];
}): string {
  const qr = input.qrSvg.trim().startsWith('<svg') ? input.qrSvg : '';
  const port = JSON.stringify(input.httpsPort);
  const hosts = JSON.stringify(input.probeHosts).replaceAll('<', '\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Set up this computer</title>
  <style>
    :root { color-scheme: light; --ink: #1c1915; --muted: #5c564c; --line: #e4ddd2; --paper: #f7f4ef; --card: #fff; --accent: #1f4d3a; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 16px/1.45 "Segoe UI", sans-serif; color: var(--ink); background: var(--paper); }
    main { max-width: 36rem; margin: 0 auto; padding: 1.25rem; }
    section { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 1rem; }
    h1 { font-size: 1.7rem; margin: 0 0 0.5rem; }
    p { margin: 0.4rem 0; }
    .muted { color: var(--muted); }
    .mono { font-family: Consolas, ui-monospace, monospace; word-break: break-all; }
    .go { display: block; margin: 1rem 0; background: var(--accent); color: #fff; text-align: center; text-decoration: none; font-size: 1.25rem; font-weight: 650; border-radius: 8px; padding: 0.9rem 1rem; }
    .state { background: #f8efe6; padding: 0.6rem 0.8rem; border-radius: 8px; }
    .qr { display: block; width: 180px; height: auto; margin: 0.5rem 0; background: #fff; }
    ol { margin: 0.4rem 0 0.4rem 1.2rem; padding: 0; }
    @media (max-width: 360px) { main { padding: 0.75rem; } .go { font-size: 1.1rem; } }
  </style>
</head>
<body>
<main>
  <section>
    <h1>Set up this computer</h1>
    <p id="checking">Checking whether this computer already trusts Leave OS.</p>
    <p id="offline" class="state" hidden>This browser is offline. Reconnect to the office network, then refresh this page.</p>
    <p>Leave OS uses a secure connection. This computer needs to trust the office certificate once. An administrator password is not required.</p>
    <a class="go" href="/setup/trust.cmd">Set up this computer</a>
    <ol>
      <li>Click the button. If the browser asks, keep the file, then open it.</li>
      <li>Leave OS opens when the certificate is trusted.</li>
      <li>You do this once on this computer. The next visit goes straight to Leave OS.</li>
    </ol>
    <p class="muted">If the download fails, the office computer may be off or still starting. Refresh and try again. Do not continue past a certificate warning.</p>
    <p class="mono">${esc(input.setupUrl)}</p>
    ${qr ? `<p>Scan this code to open this page on another computer.</p>${qr.replace('<svg', '<svg class="qr" role="img" aria-label="QR code for the setup page"')}` : '<p class="state">The QR code could not be drawn. Type the address above.</p>'}
  </section>
</main>
<script>
const hosts = ${hosts};
const checking = document.getElementById('checking');
window.addEventListener('offline', function () {
  const el = document.getElementById('offline');
  if (el) el.hidden = false;
});
// Trusted means the browser completed a TLS handshake with one of the names the certificate covers.
function probe(host) {
  const target = 'https://' + host + ':' + ${port} + '/';
  const ctl = new AbortController();
  const timer = setTimeout(function () { ctl.abort(); }, 4000);
  return fetch(target + 'healthz', { mode: 'no-cors', cache: 'no-store', signal: ctl.signal }).then(function () {
    clearTimeout(timer);
    return target;
  }, function (err) {
    clearTimeout(timer);
    throw err;
  });
}
Promise.any(hosts.map(probe)).then(function (target) {
  location.replace(target);
}).catch(function () {
  if (checking) checking.textContent = 'This computer has not trusted Leave OS yet, or the office computer cannot be reached over a secure connection.';
});
</script>
</body>
</html>`;
}

function httpsHome(host: string, httpsPort: number): string {
  return `https://${host}:${httpsPort}/`;
}

export function createSetupHandler(input: {
  /** The office name. A function so a rename on the host panel shows without a restart. */
  hostname: string | (() => Promise<string>);
  httpsPort: number;
  certDir: string;
  setupPort: () => number;
  lanAddress?: () => string | null;
}): RequestListener {
  const officeName = async () =>
    (typeof input.hostname === 'function' ? await input.hostname() : input.hostname)
      .trim()
      .toLowerCase() || 'sns-leave';
  return (req, res) => {
    void (async () => {
      const name = await officeName();
      const host = safeHost(req.headers.host, name);
      const url = new URL(req.url ?? '/', 'http://setup.local');
      const caPath = path.join(input.certDir, CA_FILE);
      if (!fs.existsSync(caPath)) {
        res.writeHead(503, {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end('The office certificate is not ready. Refresh in a moment.');
        return;
      }
      const caPem = fs.readFileSync(caPath);
      if (caPem.includes('PRIVATE KEY')) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('The office certificate is not available.');
        return;
      }
      if (url.pathname === '/setup/ca.crt') {
        res.writeHead(200, {
          'content-type': 'application/x-x509-ca-cert',
          'content-disposition': 'attachment; filename="LeaveOS-root.crt"',
          'cache-control': 'no-store',
        });
        res.end(caPem);
        return;
      }
      if (url.pathname === '/setup/trust.cmd') {
        const [home = name] = certificateHosts({
          hostname: name,
          address: (input.lanAddress ?? lanAddress)(),
          requestHost: host,
        });
        const cmd = trustHelperCmd(caPem.toString('utf8'), httpsHome(home, input.httpsPort));
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-disposition': 'attachment; filename="Set-up-this-computer.cmd"',
          'cache-control': 'no-store',
        });
        res.end(cmd);
        return;
      }
      if (url.pathname !== '/' && url.pathname !== '/index.html') {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('That page is not here. Open the setup address shown on the office computer.');
        return;
      }
      // The address staff type, and the QR code encodes, is the office LAN address the host
      // panel shows, not whatever name this request happened to arrive on (e.g. localhost).
      const address = (input.lanAddress ?? lanAddress)();
      const setupUrl = setupStaffUrls({
        hostname: name,
        setupPort: input.setupPort(),
        address,
      }).hostname;
      let qrSvg = '';
      try {
        qrSvg = await (QRCode as unknown as QrModule).toString(setupUrl, {
          type: 'svg',
          margin: 1,
        });
      } catch {
        qrSvg = '';
      }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(
        setupPageHtml({
          setupUrl,
          httpsPort: input.httpsPort,
          qrSvg,
          probeHosts: certificateHosts({ hostname: name, address, requestHost: host }),
        }),
      );
    })().catch(() => {
      if (res.headersSent) return;
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Something went wrong while preparing this page. Refresh and try again.');
    });
  };
}

function listenOn(
  server: Server,
  port: number,
  host: string,
): Promise<{ ok: true; port: number } | { ok: false; code?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: { ok: true; port: number } | { ok: false; code?: string }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    const fail = (err: NodeJS.ErrnoException) => {
      const code = err.code;
      try {
        server.close(() => finish({ ok: false, code }));
      } catch {
        finish({ ok: false, code });
      }
    };
    timer = setTimeout(() => {
      try {
        server.close(() => finish({ ok: false, code: 'timeout' }));
      } catch {
        finish({ ok: false, code: 'timeout' });
      }
    }, 2000);
    timer.unref?.();
    server.once('error', fail);
    try {
      server.listen(port, host, () => {
        server.off('error', fail);
        const address = server.address();
        const bound = typeof address === 'object' && address ? address.port : port;
        finish({ ok: true, port: bound });
      });
    } catch (err) {
      server.off('error', fail);
      fail(err as NodeJS.ErrnoException);
    }
  });
}

export async function bindSetupServer(
  handler: RequestListener,
  ports: readonly number[],
  log: SetupLog = () => {},
): Promise<{ server: Server; port: number } | null> {
  for (let index = 0; index < ports.length; index += 1) {
    const port = ports[index]!;
    const server = createServer(handler);
    const result = await listenOn(server, port, '0.0.0.0');
    if (result.ok) return { server, port: result.port };
    const code = result.code ?? 'unknown';
    const next = ports[index + 1];
    if (next !== undefined && setupListenErrorFallsBack(result.code)) {
      log(`Port ${port} is not available (${code}). Trying port ${next}.`);
      continue;
    }
    log(`Staff setup page could not listen on port ${port} (${code}).`);
    return null;
  }
  return null;
}

export async function startStaffSetup(input: {
  hostname: string | (() => Promise<string>);
  httpsPort: number;
  certDir: string;
  ports?: readonly number[];
  log?: SetupLog;
}): Promise<{ port: number; close: () => Promise<void> } | null> {
  const ports = input.ports ?? SETUP_PORTS;
  const log = input.log ?? (() => {});
  let port = ports[0] ?? 80;
  const handler = createSetupHandler({ ...input, setupPort: () => port });
  const bound = await bindSetupServer(handler, ports, log);
  if (!bound) return null;
  port = bound.port;
  noteSetupPort(port);
  const name =
    (typeof input.hostname === 'function' ? await input.hostname() : input.hostname)
      .trim()
      .toLowerCase() || 'sns-leave';
  const link = port === 80 ? `http://${name}` : `http://${name}:${port}`;
  if ((ports[0] ?? 80) === 80 && port !== 80) {
    log(`Port 80 was not available. Staff setup page is using ${link}.`);
  } else {
    log(`Staff setup page is using ${link}.`);
  }
  return {
    port,
    async close() {
      if (currentSetupPort() === port) noteSetupPort(null);
      await new Promise<void>((resolve) => bound.server.close(() => resolve()));
    },
  };
}
