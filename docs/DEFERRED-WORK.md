# Deferred work register

Everything deliberately **not** built, why, and what unblocks it.

**This file is created at the start of the project, not at the end.** A list of deferred
work written from memory after v1 is always incomplete — the items get forgotten precisely
because they were deferred. This one is updated at every milestone, and `AGENTS.md` at the
repository root makes that obligation explicit for anyone who touches the code afterwards.

**Status values:** `DEFERRED` (decided, not built) · `BLOCKED` (waiting on external input) ·
`IN PROGRESS` · `DONE` (with date and evidence).

Last reviewed: **2026-09-23** (earned leave rates, loss of pay on the employee dashboard, monthly permission).
Next review: at the next scheduled release milestone.

---

## 1. Blocked on company or legal approval

These must not be built until someone qualified signs off. Building them earlier creates
legal exposure, not features.

| ID    | Item                                                                | Status  | Unblocked by                                                                                                                                               | Ref        |
| ----- | ------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| DW-01 | Statutory leave entitlements (maternity, paternity, statutory sick) | BLOCKED | Jurisdiction confirmed **and** rules verified by a qualified company/legal/payroll representative                                                          | D-05       |
| DW-02 | Payroll calculation — gross/net, deductions                         | BLOCKED | As DW-01. Payroll stays an integration until then                                                                                                          | D-05, D-12 |
| DW-03 | Tax withholding                                                     | BLOCKED | As DW-01                                                                                                                                                   | D-05       |
| DW-04 | Provident Fund (PF)                                                 | BLOCKED | As DW-01                                                                                                                                                   | D-05       |
| DW-05 | ESI                                                                 | BLOCKED | As DW-01                                                                                                                                                   | D-05       |
| DW-06 | Gratuity                                                            | BLOCKED | As DW-01                                                                                                                                                   | D-05       |
| DW-07 | Leave encashment calculation                                        | BLOCKED | Company policy plus legal confirmation. The `ENCASHMENT` ledger entry type exists so the record can be made manually; no formula is applied                | D-05       |
| DW-08 | Automated data deletion / anonymisation / archival jobs             | BLOCKED | A written retention policy **and** company/legal approval. Classifications and dates are stored from day one so this is possible later without a migration | D-21       |

**Rule for all of the above:** the UI states plainly, where a user would expect the feature,
that it is not calculated by this system and why. No silent absence.

---

## 2. Blocked on information the company has not yet supplied

| ID    | Item                                             | Status  | Unblocked by                                                                                                       | Ref  |
| ----- | ------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------ | ---- |
| DW-09 | Biometric / attendance-device integration        | BLOCKED | Device brand, model, API, and export format                                                                        | D-11 |
| DW-10 | Payroll product adapter (specific format)        | BLOCKED | Payroll system name and a sample export/import file                                                                | D-12 |
| DW-11 | Excel migration validated against real workbooks | BLOCKED | Anonymised sample workbooks, or at minimum the column headers and row counts                                       | D-14 |
| DW-12 | Final hostname, IP, and firewall configuration   | BLOCKED | The company naming the responsible IT/network person                                                               | D-17 |
| DW-13 | Certificate authority decision                   | BLOCKED | Whether an internal CA or managed Windows domain already exists                                                    | D-18 |
| DW-14 | Signed Windows installer                         | BLOCKED | A Windows code-signing certificate. Unsigned is acceptable for the internal pilot with published checksums         | D-19 |
| DW-15 | Argon2 parameters calibrated on the real host    | BLOCKED | Access to the actual server machine (D-16). Provisional OWASP-minimum values used until then, recorded in ADR 0005 | D-16 |
| DW-16 | Clean-machine install verified on the target OS  | BLOCKED | The actual Windows version and hardware                                                                            | D-16 |

---

## 3. Deferred by scope decision

Designed for in the schema and navigation; not built in Phase 1.

