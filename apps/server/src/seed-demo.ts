import { loadConfig, loadDotEnv, pathsFor } from '@sns/config';
import { openDatabaseFromEnv } from '@sns/database';
import { completeSetup, setupStatus } from './usecases/setup.js';
import type { RequestContext } from './ctx.js';
import { nowIso, todayInTimeZone } from './time.js';
loadDotEnv();
const config = loadConfig();
const sqlite = await openDatabaseFromEnv({
  sqlitePath: pathsFor(config).db,
  databaseUrl: config.databaseUrl,
});
const ctx = {
  requestId: 'seed',
  sqlite,
  config,
  principal: null,
  ip: '127.0.0.1',
  userAgent: 'seed',
  now: nowIso(),
  today: todayInTimeZone('Asia/Kolkata'),
  attachmentsRoot: pathsFor(config).attachments,
  backupsRoot: pathsFor(config).backups,
} satisfies RequestContext;
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
  console.warn('Seeded first-run data.');
  console.warn('  Administrator : admin@example.invalid / ChangeMe_admin_1');
  console.warn('  Sample people : amina | ravi | sofia | helen | paul | nora @example.invalid');
  console.warn('  Their password: ChangeMe_demo_1');
  console.warn('All of these are also listed on the sign-in screen in development.');
} else {
  console.warn('Already bootstrapped; not seeding.');
}
await sqlite.close();
