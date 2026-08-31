# Decisions register

**Status: all 21 items answered by the company on 2026-08-26.** This is no longer a
question list; it is the decision record the build is held to.

Where an answer changed the design, the affected documents are named. Where an answer
leaves something deliberately unfinalised, it is recorded as **deferred** and tracked in
[DEFERRED-WORK.md](DEFERRED-WORK.md).

---

## A. Company and policy

### D-01 — Legal entity · **ANSWERED: default accepted**

Single entity, "Simon & Sons". Schema supports multiple locations under one company.

### D-02 — Time zone · **ANSWERED: default accepted**

`Asia/Kolkata`. Timestamps stored UTC; calendar dates stored as plain `YYYY-MM-DD`.

### D-03 — Leave year boundary · **ANSWERED: make it configurable**

> "make it configurable by the HR so it doesn't crash or anything"

The leave year start (month and day) is an HR-editable setting, not a constant.

**Design impact:** `company.leave_year_start_month` / `leave_year_start_day` were already
in the schema. Added: an HR settings screen to edit them, and a **guard** — changing the
leave year boundary while a leave year is in progress is a significant operation. It is
allowed, but it requires confirmation, shows exactly which periods and ledger entries are
affected, takes an automatic backup first, and writes an audit event. It never silently
re-partitions existing ledger periods. → DATABASE-SCHEMA §3.1, PRODUCT-SCOPE §2.4

### D-04 — Leave policy rules · **ANSWERED: build a Rules page, keep placeholders modular**

> "have a rules page in settings to set the rules for leave or modularize the placeholder
> rules such that editing it later is easy"

Both, and they are the same thing done properly. Leave rules live in
`leave_policy_version.rules_json`, validated by a Zod schema, and are edited through a
**Settings → Leave Rules** screen by HR and Admin. Seed data ships clearly-labelled
placeholder values that HR replaces through the UI — no code change, no migration, no
developer involvement.

**Design impact:** the Rules page moves from "implied by the schema" to an explicit Phase 1
deliverable with its own screens. Editable per leave type: entitlement, accrual method and
cadence, pro-rating for mid-year joiners, carry-forward cap and expiry date, probation
restriction, half-day permission, minimum notice, maximum consecutive days, negative-balance
allowance, attachment requirement threshold. Publishing creates a new immutable version with
an effective date; existing requests stay bound to the version they were approved under.
→ PRODUCT-SCOPE §2.4, ARCHITECTURE §7, IMPLEMENTATION-PLAN M2

### D-05 — Statutory calculations · **ANSWERED: excluded, and tracked**

> "Do not implement statutory leave, payroll, tax, provident fund, ESI, gratuity or other
> legal calculations until the jurisdiction and verified rules are supplied and approved by
> a qualified company/legal/payroll representative."

Confirmed exclusion. Payroll is an integration, not a calculation engine.

**New deliverable requested:**

> "after completing the first version make a docs that has all such incomplete things to do
> and write a AGENTS.md file such that it doesn't forget to edit a task that is completed"

Two artefacts: [DEFERRED-WORK.md](DEFERRED-WORK.md) listing everything deliberately not
built and what unblocks each, and `AGENTS.md` at the repository root instructing any future
agent or developer to keep that list current.

**I am creating both now rather than after v1.** A list of everything deferred, written at
the end from memory, will be incomplete — the items get forgotten precisely because they
were deferred. Written from the start and updated as we go, it is accurate. Both files exist
as of today and are updated at every milestone.

### D-06 — Holidays and working days · **ANSWERED: fully HR-configurable**

> "the leave should be editable and configurable by the HR and admin, they should be able to
> set a day as holiday or make it as working according to their preferences"

HR and Admin can mark any date as a public holiday, an optional/restricted holiday, or a
**declared working day** (overriding a weekend). Per holiday calendar, so different
locations can differ. This was already designed via `holiday.kind` — now confirmed as a
first-class HR screen rather than an admin afterthought. → DATABASE-SCHEMA §3.4

