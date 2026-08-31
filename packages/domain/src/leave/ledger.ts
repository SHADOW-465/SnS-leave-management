export const LEDGER_ENTRY_TYPES = [
  'OPENING',
  'ACCRUAL',
  'ENTITLEMENT_GRANT',
  'CARRY_FORWARD',
  'PENDING_HOLD',
  'HOLD_RELEASE',
  'DEDUCTION',
  'CANCELLATION_CREDIT',
  'EXPIRY',
  'ADJUSTMENT',
  'ENCASHMENT',
  'MIGRATION_OPENING',
] as const;

export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export type LedgerEntry = {
  quantityHalfDays: number;
  entryType: LedgerEntryType;
};

/** Available balance is the sum. Pending holds are already negative. */
export function sumHalfDays(entries: readonly LedgerEntry[]): number {
  let total = 0;
  for (const e of entries) {
    if (!Number.isInteger(e.quantityHalfDays)) {
      throw new Error('quantityHalfDays must be an integer');
    }
    total += e.quantityHalfDays;
  }
  return total;
}

export function holdQuantity(countedHalfDays: number): number {
  return -Math.abs(countedHalfDays);
}

export function releaseQuantity(holdEntry: LedgerEntry): number {
  return -holdEntry.quantityHalfDays;
}

export function deductionQuantity(countedHalfDays: number): number {
  return -Math.abs(countedHalfDays);
}

export function cancellationCreditQuantity(countedHalfDays: number): number {
  return Math.abs(countedHalfDays);
}

export function applyCarryForwardCap(
  remainingHalfDays: number,
  capHalfDays: number,
): { carried: number; expired: number } {
  if (remainingHalfDays <= 0) {
    return { carried: 0, expired: 0 };
  }
  if (remainingHalfDays <= capHalfDays) {
    return { carried: remainingHalfDays, expired: 0 };
  }
  return { carried: capHalfDays, expired: remainingHalfDays - capHalfDays };
}

export function reverseQuantity(original: number): number {
  return -original;
}
