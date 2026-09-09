import type { Db } from '@sns/database';
import { drainOutbox } from './email.js';
import { expireCarriedDays, openCurrentPeriod, runMonthlyAccrual } from './jobs/balance.js';
import { nowIso } from './time.js';

export async function runJobsTick(sqlite: Db): Promise<void> {
  await drainOutbox(sqlite);
  await sweepSessions(sqlite);
  await healthProbe(sqlite);
  // Order matters: open the period first so a new leave year has its entitlement before
  // anything is accrued into it or expired out of it.
  await openCurrentPeriod(sqlite);
  await runMonthlyAccrual(sqlite);
  await expireCarriedDays(sqlite);
}

export function startJobs(
  sqlite: Db,
  opts: { timers?: boolean } = {},
): {
  stop: () => void;
} {
  if (opts.timers === false) {
    runSafe(() => runJobsTick(sqlite));
    return { stop() {} };
  }
  const timers: NodeJS.Timeout[] = [];
  timers.push(setInterval(() => runSafe(() => drainOutbox(sqlite)), 60000));
  timers.push(setInterval(() => runSafe(() => sweepSessions(sqlite)), 60 * 60000));
  timers.push(setInterval(() => runSafe(() => healthProbe(sqlite)), 5 * 60000));
  // Balance movements are idempotent, so running hourly is safe and means a new leave
  // year opens within the hour rather than waiting for a restart.
  timers.push(setInterval(() => runSafe(() => balanceTick(sqlite)), 60 * 60000));
  // Catch up immediately on start: if the host was switched off over the new year, the
  // period must open as soon as it comes back rather than at the next timer.
  runSafe(() => balanceTick(sqlite));
  return {
    stop() {
      for (const t of timers) clearInterval(t);
    },
  };
}
function runSafe(fn: () => void | Promise<void>) {
  try {
    const r = fn();
    if (r && typeof (r as Promise<void>).then === 'function') {
      void (r as Promise<void>).catch(() => undefined);
    }
  } catch {
    // jobs never take down the process
  }
}
async function sweepSessions(sqlite: Db) {
  await sqlite
    .prepare(
      `UPDATE session SET revoked_at = ?, revoked_reason = 'expired' WHERE expires_at < ? AND revoked_at IS NULL`,
    )
    .run(nowIso(), nowIso());
}
async function healthProbe(sqlite: Db) {
  if (sqlite.dialect === 'sqlite') {
    await sqlite.exec('PRAGMA wal_checkpoint(PASSIVE)');
  } else {
    await sqlite.prepare('SELECT 1 AS n').get();
  }
}
async function balanceTick(sqlite: Db): Promise<void> {
  await openCurrentPeriod(sqlite);
  await runMonthlyAccrual(sqlite);
  await expireCarriedDays(sqlite);
}