### D-07 — Holiday list · Covered by D-06

HR enters the real list through the calendar screen, or imports it. Seed holidays are
synthetic placeholders, visibly labelled.

### D-08 / D-09 — Approval chain · **ANSWERED — this is the biggest design change**

> "the employee leave is approved by HR and in absence of HR admin does it, HR leave is
> approved by admin and admin leave is also approved by admin"

| Requester  | Approver                         | Fallback                       |
| ---------- | -------------------------------- | ------------------------------ |
| Employee   | **HR Officer**                   | Admin, when no HR is available |
| Manager    | **HR Officer**                   | Admin                          |
| HR Officer | **Admin**                        | Another Admin                  |
| Admin      | **Admin** — including themselves | —                              |

**What changed from the plan:** approval is centralised on HR, not on the reporting manager.
The Manager role no longer approves leave by default. It keeps team visibility, availability,
and overlap awareness, which is what it is actually for here.

**What did not change:** the configurable multi-step workflow engine is still built. This
routing is expressed _as_ a workflow configuration, so if you later want "manager approves,
then HR confirms", it is a settings change and not a rewrite.

**"In the absence of HR"** is made concrete rather than left to interpretation: a request
escalates to Admin when no active HR account exists, when every HR account is disabled, when
the assigned HR approver is themselves on approved leave for the request's decision date, or
when a configurable SLA elapses with no decision. All four are settings.

**Admin self-approval is a real risk and is handled explicitly.** It is permitted because
you require it, and it is the one place where the separation of duties genuinely breaks. It
is therefore: allowed only for the `admin` role, visibly labelled as a self-approval in the
UI and in the request record, written with a distinct audit action (`leave.self_approved`),
included in a standing report, and **not silently equivalent to a normal approval**.
Recommendation: create two Admin accounts so admin leave can normally be approved by the
other one, with self-approval as the genuine last resort. → RBAC §3, SECURITY T-01, ADR 0009

### D-10 — Scale · **ANSWERED: default accepted**

~50 employees now, architecture comfortable to **250 without change**. SQLite confirmed.
Performance testing at M8 uses a synthetic 250-employee dataset with five years of history.

---

## B. Systems and integration

### D-11 — Attendance · **ANSWERED: CSV/XLSX first, plus login-derived attendance**

> "Build CSV/XLSX attendance import first, preserving raw imported records and recording
> corrections separately. Do not build a biometric-device integration until the device brand,
> model, API and export format are supplied. employee logs in and attendance is logged for
> that day (this may need finetuning in the future)"

Two sources, both preserved as raw and immutable:

1. **File import** — CSV/XLSX, raw rows stored verbatim, corrections separate.
2. **Login-derived attendance** — a successful login writes an attendance signal for that
   date, with its timestamp and source.

**A caveat I want on the record, since you flagged it yourself.** A login is evidence that
an account authenticated, not that a person was present and working. Someone can work all
day without logging in, or log in from home. So login-derived attendance is stored as a
**signal**, never as an attendance verdict: `source = 'login'`, first and last login of the
day, and it feeds the same raw-plus-corrections model as imported data. HR sees it as one
input among others and can correct it. The system will not, in v1, tell you someone was
absent because they did not log in. That inference is exactly the "finetuning" you
anticipate, and it needs your rules before it is safe. → DEFERRED-WORK, ADR 0011

Biometric integration: not built. Blocked on device brand, model, API, and export format.

### D-12 — Payroll · **ANSWERED: generic integration only**

Generic, permission-controlled CSV/XLSX payroll input and export. No calculation engine. A
product-specific adapter is added only when the payroll system name and a sample format are
supplied. → DEFERRED-WORK

### D-13 — Email · **ANSWERED — second significant change: email is now in scope**

