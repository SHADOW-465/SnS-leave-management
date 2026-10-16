import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { pathsFor } from '@sns/config';
import { lanHostnameSettingsSchema } from '@sns/contracts';

import type { RequestContext } from './ctx.js';
import { approveDevice } from './usecases/devices.js';
import { createBackupFile, stageRestoreFile } from './backup-file.js';
import { readBackupPolicy } from './backup-job.js';
import {
  isLoopback,
  lanAddress,
  serviceControl,
  serviceHeadline,
  serviceStatus,
} from './host-local.js';
import { republishHostname, staffUrls, type StaffUrls } from './discovery.js';
import { readLanHostname, writeLanHostname } from './hostname.js';
import { ensureLanCertificate } from './tls.js';
import { collectHealth, type HostHealth } from './health.js';
import { sendError } from './http.js';

const require = createRequire(import.meta.url);

type QrModule = {
  toString: (text: string, opts: { type: 'svg'; margin: number }) => Promise<string>;
};

export function hostDeniedPage(message: string): string {
  return page({
    title: 'Host panel',
    body: `<section class="state"><h1>You do not have permission to view this.</h1><p>${esc(message)}</p><p>Ask the person who looks after the office computer. Open this address on that computer, not from another PC.</p></section>`,
  });
}

export function registerHostRoutes(app: FastifyInstance): void {
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body)).entries()));
    },
  );

  app.get('/host/panel.js', async (_req, reply) => {
    return reply.type('text/javascript; charset=utf-8').send(PANEL_JS);
  });

  app.get('/api/v1/host/qr.svg', async (req, reply) => {
    const links = await officeLinks(req.ctx);
    const which = String((req.query as { for?: string } | undefined)?.for ?? 'mdns');
    const url = which === 'hostname' ? links.hostname : which === 'ip' ? links.ip : links.mdns;
    if (!url) return reply.status(404).send('No LAN address');
    const svg = await (require('qrcode') as QrModule).toString(url, { type: 'svg', margin: 1 });
    return reply.type('image/svg+xml').send(svg);
  });

  app.get('/api/v1/host/status', async (req, reply) => {
    const health = await hostHealth(req.ctx);
    const pending = await pendingCount(req);
    return reply.send({
      ok: health.integrity === 'ok',
      at: health.at,
      integrity: health.integrity,
      pending,
      links: await officeLinks(req.ctx),
      service: serviceStatus(req.ctx.config.env),
      health,
    });
  });

  app.get('/host', async (req, reply) => {
    try {
      const token = issueToken(req, reply);
      const html = await renderHost(req, token);
      return reply.type('text/html; charset=utf-8').send(html);
    } catch (err) {
      req.log.error(err);
      return reply
        .status(500)
        .type('text/html; charset=utf-8')
        .send(
          page({
            title: 'Host panel',
            body: `<section class="state" id="unexpected"><h1>Something went wrong while reading the host.</h1><p>Quote this reference: <span class="mono">${esc(String(req.id))}</span></p><p><a href="/host">Try again</a></p><details><summary>Technical detail</summary><pre>${esc(err instanceof Error ? err.message : 'error')}</pre></details></section>`,
          }),
        );
    }
  });

  app.post('/api/v1/host/hostname', async (req, reply) => {
    if (!tokenOk(req)) return back(reply, { error: 'Refresh the page and try that again.' });
    const raw = String((req.body as { hostname?: string })?.hostname ?? '');
    const parsed = lanHostnameSettingsSchema.safeParse({ hostname: raw });
    if (!parsed.success) {
      return back(reply, {
        error: 'Use a short name such as sns-leave. Letters, numbers, and hyphens only.',
      });
    }
    await writeLanHostname(req.ctx.sqlite, parsed.data.hostname, {
      userId: null,
      label: 'host-panel',
      now: req.ctx.now,
      requestId: req.ctx.requestId,
      ip: req.ctx.ip,
      userAgent: req.ctx.userAgent,
    });
    await ensureLanCertificate(pathsFor(req.ctx.config).certs, { hostname: parsed.data.hostname });
    await republishHostname(parsed.data.hostname);
    return back(reply, {
      notice: 'Office name saved. Restart the service so the certificate includes the new name.',
    });
  });

  app.post('/api/v1/host/service', async (req, reply) => {
    if (!tokenOk(req)) return back(reply, { error: 'Refresh the page and try that again.' });
    const action = String((req.body as { action?: string })?.action ?? '');
    if (action !== 'start' && action !== 'stop' && action !== 'restart') {
      return back(reply, { error: 'Choose start, stop, or restart.' });
    }
    const result = serviceControl(action, req.ctx.config.env);
    return back(reply, { notice: result.detail });
  });

  app.post('/api/v1/host/backup', async (req, reply) => {
    try {
      if (!tokenOk(req)) return back(reply, { error: 'Refresh the page and try that again.' });
      const saved = await createBackupFile(req.ctx, 'manual');
      return back(reply, {
        notice: `Backup saved (${saved.integrity}). Restart the service before a restore takes effect.`,
      });
    } catch (err) {
      return sendError(req, reply, err);
    }
  });

  app.post('/api/v1/host/restore', async (req, reply) => {
    try {
      if (!tokenOk(req)) return back(reply, { error: 'Refresh the page and try that again.' });
      const file = String((req.body as { file?: string })?.file ?? '');
      const dbPath = pathsFor(req.ctx.config).db;
      const policy = await readBackupPolicy(req.ctx.sqlite, req.ctx.backupsRoot, false);
      stageRestoreFile([req.ctx.backupsRoot, policy.directory], dbPath, file);
      return back(reply, {
        notice: `Restore staged from ${file}. Stop and start the service to apply it. A copy of the current database is kept beside it.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not stage that restore.';
      return back(reply, { error: message });
    }
  });

  app.post('/api/v1/host/devices/approve', async (req, reply) => {
    try {
      if (!tokenOk(req)) return back(reply, { error: 'Refresh the page and try that again.' });
      const deviceId = String((req.body as { deviceId?: string })?.deviceId ?? '');
      await approveDevice(req.ctx, deviceId, 'host-panel');
      return back(reply, { notice: 'Browser approved.' });
    } catch (err) {
      return sendError(req, reply, err);
    }
  });
}

export { isLoopback };

async function hostHealth(ctx: RequestContext): Promise<HostHealth> {
  return collectHealth(ctx.sqlite, {
    backupsRoot: ctx.backupsRoot,
    certPath: path.join(pathsFor(ctx.config).certs, 'cert.pem'),
  });
}

async function officeLinks(ctx: RequestContext): Promise<StaffUrls> {
  return staffUrls({
    hostname: await readLanHostname(ctx.sqlite),
    port: ctx.config.port,
    tls: ctx.config.tlsEnabled,
    address: lanAddress(),
  });
}

function qrImg(which: 'hostname' | 'mdns' | 'ip', url: string): string {
  return `<img class="qr" alt="QR code for ${esc(url)}" src="/api/v1/host/qr.svg?for=${which}" width="180" height="180">`;
}

async function pendingCount(req: {
  ctx: { sqlite: { prepare: (sql: string) => { get: () => Promise<unknown> } } };
}) {
  const row = (await req.ctx.sqlite
    .prepare(`SELECT COUNT(*) AS n FROM browser_device WHERE status = 'pending'`)
    .get()) as { n: number };
  return Number(row.n);
}

function issueToken(
  req: { cookies: Record<string, string | undefined>; ctx: { config: { cookieSecure: boolean } } },
  reply: { setCookie: (name: string, value: string, opts: object) => void },
): string {
  const existing = String(req.cookies['leaveos.host'] ?? '');
  const token = /^[a-f0-9]{64}$/.test(existing) ? existing : randomBytes(32).toString('hex');
  reply.setCookie('leaveos.host', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.ctx.config.cookieSecure,
    path: '/',
  });
  return token;
}

function tokenOk(req: { cookies: Record<string, string | undefined>; body: unknown }): boolean {
  const cookie = String(req.cookies['leaveos.host'] ?? '');
  const given = String((req.body as { token?: string } | null)?.token ?? '');
  if (!/^[a-f0-9]{64}$/.test(cookie) || cookie.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(cookie), Buffer.from(given));
}

function back(
  reply: { code: (n: number) => { header: (k: string, v: string) => { send: () => unknown } } },
  params: Record<string, string>,
) {
  const q = new URLSearchParams(params);
  return reply.code(303).header('location', `/host?${q.toString()}`).send();
}

async function renderHost(
  req: { ctx: RequestContext; query: unknown; id: string },
  token: string,
): Promise<string> {
  const query = (req.query ?? {}) as { q?: string; notice?: string; error?: string };
  const q = String(query.q ?? '').trim();
  const health = await hostHealth(req.ctx);
  const integrity = health.integrity;
  const service = serviceStatus(req.ctx.config.env);
  const links = await officeLinks(req.ctx);
  const pending = (await req.ctx.sqlite
    .prepare(
      `SELECT b.id, b.lan_ip AS "lanIp", b.created_at AS "createdAt", COALESCE(ua.email, '') AS email
         FROM browser_device b
         LEFT JOIN user_account ua ON ua.id = b.user_account_id
        WHERE b.status = 'pending'
        ORDER BY b.created_at`,
    )
    .all()) as { id: string; lanIp: string | null; createdAt: string; email: string }[];
  const backupPolicy = await readBackupPolicy(req.ctx.sqlite, req.ctx.backupsRoot, false);
  const backups = [
    ...new Set(
      [req.ctx.backupsRoot, backupPolicy.directory]
        .filter(Boolean)
        .flatMap((dir) => listBackups(dir)),
    ),
  ];
  const needle = q.toLowerCase();
  const shownPending = needle
    ? pending.filter((d) => `${d.email} ${d.id}`.toLowerCase().includes(needle))
    : pending;
  const shownBackups = needle
    ? backups.filter((name) => name.toLowerCase().includes(needle))
    : backups;
  const searchMiss = Boolean(needle) && shownPending.length === 0 && shownBackups.length === 0;

  const ipBlock = links.ip
    ? `<p>If a computer cannot open the name, use this address.</p><p class="mono" id="lan-url">${esc(links.ip)}</p>${qrImg('ip', links.ip)}`
    : `<p class="state" id="empty-lan">No office network address was found. Other computers cannot open Leave OS by number until this host has a LAN address. The name above still works once an address is present. You can still use it on this computer.</p>`;

  const pendingHtml = shownPending.length
    ? shownPending
        .map(
          (
            d,
          ) => `<li><span class="mono">${esc(d.email || 'Unknown account')}</span> · ${esc(d.lanIp ?? 'no address')} · ${esc(d.createdAt)}
        <form method="post" action="/api/v1/host/devices/approve">${hidden(token)}<input type="hidden" name="deviceId" value="${esc(d.id)}"><button type="submit">Approve</button></form></li>`,
        )
        .join('')
    : `<p class="state" id="empty-devices">No browsers are waiting. When someone signs in from a new browser, they appear here for approval.</p>`;

  const backupHtml = shownBackups.length
    ? `<ul>${shownBackups
        .map(
          (name) => `<li><span class="mono">${esc(name)}</span>
          <form method="post" action="/api/v1/host/restore">${hidden(token)}<input type="hidden" name="file" value="${esc(name)}"><button type="submit">Restore on next start</button></form></li>`,
        )
        .join('')}</ul>`
    : `<p class="state" id="empty-backups">No backup files yet. Take one before you change anything you might want back.</p>`;

  const integrityBlock =
    integrity === 'ok'
      ? ''
      : `<section class="state" id="server-down"><h2>Cannot reach a healthy database.</h2><p>The office database check returned ${esc(integrity)}. Leave requests may not be safe until this is fixed. <a href="/host">Try again</a>.</p></section>`;

  return page({
    title: 'Leave OS host',
    body: `
      <p id="offline" class="state" hidden>This browser is offline. Reconnect this computer to the office network, then refresh. That is separate from the service being stopped.</p>
      <p id="stale" class="state" hidden>Showing the status from <span id="stale-at">${esc(req.ctx.now)}</span>. A refresh did not reach the server. <a href="/host">Refresh</a>.</p>
      ${query.notice ? `<p class="notice" role="status">${esc(query.notice)}</p>` : ''}
      ${query.error ? `<p class="error" id="validation" role="alert">${esc(query.error)} <a href="/host">Clear</a></p>` : ''}
      ${searchMiss ? `<p class="state" id="no-results">Nothing matched “${esc(q)}”. <a href="/host">Clear the search</a>.</p>` : ''}
      ${integrityBlock}
      <header><h1>Host control</h1><p>Only this computer can open this page. Staff use the LAN address below.</p></header>
      <section id="status">
        <h2>Status</h2>
        <dl>
          <dt>Server</dt><dd>Answering on port ${esc(String(req.ctx.config.port))}${req.ctx.config.bindAll ? ', including the office network' : ', this computer only'}</dd>
          <dt>Database</dt><dd>${esc(integrity)} (${esc(req.ctx.sqlite.dialect)})</dd>
          <dt>Last backup</dt><dd>${health.backupAgeHours === null ? 'No backup yet' : `${health.backupAgeHours.toFixed(1)} hours ago`}</dd>
          <dt>Certificate</dt><dd>${health.certExpiresAt ? `Expires ${esc(health.certExpiresAt)}` : 'No certificate file yet'}</dd>
          <dt>Disk</dt><dd>${health.diskFreeBytes === null ? 'Unknown' : `${(health.diskFreeBytes / 1024 ** 3).toFixed(1)} GB free`}</dd>
          <dt>Windows service</dt><dd id="service-state">${esc(serviceHeadline(service.state))}</dd>
          <dt>As of</dt><dd><time id="as-of">${esc(req.ctx.now)}</time> <button type="button" id="refresh">Refresh</button></dd>
        </dl>
      </section>
      <section>
        <h2>Staff link</h2>
        <p>People on the office network open this name.</p>
        <p class="mono" id="staff-url">${esc(links.hostname)}</p>
        ${qrImg('hostname', links.hostname)}
        <p class="mono" id="mdns-url">${esc(links.mdns)}</p>
        ${qrImg('mdns', links.mdns)}
        ${ipBlock}
        <form method="post" action="/api/v1/host/hostname">
          ${hidden(token)}
          <label for="hostname">Office name</label>
          <input id="hostname" name="hostname" value="${esc(links.name)}" autocomplete="off" required>
          <button type="submit">Save name</button>
        </form>
      </section>
      <section>
        <h2>Service</h2>
        <form method="post" action="/api/v1/host/service">${hidden(token)}
          <button type="submit" name="action" value="start">Start</button>
          <button type="submit" name="action" value="stop">Stop</button>
          <button type="submit" name="action" value="restart">Restart</button>
        </form>
      </section>
      <section>
        <h2>Backups</h2>
        <form method="get" action="/host" role="search">
          <label for="q">Search backups and waiting browsers</label>
          <input id="q" name="q" value="${esc(q)}" autocomplete="off">
          <button type="submit">Search</button>
        </form>
        <form method="post" action="/api/v1/host/backup">${hidden(token)}<button type="submit">Back up now</button></form>
        ${backupHtml}
      </section>
      <section>
        <h2>Browsers waiting for approval</h2>
        ${pendingHtml}
      </section>
      <script src="/host/panel.js"></script>`,
  });
}

function listBackups(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /^backup-[A-Za-z0-9._-]+\.db$/.test(name))
    .sort()
    .reverse();
}

function hidden(token: string): string {
  return `<input type="hidden" name="token" value="${esc(token)}">`;
}

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function page(input: { title: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(input.title)}</title>
  <style>
    :root { color-scheme: light; --ink: #1c1915; --muted: #5c564c; --line: #e4ddd2; --paper: #f7f4ef; --card: #fff; --accent: #1f4d3a; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 16px/1.45 "Segoe UI", sans-serif; color: var(--ink); background: var(--paper); }
    main { max-width: 40rem; margin: 0 auto; padding: 1.25rem; }
    h1 { font-size: 1.6rem; margin: 0 0 0.25rem; }
    h2 { font-size: 1.05rem; margin: 0 0 0.5rem; }
    section, header { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 1rem; margin: 0 0 0.75rem; }
    dl { display: grid; grid-template-columns: 8rem 1fr; gap: 0.35rem 0.75rem; margin: 0; }
    dt { color: var(--muted); }
    dd { margin: 0; }
    .mono { font-family: Consolas, ui-monospace, monospace; word-break: break-all; }
    .qr { display: block; margin-top: 0.5rem; background: #fff; }
    button, .notice, .error, .state { font: inherit; }
    button { background: var(--accent); color: #fff; border: 0; border-radius: 6px; padding: 0.45rem 0.7rem; margin: 0.25rem 0.25rem 0 0; }
    form { margin: 0.35rem 0; }
    input { width: 100%; max-width: 20rem; padding: 0.4rem; }
    label { display: block; margin-bottom: 0.25rem; }
    .notice { background: #e7f2ea; padding: 0.6rem 0.8rem; border-radius: 8px; }
    .error, .state { background: #f8efe6; padding: 0.6rem 0.8rem; border-radius: 8px; }
    li { margin: 0.4rem 0; }
    @media (max-width: 360px) { dl { grid-template-columns: 1fr; } main { padding: 0.75rem; } }
  </style>
</head>
<body><main>${input.body}</main></body>
</html>`;
}

const PANEL_JS = `
const offline = document.getElementById('offline');
const stale = document.getElementById('stale');
window.addEventListener('offline', () => { if (offline) offline.hidden = false; });
window.addEventListener('online', () => { if (offline) offline.hidden = true; });
async function refresh() {
  const status = document.getElementById('status');
  if (status) status.setAttribute('aria-busy', 'true');
  try {
    const res = await fetch('/api/v1/host/status', { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('status');
    const body = await res.json();
    const at = document.getElementById('as-of');
    if (at && body.at) at.textContent = body.at;
    const svc = document.getElementById('service-state');
    if (svc && body.service && body.service.label) svc.textContent = body.service.label;
    if (stale) stale.hidden = true;
  } catch {
    if (stale) stale.hidden = false;
  } finally {
    if (status) status.removeAttribute('aria-busy');
  }
}
document.getElementById('refresh')?.addEventListener('click', () => { void refresh(); });
`;