| ID    | Item                                            | Status   | Phase | Ref                                                                                                                                                                       |
| ----- | ----------------------------------------------- | -------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DW-17 | Onboarding / offboarding checklists             | DEFERRED | 2     | Scope §3                                                                                                                                                                  |
| DW-18 | Company assets and assignment history           | DEFERRED | 2     | Scope §3                                                                                                                                                                  |
| DW-19 | Expense claims and approvals                    | DEFERRED | 2     | Scope §3                                                                                                                                                                  |
| DW-20 | Employee document metadata and expiry reminders | DEFERRED | 2     | Scope §3                                                                                                                                                                  |
| DW-21 | Shifts, rosters, regularisation, overtime       | DEFERRED | 2     | Scope §3                                                                                                                                                                  |
| DW-22 | Payroll input preparation module                | DEFERRED | 2     | Scope §3                                                                                                                                                                  |
| DW-23 | Recruitment and candidate tracking              | DEFERRED | 3     | Scope §4                                                                                                                                                                  |
| DW-24 | Performance reviews and goals                   | DEFERRED | 3     | Scope §4                                                                                                                                                                  |
| DW-25 | Training and certification tracking             | DEFERRED | 3     | Scope §4                                                                                                                                                                  |
| DW-26 | Employee letters and document templates         | DEFERRED | 3     | Scope §4                                                                                                                                                                  |
| DW-27 | Single sign-on / Active Directory               | DEFERRED | —     | D-15. Local accounts only in v1                                                                                                                                           |
| DW-28 | Mobile applications                             | DEFERRED | —     | Responsive web from 360px covers it                                                                                                                                       |
| DW-29 | Cloud / PostgreSQL as the office product        | DEFERRED | —     | Office go-live stays SQLite on one Windows machine. A **preview-only** Postgres path exists behind `DATABASE_URL` (DW-41) and must be removed or left unset at deployment |
| DW-30 | Multi-tenancy                                   | DEFERRED | —     | One company, one machine                                                                                                                                                  |

---

## 4. Known-incomplete behaviour inside Phase 1

Things that ship in v1 but are deliberately partial. These are the ones most likely to be
forgotten, so they are listed most explicitly.

| ID    | Item                                       | What is incomplete                                                                                                                                                                                                                                                                                                                                                                                                                                | Unblocked by                                                                                                                                                                                                     |
| ----- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DW-31 | **Login-derived attendance**               | A login proves an account authenticated, not that a person was present. v1 stores it as a raw _signal_ (`source = 'login'`, first and last login of the day) feeding the raw-plus-corrections model. **v1 will not infer absence from a missing login.**                                                                                                                                                                                          | Company rules for what a login means: expected hours, remote work, half-day thresholds, and what a missing login should imply. Flagged by the company as needing finetuning (D-11)                               |
| DW-32 | **Admin self-approval**                    | An Admin can approve their own leave (D-08). Genuine separation-of-duties gap, accepted deliberately. Mitigated by a distinct audit action, visible labelling, and a standing report                                                                                                                                                                                                                                                              | Company creating a second Admin account so self-approval becomes the last resort rather than routine                                                                                                             |
| DW-33 | **Bulk credential provisioning**           | Delivered as generated temporary passwords plus a one-time credential sheet, not as the requested SQL file of usernames and passwords — Argon2id stores a one-way hash, and a file of live passwords in circulation is a standing risk                                                                                                                                                                                                            | Company confirming the credential-sheet flow is acceptable, or requesting a hashed-password `INSERT` script generated _by_ this system (safe, and easy to add)                                                   |
| DW-34 | **Email delivery**                         | Best-effort through a configured mailbox. Requires network access to the mail provider; queued and retried when unreachable. In-app notifications are unaffected and remain primary                                                                                                                                                                                                                                                               | Mailbox credentials, and confirmation of the provider                                                                                                                                                            |
| DW-35 | **Leave-year boundary change mid-year**    | Permitted, but guarded: confirmation, impact preview, automatic backup, audit event. Does not automatically re-partition existing ledger periods                                                                                                                                                                                                                                                                                                  | Company policy on what _should_ happen to an in-progress leave year when the boundary moves                                                                                                                      |
| DW-36 | **Manager approval rights**                | DONE 2026-09-09. Hierarchical routing (ADR 0012) sends team-member requests to the team lead. The original D-08 “HR-only” routing was superseded. Evidence: `hierarchy.test.ts`, Approvals inbox.                                                                                                                                                                                                                                                 | —                                                                                                                                                                                                                |
| DW-37 | **Leave rules ship with working defaults** | The system installs a starter set of leave types and rules that HR edits in Settings → Leave Rules. They are ordinary published policy versions, not labelled scaffolding. **HR must review and adjust them to the company's actual policy before go-live** — that remains a go-live step, but the software behaves correctly either way                                                                                                          | HR reviewing the rules. Superseded the earlier "placeholder" labelling, which the company asked to be removed as it is production software (2026-08-27)                                                          |
| DW-38 | **Disk-full failure test (F-10)**          | May not be simulable in the available environment                                                                                                                                                                                                                                                                                                                                                                                                 | If it cannot be run, it is recorded as _not verified_ — never quietly skipped                                                                                                                                    |
| DW-39 | **Accessibility manual pass**              | Automated axe checks catch roughly a third of real issues                                                                                                                                                                                                                                                                                                                                                                                         | A recorded manual keyboard and NVDA pass. Until then, accessibility is _not_ claimed as verified                                                                                                                 |
| DW-40 | **Optional/restricted holidays**           | Stored and displayed; not auto-excluded from working-day counts, and no per-employee quota of optional holidays                                                                                                                                                                                                                                                                                                                                   | Company rules on how many optional holidays an employee may take                                                                                                                                                 |
| DW-41 | **Supabase/Postgres preview adapter**      | Temporary path so the company can click a hosted link. `DATABASE_URL` / `SUPABASE_DB_URL` switches the API to Postgres. Default and office go-live remain SQLite. Not a second product; do not keep the URL in production config. File backup (`VACUUM INTO`) is SQLite-only. The browser must never use a Supabase anon key. A Vercel Function entry (`server.ts`) now exists for this preview; it must not be treated as the office deployment. | Verification finished → unset the URL, pause/delete the Vercel project, drop the Supabase project, ship SQLite. Remove `packages/database/src/postgres.ts` and `server.ts` when the preview is no longer needed. |
| DW-64 | **Hosted-preview limitations**             | Vercel + Supabase is for testing only. Attachments live in `/tmp` and vanish between instances. File backup is disabled. In-process job timers do not run; a daily cron tick and a cold-start tick cover outbox/session sweep/accrual. Concurrent requests share one Postgres connection and are serialised in `withTx`.                                                                                                                          | Accept for verification, or run the office SQLite build. Remove with DW-41 when the preview is torn down                                                                                                         |

