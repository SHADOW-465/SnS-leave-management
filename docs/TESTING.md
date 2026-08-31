# Testing strategy

Planning document. No tests exist yet.

**The rule this document exists to enforce:** a passing build is not evidence that anything
works. Installation, LAN access, TLS trust, backup restore, and accessibility are claimed
only when that exact test has been run and its output recorded.

---

## 1. Layers

| Layer       | Tool                                                   | Scope                                                         | Runs                  |
| ----------- | ------------------------------------------------------ | ------------------------------------------------------------- | --------------------- |
| Unit        | Vitest                                                 | `packages/domain` — pure functions, no I/O                    | Every commit, seconds |
| Integration | Vitest + a real temporary SQLite file                  | Repositories, use-cases, transactions, migrations             | Every commit          |
| API         | Vitest + Fastify `inject`                              | Routes, validation, auth, RBAC denials                        | Every commit          |
| Component   | Vitest + Testing Library + axe-core                    | UI states, keyboard, labels                                   | Every commit          |
| End-to-end  | Playwright against a real server and a seeded database | Full journeys per role                                        | Every PR, nightly     |
| Manual      | Recorded checklists                                    | Windows install, LAN, TLS trust, restore drill, screen reader | Per release           |

Integration tests use a **real SQLite file** in a temp directory, not an in-memory database
and not a mock. In-memory SQLite behaves differently under WAL and concurrency, which is
precisely the behaviour being tested.

---

## 2. Unit tests — the leave engine

This is where the product's correctness actually lives.

**Working-day calculation** — weekend exclusion; public holidays; optional holidays (not
auto-excluded); `declared_working` days that override a weekend; per-location calendars;
a range that is entirely holidays; a single-day request; a range crossing a year boundary;
a range crossing a policy version boundary.

**Half-days** — AM only; PM only; AM start with PM end; a half-day on a holiday; a half-day
where the policy forbids half-days; a request that is a single half-day.

**Accrual** — monthly accrual; accrual for a mid-month joiner (pro-rating); accrual during
probation where restricted; no accrual for an exited employee; accrual with a cap; accrual
that lands on a month with no 31st.

**Carry-forward** — under the cap; exactly at the cap; over the cap (truncated, with the
truncation recorded as its own ledger entry); expiry of carried days on the expiry date;
expiry when a request consumed them the day before; carry-forward for an employee with a
negative balance.

**Probation** — leave forbidden during probation; leave allowed after probation ends; a
request spanning the probation end date; a probation extension.

**Balance ledger** — sum with mixed entry types; pending hold reduces available; hold
release restores; deduction after approval; cancellation credit; adjustment with a reason;
a reversing entry; the sum never uses floating point.

**State machine** — every legal transition succeeds; **every illegal transition is
rejected** (all 64 pairs enumerated and asserted); the actor is checked per transition;
side effects fire exactly once.

**RBAC scope resolution** — `direct_reports` versus `reports_recursive` on a three-level
tree; a manager with no reports; an employee who is their own manager (rejected at write
time); a cycle in the reporting graph (rejected); a scope computed for an employee with no
department.

**Import normalisation** — date formats (`DD/MM/YYYY`, `MM/DD/YYYY`, Excel serial numbers,
ISO); numbers with thousands separators; leading and trailing whitespace; blank versus zero
versus null; manager resolution by employee code and by email; duplicate detection;
CSV formula-injection prefixes on export.

---

## 3. Integration tests

- Migrations apply from empty to current, and are idempotent when re-run.
- A failed migration leaves the database at the previous version, and the server refuses to start.
- PRAGMAs verified in effect after startup.
- Approve writes the decision, ledger entry, audit event, and outbox row **in one
  transaction** — a forced failure at each step rolls back all of them, verified by row counts.
- Session lifecycle: create, use, expire, revoke; revoked session yields 401.
- Password reset: temporary password, forced change, all other sessions revoked.
- Upload: valid PDF accepted; a `.pdf` that is really a script rejected; oversize rejected
  while streaming; traversal filename stored safely; download requires permission.
- Audit records written for every security-sensitive action, with `before`/`after`.
- Backup: created via the online backup API, verified by integrity check, restored into an
  isolated directory, and the restored data compared row-for-row against the source.
- Concurrent duplicate submission with the same idempotency key produces exactly one request.

---

## 4. RBAC denial tests

Generated from the matrix in [RBAC.md](RBAC.md) §3 rather than hand-written, so a new
permission cannot be added without its denials.

