import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureLanCertificate } from './tls.js';
import {
  currentSetupPort,
  noteSetupPort,
  safeHost,
  setupPageHtml,
  startStaffSetup,
  trustHelperCmd,
} from './setup-http.js';

const dirs: string[] = [];
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  noteSetupPort(null);
  for (const close of closers.splice(0)) await close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('staff setup page', () => {
  it('builds a one-click helper that trusts the root for the current user', () => {
    const cmd = trustHelperCmd(
      '-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n',
      'https://sns-leave:8443/',
    );
    expect(cmd).toContain('certutil -user -addstore Root');
    expect(cmd).toContain('BEGIN CERTIFICATE');
    expect(cmd).not.toContain('PRIVATE KEY');
    expect(cmd).toContain('start "" "https://sns-leave:8443/"');
    expect(safeHost('sns-leave:80', 'fallback')).toBe('sns-leave');
    expect(safeHost('bad host', 'sns-leave')).toBe('sns-leave');
    const html = setupPageHtml({
      setupUrl: 'http://sns-leave/',
      httpsPort: 8443,
      qrSvg: '<svg id="qr"></svg>',
    });
    expect(html).toContain('Set up this computer');
    expect(html).toContain('no-cors');
    expect(html).toContain('healthz');
    expect(html).toContain('location.replace');
    expect(html).toContain('id="offline"');
    expect(html).toContain('id="qr"');
  });

  it('serves the page and the helper, and falls back when the first port is taken', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-setup-'));
    dirs.push(dir);
    const material = await ensureLanCertificate(dir, { addresses: ['10.4.4.4'] });
    const blocker = createServer((_req, res) => {
      res.end('taken');
    });
    await new Promise<void>((resolve) => blocker.listen(0, '0.0.0.0', () => resolve()));
    const used = (blocker.address() as { port: number }).port;
    closers.push(
      () =>
        new Promise((resolve) => {
          blocker.close(() => resolve());
        }),
    );

    const started = await startStaffSetup({
      hostname: 'sns-leave',
      httpsPort: 8443,
      certDir: dir,
      ports: [used, 0],
    });
    expect(started).not.toBeNull();
    closers.push(() => started!.close());
    expect(started!.port).not.toBe(used);
    expect(currentSetupPort()).toBe(started!.port);

    const page = await fetch(`http://127.0.0.1:${started!.port}/`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Set up this computer');
    expect(html).toContain('<svg');
    expect(html).toContain(`http://127.0.0.1:${started!.port}/`);

    const cmdRes = await fetch(`http://127.0.0.1:${started!.port}/setup/trust.cmd`);
    expect(cmdRes.status).toBe(200);
    expect(cmdRes.headers.get('content-disposition')).toContain('Set-up-this-computer.cmd');
    const cmd = await cmdRes.text();
    expect(cmd).toContain('certutil -user -addstore Root');
    expect(cmd).toContain('BEGIN CERTIFICATE');
    expect(cmd).not.toContain('PRIVATE KEY');
    expect(cmd).toContain('https://127.0.0.1:8443/');

    const ca = await fetch(`http://127.0.0.1:${started!.port}/setup/ca.crt`);
    expect(Buffer.from(await ca.arrayBuffer()).equals(material.ca)).toBe(true);
    expect(await (await fetch(`http://127.0.0.1:${started!.port}/secret`)).text()).toContain(
      'not here',
    );
  });
});