> "No SMTP server a simple email through the configured email should be sent the HR or admin
> from the app so that they can be notified of any requests from the employees and in that
> email there should be a redirect link to their login that allows to go to approve that or
> decline that. also in app notifications are also main, email is for safety not to miss any
> requests."

Email moves from "optional adapter, off by default" to a **Phase 1 feature**, delivered
through a configured mailbox account (an SMTP account such as a company Google Workspace or
Microsoft 365 mailbox) rather than a self-hosted mail server.

**The deep link is a redirect target, not a login bypass.** This matters, so it is explicit:
the email contains a normal HTTPS link to the request page. Clicking it, when not signed in,
lands on the login screen; after signing in, the user arrives at that request with the
approve and decline actions available. **No token in the email grants any authority.** There
is no one-click-approve-from-email, because that would be an approval mechanism with no
authentication, sitting in an inbox, forwardable.

**In-app notifications remain primary and always work.** Email is best-effort: it is queued
in the outbox, and if the mail provider is unreachable — no internet, wrong password,
provider throttling — the request, the notification, and the approval flow are completely
unaffected. Failed sends are visible to Admin, retried with backoff, and raise the control
panel to `degraded` if they accumulate. The system remains fully usable with email broken,
which is what "email is for safety" requires.

The mailbox password is stored via Windows DPAPI, never in config or the repository.
→ ARCHITECTURE §9, SECURITY §2, ADR 0008 (revised), ADR 0010

### D-14 — Excel sources · **ANSWERED: not supplied**

Workbooks, columns, data quality, and row counts unknown. The column-mapping UI is therefore
mandatory, not optional, and the dry run is the safety net. Templates are authored to a
sensible shape; your real files are mapped at migration time.

### D-15 — Authentication · **ANSWERED: local accounts, HR provisions**

> "the HR will assign logins for the employees or a sql file will be generated and given
> later to do the populating of db with the username and passwords"

Local accounts only. No Clerk, no cloud identity. HR creates accounts, individually or in
bulk.

**On the SQL-file path — I need to push back on one detail, and offer the equivalent that
is safe.** A SQL file containing usernames and passwords means plaintext (or reversibly
encoded) credentials sitting in a file, passed between people, probably over email or a USB
stick, and almost certainly kept afterwards. It is also incompatible with Argon2id, where
the database stores a one-way hash and there is no password to put in the file.

What is built instead, achieving the same outcome:

- **Bulk account provisioning by import.** HR uploads a spreadsheet of employees. The system
  generates a strong random temporary password per person, hashes it, and marks
  `must_change_password`.
- **A one-time credential sheet** is produced for HR to distribute — viewable and printable
  once, never re-retrievable, and its generation is audited. HR hands each person their
  temporary password; they must change it at first login.
- Existing accounts are skipped, not overwritten. The import is idempotent.

Same convenience, no file of live passwords in circulation. If you specifically need an
offline SQL artefact for a machine with no access, that can be produced as a hashed-password
`INSERT` script generated _by_ this system, which is safe — say so and it goes in.
→ SECURITY §2, DEFERRED-WORK

---

## C. Infrastructure and operations

### D-16 — Host machine · **ANSWERED: unknown, deferred**

Runs on a local company computer acting as the server. Windows version and hardware not yet
supplied. Development targets Windows 10/11 x64; **the clean-machine install test is run on
the actual target and its result recorded**, not assumed. Argon2 parameter calibration also
waits for the real host. → DEFERRED-WORK

### D-17 — Network ownership · **ANSWERED: unknown, do not finalise**

> "Do not finalize the hostname, IP address or firewall setup until the company identifies
> the responsible IT/network person."

The first-run wizard therefore **must not require** a final hostname. It offers: run on the
machine's current IP for a pilot, or enter a hostname when one exists — and it can be changed
later without reinstalling. The firewall rule is proposed, shown in full, and applied only
with explicit consent. Nothing is finalised silently. → ARCHITECTURE §3, DEFERRED-WORK