---

## 4a. Resolved in the remediation pass — 2026-08-26

Defects found by full-codebase inspection after the first build. Kept as a record, per the
rule that `DONE` rows are never deleted. Detail in
[IMPLEMENTATION-LOG.md](IMPLEMENTATION-LOG.md).

| ID    | Item                                                                                                                        | Status          | Evidence                                                                                                    |
| ----- | --------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| DW-42 | **Login accepted any password**, and a failed attempt crashed the server (un-awaited async `fail()` in `login()`)           | DONE 2026-08-26 | `auth.test.ts`: wrong password → 401, no `set-cookie`, zero session rows, server still answering            |
| DW-43 | `no-floating-promises` was not enabled, so the whole defect class was invisible to lint                                     | DONE 2026-08-26 | Type-aware ESLint (`projectService`); `pnpm lint` clean                                                     |
| DW-44 | Withdraw did not await its ledger release; three `audit()` writes and the notification-read write escaped their transaction | DONE 2026-08-26 | Surfaced by DW-43 and fixed; `pnpm check` green                                                             |
| DW-45 | First-run seeding race left the administrator without most opening balances                                                 | DONE 2026-08-26 | `auth.test.ts`: grant count equals entitled leave-type count                                                |
| DW-46 | Sign-out left the user inside the application (`queryClient.clear()` does not re-render)                                    | DONE 2026-08-26 | Browser: returns to sign-in; replayed cookie → 401                                                          |
| DW-47 | Sample-account passwords were unreachable and all were flagged for forced change, so only the administrator could sign in   | DONE 2026-08-26 | Sign-in screen lists them in development, from an explicit `demo.accounts` marker; all five roles signed in |
| DW-48 | `.env` was never read, and development wrote to `%PROGRAMDATA%` (needs elevation)                                           | DONE 2026-08-26 | `loadDotEnv()`; development defaults to `./data`                                                            |
| DW-49 | Bundled fonts never applied — `'Instrument Sans'` vs the registered `'Instrument Sans Variable'`                            | DONE 2026-08-26 | `--font-body` names both                                                                                    |
| DW-50 | Attachments could be uploaded but never retrieved                                                                           | DONE 2026-08-26 | `GET /api/v1/attachments/:id`, permission-checked, path-guarded, 403 identical for missing and forbidden    |
| DW-51 | Missing accessible names: sample-account buttons, duration radios (announced "on"), mobile menu button                      | DONE 2026-08-26 | Accessibility tree reports each name                                                                        |

---

## 4b. Resolved in the production-readiness pass — 2026-08-27

