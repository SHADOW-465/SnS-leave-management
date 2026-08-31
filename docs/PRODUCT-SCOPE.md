# Product scope

**Product:** Simon & Sons Leave OS — a local-first employee and leave management system
for roughly 50 employees, running on one dedicated Windows machine on the office LAN.

**Status:** planning. Nothing is built.

---

## 1. The shape of the thing

One Windows computer in the office runs a desktop control panel. That control panel
starts and supervises a local web server. Everyone else — employees, managers, HR,
payroll, administrators — uses a normal browser on the office network. There is no
internet dependency for any core function.

When an authorised operator explicitly stops the server and exits the control panel,
the site becomes unavailable. That is intended, and it is stated plainly in the operator
documentation along with the consequences of sleeping or shutting down the host.

---

## 2. Phase 1 — production MVP (the release)

Everything here is required for the first release. Nothing here is optional.

### 2.1 Organisation

- Company record; locations; departments; teams; job titles; employment types
- Reporting-manager relationships, including reassignment and its effect on in-flight approvals

### 2.2 Employees

- Directory with search, filter, and permission-scoped visibility
- Profile: status, joining date, probation period and its end, contact details, emergency contact
- Employment history (role, department, manager, employment type — each with effective dates)

### 2.3 Accounts and access

- Local accounts: login, logout, password change (D-15). No cloud identity provider
- HR provisions accounts individually, or in bulk by importing a spreadsheet — the system
  generates strong temporary passwords, marks them for forced change, and produces a
  **one-time credential sheet** for HR to distribute. No file of live passwords is ever
  created or circulated (DW-33)
- Administrator-assisted reset issuing a temporary password that must be changed on first use
- **Employee deactivation, never destructive deletion** (D-21). On exit the account is
  disabled and every session revoked in the same transaction
- Session list and revocation; failed-attempt lockout with incremental delay; account disablement
- Server-enforced RBAC with scope. See [RBAC.md](RBAC.md).

### 2.4 Leave

- **Settings → Leave Rules**, an HR/Admin screen for every policy value (D-04): entitlement,
  accrual method and cadence, mid-year pro-rating, carry-forward cap and expiry, probation
  restriction, half-day permission, minimum notice, maximum consecutive days, negative-balance
  allowance, attachment requirement threshold. Publishing creates a new immutable version with
  an effective date. Seeded values are visibly labelled placeholders and **must be replaced by
  HR before go-live** (DW-37).
- **Settings → Leave Year**, HR-configurable start month and day (D-03). Changing it mid-year
  requires confirmation, shows the affected periods, takes an automatic backup, and is audited.
- **Holiday calendar management** (D-06): HR and Admin can mark any date a public holiday, an
  optional/restricted holiday, or a **declared working day** overriding a weekend. Per calendar,
  so locations can differ.
- Leave types; **versioned** policies with effective dates; per-location holiday calendars
- Accrual, carry-forward with cap and expiry, probation rules, half-days (AM/PM)
- Attachments on requests, with a policy-driven requirement rule
- Immutable balance ledger; balances are always derived, never stored as a mutable number
- Requests: draft, submit, withdraw, approve, reject, request cancellation, cancel
- Comments and full approval history per request
- Configurable multi-step approval. **Configured for D-08/D-09: HR approves employee and
  manager requests, Admin approves HR requests and acts as fallback, Admin self-approval is
  permitted and separately audited. Managers do not approve.** The engine remains general, so
  manager approval is a settings change if wanted later.

### 2.5 Visibility

- Team availability grid and month calendar, both permission-scoped
- Overlap warning shown while applying, not after

### 2.6 Attendance (D-11)

- CSV/XLSX import; **raw imported rows preserved verbatim and never edited**
- **Login-derived attendance**: a successful login records a signal for that date, with first
  and last login times. Stored as a _signal_, never a verdict — **v1 does not infer absence
  from a missing login**, and says so where it could mislead. The inference layer waits on
  company rules (DW-31)
- Corrections stored as separate records with actor, reason, and timestamp
- The effective value is derived from raw + corrections
- No biometric-device integration until device brand, model, API and format are supplied (DW-09)

### 2.7 Notifications (D-13)

- In-app notification centre with read state and a persistent history — **primary, always works**
- **Email to HR/Admin on new requests**, through a configured mailbox account, containing a
  link to the request. The link is a **redirect target with no authority**: it leads to login,
  then to the request. No one-click approval from email
- Email is best-effort: queued in the outbox, retried, and a failure never affects a request,
  a notification, or an approval. The system stays fully usable with email broken