### D-18 — Certificates · **ANSWERED: preference order given, do not finalise**

1. Company's existing internal CA, if one exists.
2. Otherwise, a private application CA whose root is installed as trusted on every
   authorised client.
3. **Never** instruct users to ignore certificate warnings.

The wizard implements both paths and asks which applies, defaulting to neither until the
network environment is known. → SECURITY §3, DEFERRED-WORK

### D-19 — Code signing · **ANSWERED: unsigned for pilot, signed before production**

Unsigned installer acceptable for the internal pilot, with documented SmartScreen behaviour
and published SHA-256 checksums. A signed installer is recommended before wider
distribution. → DEFERRED-WORK

### D-20 — Backups · **ANSWERED: my call, HR is responsible**

Nightly automatic backup at 01:00 via the SQLite online backup API, each verified by opening
the copy and running an integrity check. Automatic backup before every migration and before
any leave-year boundary change. Retention 7 daily, 4 weekly, 12 monthly. Weekly manual
encrypted copy to external media, prompted by the control panel and confirmed by HR. A stale
backup raises the control panel to `degraded`. HR owns the weekly off-machine copy and the
quarterly restore drill; both are runbook items with a checkbox and a date.

### D-21 — Retention · **ANSWERED: no destructive deletion**

> "Do not silently assume indefinite legal retention."

- **No automatic deletion of anything.**
- Employee **deactivation**, never destructive deletion. The record and its history remain.
- Retention classification and relevant dates stored per record from the start, so a policy
  can be applied later without a migration.
- **Ex-employee access restricted immediately**: on exit, the account is disabled and every
  session revoked in the same transaction.
- Future archival, anonymisation, and deletion are made _possible_ — the classifications and
  dates exist — but no such job is built or scheduled.
- **Automated deletion requires company and legal approval before it is enabled.** It is not
  implemented in v1. → DATABASE-SCHEMA §6, DEFERRED-WORK

---

## Engineering decisions (mine, recorded for visibility)

| Decision                                                                                  | ADR                                                   |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| pnpm workspaces, TypeScript strict, Node 24, Fastify serving API and web from one process | [0001](adr/0001-stack-and-monorepo.md)                |
| Electron main supervises a separate server process                                        | [0002](adr/0002-desktop-supervises-server-process.md) |
| SQLite with WAL, `synchronous=FULL`, single writer                                        | [0003](adr/0003-sqlite-configuration.md)              |
| Balances derived from an immutable ledger                                                 | [0004](adr/0004-immutable-balance-ledger.md)          |
| Argon2id, opaque server-side sessions                                                     | [0005](adr/0005-authentication-and-sessions.md)       |
| `resource.action:scope` RBAC enforced in use-cases                                        | [0006](adr/0006-rbac-grammar-and-enforcement.md)      |
| Zod contracts generate validation and OpenAPI                                             | [0007](adr/0007-contracts-as-single-source.md)        |
| Outbox for notifications and email                                                        | [0008](adr/0008-outbox-for-notifications.md)          |
| **HR-centred approval routing with Admin fallback and self-approval**                     | [0009](adr/0009-approval-routing.md)                  |
| **Email deep links are redirect targets, never authority-bearing**                        | [0010](adr/0010-email-deep-links.md)                  |
| **Login-derived attendance is a signal, not a verdict**                                   | [0011](adr/0011-login-derived-attendance.md)          |

## Standing constraints

- No invented leave rules — HR configures them through the Rules page (D-04).
- No statutory payroll, tax, PF, ESI, or gratuity calculation (D-05).
- No real employee data or credential in the repository or installer.
- No security control weakened to make a test pass.
- No operator ever told to bypass a certificate warning (D-18).
- No automatic deletion of employee data (D-21).
- No claim that installation, LAN access, TLS trust, backup restore, or accessibility is
  verified unless that exact test was run and recorded.
