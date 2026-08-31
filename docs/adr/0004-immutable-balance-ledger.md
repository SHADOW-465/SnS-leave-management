# ADR 0004 — Leave balances derive from an immutable ledger

**Status:** Accepted (planning) · **Date:** 2026-08-25

## Context

The obvious design stores `leave_balance.remaining_days` and updates it on approval. The
prototype does exactly this (`b.left`, `b.total`, `b.pct`).

It fails the first time somebody asks "why is my balance 8.5 when I think it should be 10?"
There is no answer, because the number that would have explained it was overwritten.

## Decision

**A balance is never stored. It is always `SUM(quantity_half_days)` over an append-only
ledger**, filtered by employee, leave type, and leave-year period.

Entry types: `OPENING`, `ACCRUAL`, `ENTITLEMENT_GRANT`, `CARRY_FORWARD`, `PENDING_HOLD`,
`HOLD_RELEASE`, `DEDUCTION`, `CANCELLATION_CREDIT`, `EXPIRY`, `ADJUSTMENT`, `ENCASHMENT`,
`MIGRATION_OPENING`.

No `UPDATE`, no `DELETE` — enforced by triggers that raise on either. A mistake is corrected
by a reversing entry that points at the original via `reverses_entry_id`.

Quantities are **signed integers counting half-days**. No floating point anywhere near a balance.

## Rationale

- Every number on screen traces to the request, job run, or import that caused it.
- Corrections are visible as corrections, which is what an auditor and an aggrieved employee
  both actually need.
- `PENDING_HOLD` at submission makes the available balance truthful under concurrency: two
  employees cannot both spend the last two days, because the first submission has already
  written its negative hold inside the same serialised write transaction.
- Half-days as integers make `0.5 + 0.5 == 1` reliably true. Floating-point leave balances
  produce `9.999999999999998` and a support ticket.

## Consequences

- Reading a balance is a `SUM`, not a column read. At ~50 employees × 8 types × ~20 entries
  per year this is a few thousand rows behind a covering index — sub-millisecond.
- **No cached balance table.** It would be a second source of truth, and the two would
  eventually disagree. If profiling ever demands one it becomes a materialised view rebuilt
  from the ledger, never an independently-written column.
- Every operation touching a balance must be inside a transaction with its audit event.
- The ledger grows monotonically and is never purged. This is intended.

## Alternatives rejected

- **Mutable balance column** — loses history permanently. The failure is silent and
  unrecoverable.
- **Balance column plus an audit table** — two sources of truth that drift. The drift is
  discovered during a payroll dispute.
- **Decimal days as `REAL`** — floating-point comparison bugs in a number employees care
  about personally.