| ID    | Item                                                                                                                                                                                            | Status          | Evidence                                                                                                                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DW-52 | **Production server served no interface at all** — the static path resolved to `<repo>/web/dist`, which never exists                                                                            | DONE 2026-08-27 | Production build on :3300 returns 200 with the real `index.html`, CSS, JS, and fonts                                                                                                                                          |
| DW-53 | **Strict CSP would have left the production UI unstyled and unfontned** — `style-src 'self'` blocks React style attributes, `font-src 'self'` blocks the bundler's inlined `data:` font subsets | DONE 2026-08-27 | `style-src 'self' 'unsafe-inline'`, `font-src 'self' data:`; script-src left strict. Zero CSP violations in the console; `Instrument Sans Variable` reports `loaded`                                                          |
| DW-54 | **`/api/v1/dashboard` had no permission check** — any employee could read company headcount, department leave statistics, and the pending queue                                                 | DONE 2026-08-27 | `calendar.test.ts`: employee 403, HR 200                                                                                                                                                                                      |
| DW-55 | **A holiday date could hold several kinds at once** — `UNIQUE (calendar, date, kind)` meant re-marking a day added a row rather than replacing one, so the calendar appeared not to change      | DONE 2026-08-27 | Migration `0002_holiday_one_kind_per_date`; upsert route; tests assert one row per date                                                                                                                                       |
| DW-56 | **Deleting a holiday deleted that date from every calendar** in the company                                                                                                                     | DONE 2026-08-27 | Delete is calendar-scoped and validates the date format                                                                                                                                                                       |
| DW-57 | **Calendar changes were silent** — no validation, no error surfacing, no confirmation, and an empty name defaulted to the literal string "public"                                               | DONE 2026-08-27 | Name validation, error and status messages, prefill on select, keyboard grid navigation, legend, empty state                                                                                                                  |
| DW-58 | **Calendar and policy changes wrote no audit event**                                                                                                                                            | DONE 2026-08-27 | `holiday.created` / `holiday.updated` / `holiday.removed` and `leave.policy.published` with before/after, each inside its transaction                                                                                         |
| DW-59 | **The rules editor exposed only entitlement days** — the domain enforced thirteen rules, the UI could change one                                                                                | DONE 2026-08-27 | Full editor: accrual, pro-rating, carry-forward cap and expiry, probation, half-days, notice, consecutive cap, negative balance, attachment threshold, effective date. Tests prove a published change is enforced immediately |
| DW-60 | **Development scaffolding was visible as product** — a placeholder warning banner, a "Placeholder rules: Yes" KPI, and "Placeholder entitlement" on every balance card                          | DONE 2026-08-27 | `isPlaceholder` removed from the domain type, contracts, seed, `/me`, health, and every screen                                                                                                                                |
| DW-61 | **Dashboard metrics included a non-metric**; balances showed a meaningless "0 / 0" card                                                                                                         | DONE 2026-08-27 | Four actionable KPIs (awaiting decision with oldest wait, out today with names, starting within 7 days, active employees). Types with no entitlement and no history no longer render a balance card                           |
| DW-62 | **"Taken" was inferred as entitlement minus remaining**, which is wrong once an adjustment or carry-forward exists                                                                              | DONE 2026-08-27 | Taken is summed from `DEDUCTION`/`ENCASHMENT`/`EXPIRY` ledger entries directly                                                                                                                                                |
| DW-63 | Seeded fake public holidays presented as real company data                                                                                                                                      | DONE 2026-08-27 | The calendar starts empty; HR enters the company's real holidays. Test asserts zero seeded holidays                                                                                                                           |

---

## 4c. Resolved in the hierarchy and hosted-preview pass — 2026-09-09

| ID    | Item                                                                                                                          | Status          | Evidence                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------- |
| DW-65 | Hosted preview seeded before hierarchical approval, so Sofia and the Engineering org were missing after `seedOnEmpty` had run | DONE 2026-09-09 | `ensureDemoHierarchy` on hosted cold start; `demo-hierarchy-backfill.test.ts` |

---

## 4d. Resolved in the office security and hierarchy notification pass — 2026-09-12