For every (role, permission) pair marked `—`, a test authenticates as that role and calls
the endpoint **directly**, asserting 403 and an audit event. Plus:

- The route table is enumerated and every route is asserted to require authentication,
  except the explicit public allowlist (`/healthz`, login, static assets).
- Scope leakage: a manager listing employees receives only their subtree, checked by
  comparing against the full set.
- Field-level: a manager fetching a report's profile receives no payroll or identity fields
  in the response body — asserted on the serialised JSON, not on the UI.
- A request body carrying `role` or `scope` is rejected by strict parsing, and audited.
- 403 for a non-existent record is indistinguishable from 403 for an existing one.

---

## 5. Failure and concurrency tests

The tests that decide whether this system can be trusted with real data.

| #    | Test                                                                               | Expected                                                                                                                                                                                                               |
| ---- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01 | Two managers approve the same request simultaneously                               | One succeeds. The other receives a conflict naming the deciding manager. **Exactly one** `DEDUCTION` ledger entry exists.                                                                                              |
| F-02 | Two requests submitted concurrently, together exceeding the remaining balance      | One succeeds, one is rejected for insufficient balance. The ledger sum never goes below the policy floor.                                                                                                              |
| F-03 | Server process killed (`SIGKILL`) mid-write                                        | On restart: integrity check passes, the incomplete transaction is absent, no partial ledger entry exists.                                                                                                              |
| F-04 | Restart after an unclean stop                                                      | WAL recovered, migrations consistent, server reaches `running`.                                                                                                                                                        |
| F-05 | Malformed Excel file — wrong columns, merged cells, formulas, a 50k-row file       | Rejected at validation with row-level errors. Nothing written.                                                                                                                                                         |
| F-06 | Attachment path traversal — `../../config.json` as a filename and as a download id | Rejected. Nothing outside the attachments root is ever read.                                                                                                                                                           |
| F-07 | Unauthorised direct API calls across the whole matrix                              | 403 for every denied pair, each audited.                                                                                                                                                                               |
| F-08 | Expired and revoked sessions on every authenticated route                          | 401 everywhere.                                                                                                                                                                                                        |
| F-09 | A migration that fails halfway                                                     | Database at the previous version, server refuses to start, backup present, error message names the migration.                                                                                                          |
| F-10 | Disk full during a write and during a backup                                       | Clear error, no corruption, control panel enters `degraded`. Simulated via a size-capped volume where the environment allows; if it cannot be simulated it is recorded as **not verified**, not quietly skipped.       |
| F-11 | Restore from backup into an isolated directory                                     | Restored database opens, passes integrity check, contains the expected rows, and the live database is untouched.                                                                                                       |
| F-12 | Idempotent replay of approve and of import commit                                  | Second call returns the original response. No second ledger entry, no second import.                                                                                                                                   |
| F-13 | Clock moves backwards (NTP correction)                                             | ULID ordering holds; no duplicate ids; no negative durations recorded.                                                                                                                                                 |
| F-14 | Server stopped while a user is mid-form                                            | Browser shows the server-unavailable state, not a crash. Work in the form is not silently lost.                                                                                                                        |
| F-15 | **Mail provider unreachable** — wrong password, no internet, connection refused    | The request submits, the in-app notification appears, the approval works. The email is queued, retried, and dead-lettered. **Nothing user-facing fails.** (D-13)                                                       |
| F-16 | **Email link followed while signed out**                                           | Lands on login, then on the request after authenticating. Followed by a user without permission: 403, no approval possible. **No token in the URL grants anything.** (ADR 0010)                                        |
| F-17 | **HR approves their own request**                                                  | 403. It routes to Admin instead.                                                                                                                                                                                       |
| F-18 | **Manager approves**                                                               | 403. Managers do not approve leave (D-08).                                                                                                                                                                             |
| F-19 | **Admin self-approval**                                                            | Succeeds, sets `was_self_approved`, writes `leave.self_approved`, appears in the self-approval report. Where a second Admin exists, the request routes to them first.                                                  |
| F-20 | **Each of the four HR-absence escalation conditions**                              | Each escalates to Admin, records the `escalation_reason`, and does not fire when the condition is absent.                                                                                                              |
| F-21 | **Leave-year boundary changed mid-year**                                           | Confirmation required, impact preview shown, automatic backup taken, audit written, existing ledger periods not silently re-partitioned (D-03, DW-35).                                                                 |
| F-22 | **Login attendance**                                                               | A login writes exactly one signal row per date; repeat logins extend `last_login_at` without creating rows; a failed attendance write never fails the login; **no absence is inferred from a missing row** (ADR 0011). |
| F-23 | **Bulk credential provisioning**                                                   | Temporary passwords generated and hashed; the credential sheet is retrievable exactly once; a second retrieval fails; re-running the import skips existing accounts (D-15).                                            |
| F-24 | **Employee exit**                                                                  | Status change disables the account and revokes every session **in one transaction**. No record is deleted. Historical data remains intact and readable (D-21).                                                         |

