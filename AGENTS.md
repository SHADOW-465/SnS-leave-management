# AGENTS.md

Instructions for any AI agent or developer working in this repository.

**Read this file and `docs/DEFERRED-WORK.md` before making changes. Update
`docs/DEFERRED-WORK.md` before finishing.**

---

## The project

Simon & Sons Leave OS — a local-first employee and leave management system for ~50
employees (architected to 250), running on one Windows machine on the office LAN. No cloud
dependency for any core function.

Start with `docs/00-PLAN-INDEX.md`. The decisions register is
`docs/ASSUMPTIONS-AND-DECISIONS.md`, and all 21 company decisions there are **answered and
binding** — do not re-open one without asking.

---

## The bookkeeping rule (this is why this file exists)

Work gets deferred, and then it gets forgotten, because "deferred" and "forgotten" look
identical six weeks later. `docs/DEFERRED-WORK.md` is the defence.

**Before you start**, read it, so you do not rebuild something that was deferred on purpose
or start something that is blocked on legal approval.

**When you complete a deferred item**, in the same commit:

1. Mark it `DONE` in `docs/DEFERRED-WORK.md`, with the date and what evidences it (test name,
   PR, recorded manual check).
2. Do **not** delete the row. `DONE` items stay as the record.
3. Remove any UI or documentation text that said the feature was unavailable.

**When you defer something new**, in the same commit, add it with an ID, why it was deferred,
and what specifically unblocks it. Include the small ones — especially the small ones.

**When a blocker changes**, move the item between sections and say what changed.

**At every milestone**, review the whole file and update its "Last reviewed" date.

A change that completes or creates deferred work and does not touch
`docs/DEFERRED-WORK.md` is incomplete. Treat it the way you would treat a missing test.

---

## Hard constraints — do not violate these

These come from company decisions and from law, not from preference.

1. **No statutory calculations.** No tax, provident fund, ESI, gratuity, statutory leave
   entitlement, or payroll computation — until the jurisdiction is confirmed and the rules
   are verified by a qualified company, legal, or payroll representative (D-05, DW-01…DW-07).
   Payroll is an integration and an export/import workflow. Nothing else.
2. **No invented business rules.** Leave entitlements, accrual, carry-forward, and probation
   rules are configured by HR through Settings → Leave Rules. Never hard-code a number
   because it "seems standard" (D-04).
3. **No automatic deletion of employee data.** Deactivate, never destroy. Retention
   classifications are stored; deletion jobs require company and legal approval (D-21, DW-08).
4. **No real employee data, and no credential, in the repository or the installer.** Fixtures
   are synthetic, obviously fictional, and use `@example.invalid`.
5. **Never weaken a security control to make a test pass.** Fix the test or fix the design.
6. **Never tell an operator to bypass a certificate warning** (D-18). A warning is a defect
   with a cause; treat it as one.
7. **Never claim something is verified unless that exact test was run.** Installation, LAN
   access, TLS trust, backup restore, and accessibility are claimed only with recorded
   evidence. "The build passes" is not evidence that anything works.
8. **Balances are never stored as a mutable number.** Always derived from the append-only
   ledger. Corrections are reversing entries (ADR 0004).
9. **`audit_event` and `balance_ledger` are append-only.** No `UPDATE`, no `DELETE`, no
   admin UI path to either.
10. **Authorisation happens in the use-case**, not the route and never the UI (ADR 0006).
    Hiding a button is a courtesy, not a control.
11. **No cloud dependency for core operation.** No CDN, no hosted fonts, no cloud auth, no
    telemetry. Everything bundled locally.
12. **Email must never be required.** In-app notifications are primary. A broken mailbox must
    not affect a single request, notification, or approval (D-13).
13. **Email links carry no authority.** They are redirect targets. Sign-in is always required
    before any approval action (ADR 0010).

---

## Architecture rules

- **Dependency direction**, enforced by ESLint: `domain` imports nothing else in the repo ·
  `database` imports `domain` and `contracts` · `server` imports all packages · `web` imports
  `contracts` and `ui` only · `desktop` imports `config` only and **never** the database layer.
- **`packages/domain` stays storage-agnostic.** No Drizzle types, no SQL, no SQLite specifics.
  It defines repository interfaces; `packages/database` implements them.
- **One transaction per business operation.** An approval writes the decision, the ledger
  entry, the audit event, and the outbox row together, or writes none of them.
- **Zod schemas in `packages/contracts` are the single source** for validation, types, and
  the OpenAPI document. Strict parsing — unknown keys are rejected, never silently stripped.
- **The desktop app supervises a separate server process.** Closing the window must never
  stop the server.
- **Only the server process opens the database.** Never a script, never the desktop app,
  never the operator.

---

## Before you finish any change

- [ ] `pnpm check` passes — format, lint, typecheck, tests
- [ ] New logic has a test; new failure modes have a failure test
- [ ] `docs/DEFERRED-WORK.md` updated if anything was completed or deferred
- [ ] Docs updated in the same commit if behaviour changed — never "docs later"
- [ ] `CHANGELOG.md` updated for anything user-visible
- [ ] A new ADR if an architectural decision was made or reversed
- [ ] No secret, no real data, no `console.log` of anything sensitive
- [ ] New UI implements all nine states (see `docs/DESIGN-SYSTEM.md` §5) and works at 360px
- [ ] New permissions added to the RBAC matrix **and** to the generated denial tests

---

## Reporting

At every milestone report: files created and changed · commands run · test results with
actual output · remaining risks · **claims that are not verified** · next milestone and what
it needs.

Be accurate about what was tested versus what was written. An untested claim stated
confidently is worse than an admitted gap.
