# ADR 0008 — An outbox table for notifications and integrations

**Status:** Accepted · **Date:** 2026-08-25 · **Amended by:**
[ADR 0010](0010-email-deep-links.md) on 2026-08-26 — email is now a Phase 1 feature via a
configured mailbox account, not an optional adapter that is off by default. The outbox
mechanism described here is unchanged and is what makes that safe.

## Context

Approving a leave request should notify the employee. The obvious implementation sends the
email inside the request handler. That couples a business transaction to an SMTP server
which, per assumption D-13, may not exist at all.

## Decision

Delivery-bound messages are written to an `outbox_message` table **inside the same database
transaction as the business change**. A separate worker drains the outbox with retries and
backoff, dead-lettering after N attempts.

In-app notifications are written directly to the `notification` table in that same
transaction and are immediately visible. Email is an **optional adapter, off by default**.

## Rationale

- A notification cannot be sent for an approval that rolled back, and an approval cannot
  commit without its notification being queued. The two facts are atomic.
- An unreachable SMTP server cannot fail an approval, block a request, or hold a lock.
- The system is fully usable with email disabled, which the brief requires and which D-13
  assumes is the starting state.
- The same table serves future payroll and integration deliveries without a second mechanism.
- Retries are visible and inspectable, so "why did nobody get the email" has an answer in a
  table rather than in a log grep.

## Consequences

- Email delivery is asynchronous — up to one minute of delay by default. Acceptable, and
  stated in the UI.
- The outbox needs monitoring: depth and dead-letter count are health-check inputs and raise
  the control panel to `degraded` when they grow.
- Messages must be idempotent at the receiving end, since at-least-once delivery is the
  guarantee.
- Payload content must be redacted of sensitive values before it is written, because the
  outbox is a durable store like any other.

## Alternatives rejected

- **Send inline during the request** — couples the transaction to a network call, and slows
  every approval to SMTP's pace.
- **Fire-and-forget after commit** — the message is lost if the process dies in the gap, and
  nobody ever finds out.
- **A job queue dependency (BullMQ, etc.)** — requires Redis, which is a second service to
  install, run, and explain to an operator on a single office PC. The database is already
  there and already transactional.
