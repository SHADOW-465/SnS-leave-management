import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import type { AppConfig } from '@sns/config';
import { pathsFor } from '@sns/config';
import { csrfEqual } from '@sns/auth';
import { newId, NotAuthenticatedError } from '@sns/domain';
import type { Db } from '@sns/database';
import { loadPrincipal, type RequestContext } from './ctx.js';
import { registerRoutes } from './routes.js';
import { resolveSession } from './usecases/auth.js';
import { hashToken } from '@sns/auth';
import { nowIso, todayInTimeZone } from './time.js';
import { sendError } from './http.js';
import { hostDeniedPage, registerHostRoutes } from './routes-host.js';
import { isLoopback } from './host-local.js';
const here =
  import.meta.url && import.meta.url !== 'undefined'
    ? path.dirname(fileURLToPath(import.meta.url))
    : process.cwd();
const PUBLIC = new Set([
  'GET /healthz',
  'GET /api/v1/setup/status',
  'GET /api/v1/setup/demo-accounts',
  'GET /api/v1/internal/cron',
  'POST /api/v1/setup',
  'POST /api/v1/auth/login',
]);
const PASSWORD_CHANGE_ALLOWED = new Set([
  'GET /api/v1/me',
  'POST /api/v1/auth/password',
  'POST /api/v1/auth/logout',
]);
export async function buildApp(
  config: AppConfig,
  sqlite: Db,
  opts?: { https?: { key: Buffer; cert: Buffer } },
): Promise<FastifyInstance> {
  const dirs = pathsFor(config);
  const app = Fastify({
    logger: config.env === 'test' ? false : { level: config.logLevel },
    genReqId: () => newId(),
    trustProxy: config.trustProxy,
    ...(opts?.https ? { https: opts.https } : {}),
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Script stays strict — that is the directive that actually blocks XSS.
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        // React sets element `style` attributes, which CSP counts under style-src.
        // Without this the production build renders completely unstyled. Documented
        // as an accepted deviation in docs/SECURITY.md; style injection cannot execute
        // script, and script-src remains unrelaxed.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        // The bundler inlines small font subsets as data: URIs. These are part of our
        // own bundle, not a remote fetch — without this the interface falls back to a
        // system face in production. No external font host is permitted.
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  await app.register(cookie);
  await app.register(cors, {
    origin: config.env === 'development' ? ['http://localhost:5173'] : false,
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    // The limit guards the API. Counting the page and its scripts, styles and fonts too made a
    // busy browser's next page load fail outright, replacing the app with an error body.
    allowList: (req) => !req.url.startsWith('/api/'),
  });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  app.addHook('onRequest', async (req) => {
    (
      req as FastifyRequest & {
        requestId: string;
      }
    ).requestId = String(req.id);
  });
  app.addHook('preHandler', async (req, reply) => {
    const requestId = String(req.id);
    const company = (await sqlite
      .prepare(`SELECT timezone FROM company WHERE id = 'company'`)
      .get()) as
      | {
          timezone: string;
        }
      | undefined;
    const ctx: RequestContext = {
      requestId,
      sqlite,
      config,
      principal: null,
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? '',
      now: nowIso(),
      today: todayInTimeZone(company?.timezone ?? 'UTC'),
      attachmentsRoot: dirs.attachments,
      backupsRoot: dirs.backups,
    };
    req.ctx = ctx;
    if (sqlite.dialect === 'postgres') {
      await sqlite.prepare(`SELECT set_config('app.user_account_id', '', false)`).get();
    }
    const pathOnly = req.url.split('?')[0] ?? '';
    const hostLocal =
      pathOnly === '/host' || pathOnly.startsWith('/host/') || pathOnly.startsWith('/api/v1/host');
    if (hostLocal && !isLoopback(req.ip)) {
      const message =
        'You do not have permission to view this. The host panel is only on the office computer that runs Leave OS. Open it from that computer.';
      if (pathOnly.startsWith('/api/')) {
        return reply.status(403).send({
          error: { code: 'HOST_LOCAL_ONLY', message, requestId },
        });
      }
      return reply.status(403).type('text/html; charset=utf-8').send(hostDeniedPage(message));
    }
    const key = `${req.method} ${pathOnly}`;
    const isPublic =
      hostLocal || PUBLIC.has(key) || req.url.startsWith('/assets') || req.method === 'OPTIONS';
    const token = req.cookies['leaveos.sid'];
    if (token) {
      const session = await resolveSession(ctx, token);
      if (session) {
        req.sessionTokenHash = hashToken(token);
        ctx.principal = await loadPrincipal(sqlite, session.user_account_id);
        if (sqlite.dialect === 'postgres' && ctx.principal) {
          await sqlite
            .prepare(`SELECT set_config('app.user_account_id', ?, false)`)
            .get(ctx.principal.userId);
        }
        const method = req.method.toUpperCase();
        if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !PUBLIC.has(key)) {
          const header = String(req.headers['x-csrf-token'] ?? '');
          if (!csrfEqual(header, session.csrf_token)) {
            return reply.status(403).send({
              error: {
                code: 'CSRF',
                message: 'This request could not be verified. Refresh the page and try again.',
                requestId,
              },
            });
          }
        }
        // A temporary password (new account or reset) is replaced before the account can
        // do anything. Whoever holds the credential sheet must not use the account quietly.
        if (
          session.must_change_password &&
          pathOnly.startsWith('/api/v1') &&
          !PUBLIC.has(key) &&
          !PASSWORD_CHANGE_ALLOWED.has(key)
        ) {
          return reply.status(403).send({
            error: {
              code: 'PASSWORD_CHANGE_REQUIRED',
              message: 'Choose a new password before continuing.',
              requestId,
            },
          });
        }
      }
    }
    if (!isPublic && !req.url.startsWith('/api/v1')) return;
    if (!isPublic && req.url.startsWith('/api/v1') && !ctx.principal) {
      throw new NotAuthenticatedError();
    }
  });
  app.setErrorHandler((err, req, reply) => sendError(req, reply, err));
  await registerRoutes(app);
  registerHostRoutes(app);
  // `here` is apps/server/src, so the built web app is two levels up under apps/web.
  // The previous path resolved to <repo>/web/dist, which never exists — in production
  // the server answered 404 for every page and served no interface at all.
  const webDist = resolveWebDist(here);
  if (webDist) {
    await app.register(staticPlugin, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/assets/')) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Not found.', requestId: String(req.id) },
        });
      }
      return reply.sendFile('index.html');
    });
  }
  return app;
}

function resolveWebDist(here: string): string | undefined {
  const candidates = [
    process.env.LEAVEOS_WEB_DIST,
    path.resolve(here, '../../web/dist'),
    path.resolve(process.cwd(), 'apps/web/dist'),
    path.resolve(process.cwd(), 'public'),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => fs.existsSync(path.join(p, 'index.html')));
}