| ID    | Item                                                                                                                              | Status          | Evidence                                                                                                                                     |
| ----- | --------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| DW-66 | **Office Network Perimeter Enforcement** — remote/offsite IP logins could falsely record office attendance                        | DONE 2026-09-12 | `isOfficeNetwork(ctx.ip)` check in `auth.ts`, suppressing attendance signals and logging `auth.offsite_attendance_suppressed`; test verified |
| DW-67 | **Workstation-to-Employee 1:1 Device Binding** — shared terminals allowed cross-account logins ("buddy punching")                 | DONE 2026-09-12 | Migration `0004_workstation_device_binding.sql`, `X-Workstation-Id` header enforcement, 403 `WORKSTATION_MISMATCH` with audit logging        |
| DW-68 | **Team Lead On-Behalf Sudden Leave** — absent employees unable to log in could not have leave recorded by their leads             | DONE 2026-09-12 | `leave.request.create:team` permissions, `Apply.tsx` On-Behalf applicant selector, target member notification & audit attribution            |
| DW-69 | **Downstream Higher-Up Notifications** — approved leave was not visible to higher-ups, or spammed managers with rejected requests | DONE 2026-09-12 | `decideLeave` dispatches `leave.approved.informational` to Dept Head / HR / Admin on approve, and suppresses higher-up alerts on reject      |

---

## 4e. Resolved against the Leave Tracker functional framework — 2026-09-21

The Word document in `docs/Leave Tracker Application.docx` is the original functional
framework. Most of it was already in v1; these were the remaining user-visible gaps.

| ID    | Item                                                               | Status          | Evidence                                                                                   |
| ----- | ------------------------------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------ |
| DW-70 | Employee dashboard monthly summary, identity, pending vs available | DONE 2026-09-21 | `calendar.test.ts` home: available stays 12 while 5 days pending; `Home.tsx` monthly table |
| DW-71 | Monthly payroll report (Opening, Earned, Used, Pending, Closing)   | DONE 2026-09-21 | `framework.test.ts`; Reports → Monthly Payroll; Excel sheet `Monthly Payroll`              |
| DW-72 | Holiday list Excel/CSV import                                      | DONE 2026-09-21 | `calendar.test.ts` holiday spreadsheet import; `/api/v1/holidays/import`                   |
| DW-73 | Overlapping own leave blocked                                      | DONE 2026-09-21 | `leave.test.ts` `LEAVE_OVERLAP`; complementary AM/PM on the same day still allowed         |
| DW-74 | Default earned leave 2 days/month, 24/year                         | DONE 2026-09-21 | `defaultRulesForCode('EL')`; `grantOpeningBalances` writes `ACCRUAL` + `accrual_run`       |
| DW-75 | Employee mobile number                                             | DONE 2026-09-21 | `framework.test.ts` stores phone on `employee_contact`                                     |

---

## 4f. Resolved against the rest of the Leave Tracker framework — 2026-09-22

| ID    | Item                                                                                         | Status          | Evidence                                                                                                      |
| ----- | -------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------- |
| DW-76 | Reporting manager approves leave, with dated history                                         | DONE 2026-09-22 | Migration `0006_reporting_manager.sql`; `packages/domain/src/leave/routing.ts`                                |
| DW-77 | Leave configuration: monthly credit, staff category, joining month, weekends and holidays    | DONE 2026-09-22 | `doc-requirements.test.ts` working week and accrual; Settings leave rules                                     |
| DW-78 | Leave transactions with manual credit and deduction                                          | DONE 2026-09-22 | `doc-requirements.test.ts` leave transactions; `Transactions.tsx`                                             |
| DW-79 | Annual leave report and monthly payroll sheet in the PDF                                     | DONE 2026-09-22 | `doc-requirements.test.ts` reports                                                                            |
| DW-80 | Government holiday year list, Excel import, and fixed-date national holidays                 | DONE 2026-09-22 | `doc-requirements.test.ts` government holidays; `holiday-sheet.ts`                                            |
| DW-81 | Profile, in-app password change, and sign-in with employee ID                                | DONE 2026-09-22 | `Profile.tsx`; `usecases/auth.ts`                                                                             |
| DW-82 | Duplicate casual and sick opening grant reversed on existing databases                       | DONE 2026-09-22 | Migration `0007_fix_double_opening_grant.sql`; `doc-requirements.test.ts` yearly entitlement is credited once |
| DW-83 | Simon & Sons sample organisation (17 people, designations, managers, holidays, sample leave) | DONE 2026-09-22 | `doc-requirements.test.ts` sample organisation; `usecases/demo.ts`                                            |

---

## 5. Review procedure

At the close of every milestone:

1. Re-read this file top to bottom.
2. Mark completed items `DONE` with the date and what evidences it.
3. Add anything newly deferred — including small ones. Especially small ones.
4. Move items between sections when their blocker changes.
5. Update "Last reviewed" above.
6. Carry Section 1 and Section 4 into the release notes, so nobody discovers a gap in production.

An item is never deleted from this file. `DONE` items stay as a record of what was resolved
and when.
