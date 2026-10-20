import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig, loadDotEnv, pathsFor, type AppConfig } from '@sns/config';
import { openDatabaseFromEnv, type Db } from '@sns/database';
import { buildApp } from './app.js';
import { readLanHostname } from './hostname.js';
import { withOfficePublicUrl } from './discovery.js';
import { resolveTlsMaterial } from './tls.js';
import { startJobs } from './jobs.js';
import { nowIso, todayInTimeZone } from './time.js';
import { DEMO_ADMIN } from './usecases/demo.js';
import { completeSetup, ensureDemoHierarchy, setupStatus } from './usecases/setup.js';
import type { RequestContext } from './ctx.js';

/** Hosted preview deploys must not seed. A local empty database still can. */
export function shouldAutoSeed(config: { seedOnEmpty: boolean; hostedPreview: boolean }): boolean {
  return config.seedOnEmpty && !config.hostedPreview;
}

export type AppRuntime = {
  app: FastifyInstance;
  db: Db;
  config: AppConfig;
  close: () => Promise<void>;
};

function pathDir(p: string) {
  return p.replace(/[\\/][^\\/]+$/, '');
}

function seedCtx(config: AppConfig, db: Db): RequestContext {
  const dirs = pathsFor(config);
  return {
    requestId: 'hosted-seed',
    sqlite: db,
    config,
    principal: null,
    ip: '127.0.0.1',
    userAgent: 'hosted-preview',
    now: nowIso(),
    today: todayInTimeZone('Asia/Kolkata'),
    attachmentsRoot: dirs.attachments,
    backupsRoot: dirs.backups,
  };
}

export async function createRuntime(env: NodeJS.ProcessEnv = process.env): Promise<AppRuntime> {
  loadDotEnv();
  const loaded = loadConfig(env);
  if (loaded.hostedPreview && !loaded.databaseUrl) {
    throw new Error(
      'Hosted preview requires DATABASE_URL or SUPABASE_DB_URL. SQLite cannot persist on Vercel.',
    );
  }
  const dirs = pathsFor(loaded);
  for (const d of [
    dirs.root,
    dirs.attachments,
    dirs.backups,
    dirs.logs,
    dirs.certs,
    pathDir(dirs.db),
  ]) {
    fs.mkdirSync(d, { recursive: true });
  }
  const db = await openDatabaseFromEnv({
    sqlitePath: dirs.db,
    databaseUrl: loaded.databaseUrl,
  });
  // The hosted preview is frozen: a deploy must not wipe or reseed Navalur.
  // Load that dataset only with `pnpm db:reset:navalur`.
  if (shouldAutoSeed(loaded)) {
    const ctx = seedCtx(loaded, db);
    if ((await setupStatus(ctx)).needsSetup) {
      await completeSetup(ctx, {
        companyName: 'Simon & Sons',
        timezone: 'Asia/Kolkata',
        leaveYearStartMonth: 1,
        leaveYearStartDay: 1,
        adminName: DEMO_ADMIN.name,
        adminEmail: DEMO_ADMIN.email,
        adminPassword: DEMO_ADMIN.password,
        loadSampleData: true,
        sampleActivity: true,
      });
    } else {
      await ensureDemoHierarchy(ctx);
    }
  }
  const lanHostname = await readLanHostname(db);
  const config = withOfficePublicUrl(loaded, lanHostname);
  const https = await resolveTlsMaterial(config, lanHostname);
  const app = await buildApp(config, db, https ? { https } : undefined);
  const jobs = startJobs(db, {
    timers: !config.hostedPreview,
    backupsRoot: dirs.backups,
    certPath: path.join(dirs.certs, 'cert.pem'),
    backupByDefault: config.env === 'production' && db.dialect === 'sqlite',
  });
  return {
    app,
    db,
    config,
    async close() {
      jobs.stop();
      await app.close();
      if (db.dialect === 'sqlite') {
        await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      }
      await db.close();
    },
  };
}

let hosted: Promise<FastifyInstance> | undefined;

export function getHostedApp(): Promise<FastifyInstance> {
  hosted ??= createRuntime().then((rt) => rt.app);
  return hosted;
}
