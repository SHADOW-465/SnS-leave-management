import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { loadConfig, loadDotEnv, pathsFor, type AppConfig } from '@sns/config';
import { openDatabaseFromEnv, type Db } from '@sns/database';
import { buildApp } from './app.js';
import { startJobs } from './jobs.js';
import { nowIso, todayInTimeZone } from './time.js';
import { completeSetup, ensureDemoHierarchy, setupStatus } from './usecases/setup.js';
import type { RequestContext } from './ctx.js';

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
  const config = loadConfig(env);
  if (config.hostedPreview && !config.databaseUrl) {
    throw new Error(
      'Hosted preview requires DATABASE_URL or SUPABASE_DB_URL. SQLite cannot persist on Vercel.',
    );
  }
  const dirs = pathsFor(config);
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
    databaseUrl: config.databaseUrl,
  });
  if (config.seedOnEmpty) {
    const ctx = seedCtx(config, db);
    if ((await setupStatus(ctx)).needsSetup) {
      await completeSetup(ctx, {
        companyName: 'Simon & Sons',
        timezone: 'Asia/Kolkata',
        leaveYearStartMonth: 1,
        leaveYearStartDay: 1,
        adminName: 'Ada Example',
        adminEmail: 'admin@example.invalid',
        adminPassword: 'ChangeMe_admin_1',
        loadSampleData: true,
      });
    } else {
      // Already bootstrapped (the live preview). Fill in Sofia and the Engineering
      // org if this database was seeded before hierarchical approval existed.
      await ensureDemoHierarchy(ctx);
    }
  }
  const app = await buildApp(config, db);
  const jobs = startJobs(db, { timers: !config.hostedPreview });
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