- Admin can preview exactly what the system sends before enabling it

### 2.8 Reporting

- Leave taken by department, by month, by type; balance snapshots; pending-ageing
- CSV and XLSX export, server-side, permission-checked, audited

### 2.9 Trust and operations

- Append-only audit history for security-sensitive and business-sensitive actions
- Backup, verified restore, full data export, import validation, health status, log viewing, migration management
- **Retention classifications and dates stored on records from day one**, making future
  archival and anonymisation possible without a migration. **No deletion job is built**, and
  none may be enabled without company and legal approval (D-21, DW-08)
- [DEFERRED-WORK.md](DEFERRED-WORK.md) and root `AGENTS.md`, maintained from the start and
  updated at every milestone, so nothing deferred is silently forgotten (D-05)
- Desktop control panel with the full state and action set described in [ARCHITECTURE.md](ARCHITECTURE.md) §8
- Excel migration flow with templates, mapping, dry run, row errors, and idempotent commit

---

## 3. Phase 2 — operational modules (after Phase 1 is live and stable)

Designed for in the schema and the navigation now; built later.

1. Onboarding and offboarding checklists
2. Company assets, assignment and return history
3. Expense claims and approvals
4. Employee document metadata, expiry reminders, private attachments
5. Shift definitions, rosters, attendance regularisation, overtime inputs
6. Payroll **input preparation** and an approved export/import integration

## 4. Phase 3 — optional modules

1. Recruitment and candidate tracking
2. Performance review cycles and goals
3. Training and certification tracking
4. Employee letters and document templates

---

## 5. Explicitly excluded

These are not deferred. They are out of scope, and the product will say so in the UI
wherever a user might reasonably expect otherwise.

| Excluded                                                                            | Why                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Statutory payroll calculation** — tax, PF, ESI, gratuity, labour-law entitlements | Requires a supplied jurisdiction and verified rules, plus legal sign-off. Inventing these creates legal exposure. Payroll here is an integration and a controlled export/import workflow, and the UI says exactly that.                                                                    |
| **Salary processing, payslips, bank files**                                         | Same reason.                                                                                                                                                                                                                                                                               |
| **Internet exposure of the employee site**                                          | LAN only. Public exposure is opt-in, unsupported, and blocked pending a security review.                                                                                                                                                                                                   |
| **Mobile applications**                                                             | The web interface is responsive from 360px up. No native app.                                                                                                                                                                                                                              |
| **Cloud hosting in this release**                                                   | The domain layer is kept storage-agnostic so a PostgreSQL adapter can be added later. A writable local SQLite file cannot be deployed to a serverless platform; the future cloud mode requires durable external PostgreSQL and object storage. See [ARCHITECTURE.md](ARCHITECTURE.md) §10. |
| **Single sign-on / Active Directory**                                               | Assumption D-15. Would be a Phase 2+ project.                                                                                                                                                                                                                                              |
| **Biometric device integration**                                                    | Assumption D-11. Attendance arrives by file import; a device adapter can be added without redesign.                                                                                                                                                                                        |
| **Telemetry and analytics**                                                         | None, by default and by design.                                                                                                                                                                                                                                                            |
| **Multi-tenancy**                                                                   | One company on one machine.                                                                                                                                                                                                                                                                |

---

## 6. Non-goals for the first release

- Not a performance or headcount-planning tool
- Not a document management system
- Not a chat or announcement platform
- Not an offline-capable client (the browser needs the LAN; it does not need the internet)

---

## 7. What "done" means for Phase 1

Release is blocked until every one of these passes. See [TESTING.md](TESTING.md) §7 for
how each is evidenced.

- [ ] Format, lint, typecheck, unit, integration, and end-to-end tests all pass
- [ ] Production build and Windows installer produced successfully
- [ ] Clean-machine installation checklist passes on the actual target OS
- [ ] An employee browser on a second computer reaches the host over LAN HTTPS with a trusted certificate and no warning
- [ ] RBAC denial tests pass, including direct API calls that bypass the UI
- [ ] A live backup is created and restored into an isolated directory, and verified
- [ ] Migration and rollback boundaries are documented
- [ ] No secrets and no real employee data in the repository or the installer
- [ ] Dependency and licence reports generated
- [ ] An administrator can export all company data in documented formats
- [ ] **HR has entered the real leave rules** through Settings → Leave Rules; no placeholder
      policy remains active (DW-37)
- [ ] [DEFERRED-WORK.md](DEFERRED-WORK.md) reviewed, current, and carried into the release notes
