import { newId } from '@sns/domain';
import type { Db } from '@sns/database';
import { openCurrentPeriod } from './jobs/balance.js';

/**
 * Tests about yearly-grant leave need a second type, which the product no longer lets anyone
 * add. This writes one straight into the database the way an old install would have it.
 */
export async function addYearlyGrantType(
  sqlite: Db,
  { code = 'CL', name = 'Casual Leave', openBalances = true } = {},
) {
  const now = new Date().toISOString();
  const typeId = newId();
  const versionId = newId();
  await sqlite
    .prepare(
      `INSERT INTO leave_type (id, code, name, colour_token, is_paid, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, 'accent', 1, ?, 'system', ?, 'system')`,
    )
    .run(typeId, code, name, now, now);
  const period = (await sqlite
    .prepare(`SELECT starts_on AS "startsOn" FROM leave_period ORDER BY starts_on DESC LIMIT 1`)
    .get()) as { startsOn: string };
  await sqlite
    .prepare(
      `INSERT INTO leave_policy_version (id, leave_type_id, version_no, effective_from, rules_json, published_at, published_by, created_at, created_by)
       VALUES (?, ?, 1, ?, ?, ?, 'system', ?, 'system')`,
    )
    .run(
      versionId,
      typeId,
      period.startsOn,
      JSON.stringify({
        entitlementHalfDays: 24,
        accrualMethod: 'annual_grant',
        accrualCadenceMonths: 12,
        midYearProrate: true,
        carryForwardCapHalfDays: 10,
        carryForwardExpiryMonths: 3,
        probationRestriction: 'none',
        probationMaxHalfDays: 0,
        halfDaysAllowed: true,
        minNoticeDays: 0,
        maxConsecutiveDays: 15,
        negativeBalanceAllowed: false,
        attachmentRequiredAfterHalfDays: null,
      }),
      now,
      now,
    );
  await sqlite
    .prepare(
      `INSERT INTO policy_assignment (id, leave_policy_version_id, scope_type, scope_id, priority) VALUES (?, ?, 'company', 'company', 0)`,
    )
    .run(newId(), versionId);
  if (openBalances) await openCurrentPeriod(sqlite);
  return typeId;
}
