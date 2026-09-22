import { loadConfig, loadDotEnv, pathsFor } from '@sns/config';
import { openDatabaseFromEnv } from '@sns/database';
import { DEMO_ADMIN, DEMO_PASSWORD } from './usecases/demo.js';
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
    adminName: DEMO_ADMIN.name,
    adminEmail: DEMO_ADMIN.email,
    adminPassword: DEMO_ADMIN.password,
    loadSampleData: true,
    sampleActivity: true,
  });
  console.warn('Seeded first-run data.');
  console.warn(`  Administrator : ${DEMO_ADMIN.email} / ${DEMO_ADMIN.password}`);
  console.warn(
    '  Sample people : vijay, john, david, anitha, ramesh … @sns.test (or their SNS-10xx ID)',
  );
  console.warn(`  Their password: ${DEMO_PASSWORD}`);
  console.warn('All of these are also listed on the sign-in screen in development.');
} else {
  console.warn('Already bootstrapped; not seeding.');
}
await sqlite.close();