---

## 6. End-to-end journeys

Per role, on a seeded synthetic database, at 390px and 1280px.

**Employee** — sign in → forced password change → view balances → apply for leave (see the
working-day breakdown, the skipped days, the overlap warning, and the balance-after figure)
→ submit → see it pending → withdraw → reapply → see the approval → request cancellation.

**Manager** — sign in → view team availability → view a report's request → **confirm the
approve and reject controls are absent, and that calling the endpoint directly returns 403**
→ confirm no access to a peer's record.

**HR** — create an employee → create their account → bulk-provision accounts and retrieve the
one-time credential sheet → assign a manager → **configure leave rules through Settings →
Leave Rules and publish a new policy version** → set the leave year → mark a date a holiday
and another a declared working day → **approve an employee request from the approval queue**
→ run the Excel import dry run → review row errors → commit → adjust a balance with a reason
→ export a report → deactivate an exiting employee and confirm sessions are revoked.

**Payroll** — sign in → payroll export → confirm no approval controls exist and the approve
endpoint returns 403.

**Administrator** — first-run wizard → create the first administrator → create accounts →
assign roles → revoke a session → **approve an HR member's request** → **self-approve own
leave and confirm the label, audit action, and report entry** → configure the mailbox and
preview the notification email → view the audit log → create a backup → run a health check.

**Auditor** — read every module, receive 403 on every write.

**Cross-cutting** — keyboard-only completion of the apply and approve journeys; all nine
states exercised on at least the employee home, the approval queue, and the directory.

---

## 7. Release gates

Release is blocked unless every line is green **and** evidenced.

| Gate                                                            | Evidence required                                                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Format, lint, typecheck, unit, integration, e2e all pass        | CI run link and summary output                                                                      |
| Production build and Windows installer produced                 | Artefact paths and SHA-256 checksums                                                                |
| Clean-machine installation                                      | A completed checklist, run on the target Windows version, with timestamps and the operator's name   |
| Employee browser reaches the host over LAN HTTPS                | A screenshot from a **second physical machine** showing a valid certificate, plus the hostname used |
| RBAC denial tests pass                                          | Test count and the generated matrix coverage report                                                 |
| Live backup created and restored into an isolated directory     | Backup path, integrity check output, restored row counts compared against source                    |
| Migration and rollback boundaries documented                    | `UPGRADE-AND-ROLLBACK.md` updated for this version                                                  |
| No secrets or real employee data in the repository or installer | Secret scan output; a manual review of the seed data                                                |
| Dependency and licence reports generated                        | `pnpm audit` and licence report attached                                                            |
| Administrator can export all company data                       | The export produced, opened, and row counts reconciled                                              |
| **HR has replaced all placeholder leave rules**                 | Settings → Leave Rules shows no placeholder-flagged policy active (DW-37)                           |
| **`docs/DEFERRED-WORK.md` reviewed and current**                | Reviewed date updated; Sections 1 and 4 carried into the release notes                              |
| Accessibility                                                   | Automated axe results **plus** a recorded manual keyboard and NVDA pass                             |

**Coverage expectations** — `packages/domain` at 95% branch coverage, because it is pure and
there is no excuse. Use-cases at 85%. UI components at "every state rendered", which is a
more useful measure than a percentage. Coverage is a floor, never the goal; F-01 through
F-14 matter more than any number here.

---

## 8. Fixtures

- **Synthetic only.** Obviously fictional names, `@example.invalid` email addresses,
  round-numbered dates. No real employee data enters this repository at any point.
- Deterministic: a fixed seed and a fixed clock, so a test that fails once fails again.
- Sample workbooks for the migration flow are generated by a script, not committed as opaque
  binaries — so their contents are reviewable in a diff.
- Reconciliation totals are asserted: an import of N employees with a known total leave
  balance must produce exactly that ledger sum, and the import summary must state it.
