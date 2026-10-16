import { createServer, type RequestListener, type Server } from 'node:http';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { CA_FILE } from './tls.js';

const require = createRequire(import.meta.url);

type QrModule = {
  toString: (text: string, opts: { type: 'svg'; margin: number }) => Promise<string>;
};

export const SETUP_PORTS = [80, 8080] as const;

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

export function setupPageHtml(input: {
  setupUrl: string;
  httpsPort: number;
  qrSvg: string;
}): string {
  const qr = input.qrSvg.trim().startsWith('<svg') ? input.qrSvg : '';
  const port = JSON.stringify(input.httpsPort);
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
const target = 'https://' + location.hostname + ':' + ${port} + '/';
const checking = document.getElementById('checking');
window.addEventListener('offline', function () {
  const el = document.getElementById('offline');
  if (el) el.hidden = false;
});
fetch(target + 'healthz', { mode: 'no-cors', cache: 'no-store' }).then(function () {
  location.replace(target);
}).catch(function () {
  if (checking) checking.textContent = 'This computer has not trusted Leave OS yet.';
});
</script>
</body>
</html>`;
}

function httpsHome(host: string, httpsPort: number): string {
  return `https://${host}:${httpsPort}/`;
}

export function createSetupHandler(input: {
  hostname: string;
  httpsPort: number;
  certDir: string;
  setupPort: () => number;
}): RequestListener {
  const fallback = input.hostname.trim().toLowerCase() || 'sns-leave';
  return (req, res) => {
    void (async () => {
      const host = safeHost(req.headers.host, fallback);
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
        const cmd = trustHelperCmd(caPem.toString('utf8'), httpsHome(host, input.httpsPort));
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
      const setupUrl = setupOrigin(host, input.setupPort());
      let qrSvg = '';
      try {
        qrSvg = await (require('qrcode') as QrModule).toString(setupUrl, {
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
      res.end(setupPageHtml({ setupUrl, httpsPort: input.httpsPort, qrSvg }));
    })().catch(() => {
      if (res.headersSent) return;
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Something went wrong while preparing this page. Refresh and try again.');
    });
  };
}

export async function bindSetupServer(
  handler: RequestListener,
  ports: readonly number[],
): Promise<{ server: Server; port: number } | null> {
  for (const port of ports) {
    const server = createServer(handler);
    const opened = await new Promise<boolean>((resolve) => {
      const onError = () => {
        server.close(() => resolve(false));
      };
      server.once('error', onError);
      server.listen(port, '0.0.0.0', () => {
        server.off('error', onError);
        resolve(true);
      });
    });
    if (!opened) continue;
    const address = server.address();
    const bound = typeof address === 'object' && address ? address.port : port;
    return { server, port: bound };
  }
  return null;
}

export async function startStaffSetup(input: {
  hostname: string;
  httpsPort: number;
  certDir: string;
  ports?: readonly number[];
}): Promise<{ port: number; close: () => Promise<void> } | null> {
  let port = input.ports?.[0] ?? 80;
  const handler = createSetupHandler({ ...input, setupPort: () => port });
  const bound = await bindSetupServer(handler, input.ports ?? SETUP_PORTS);
  if (!bound) return null;
  port = bound.port;
  noteSetupPort(port);
  return {
    port,
    async close() {
      if (currentSetupPort() === port) noteSetupPort(null);
      await new Promise<void>((resolve) => bound.server.close(() => resolve()));
    },
  };
}
