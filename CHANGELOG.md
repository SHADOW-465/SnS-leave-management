# Changelog

## 0.2.1 — 2026-09-22

### Added
- **Users & access** is for HR and administrators. Add account creates the employee and a sign-in together, with a role (Employee, Manager, HR, Payroll, Auditor; Administrator only if you are an administrator). Edit changes the name, work email, employee ID and roles. Remove marks them as left and turns the sign-in off; the leave history stays, and Restore brings them back. A temporary disable still exists for a sign-in that should stop without the person leaving.

### Changed
- **Reporting managers** shows each person’s designation under their name in the manager dropdown and in the “Leave goes to today” column.

## 0.2.0 — 2026-09-22

Everything the Leave Tracker functional framework asks for, a realistic sample organisation,
and a round of fixes found by walking through every screen.

### Added
- **Leave types** screen (Administration → Leave types): add a type from a template (Annual, Casual, Sick, Earned, Loss of Pay) or from scratch, rename it, mark it paid or unpaid, archive and restore it. A new type opens everyone's balance at once; archiving is refused while requests of that type are waiting, and never removes history. Archived types disappear from applying, balances, allowances and accrual.
- **Defaults follow the framework**: a fresh install has one leave type, Annual Leave — 2 days credited monthly (24 a year), carry forward, weekends and holidays not counted, joining month pro-rated. Casual, sick, earned and unpaid leave are optional templates. Existing installations keep their types.
- **Reporting managers** (was "Approval routing"): the reporting manager assigned to each person is who approves their leave (§6, §9). Change one person or many at once, from a chosen date; every change is kept with its dates (`employment_history`) and shown under *History*. Old requests stay with the manager they were sent to (§18D). Without a manager — or while they are away — leave goes to the team lead, then the department head, then HR. The page explains that order in a simple diagram and only warns when someone is actually affected. Administrator overrides were folded into reporting managers (migration `0006`).
- **Leave configuration** (§10): monthly credit per leave type ("2 days a month = 24 a year"); a different monthly rate per staff category (e.g. Management 2.5) and during probation; what someone earns in the month they join — full, pro-rated or nothing (§18C); maximum balance; whether weekends and government holidays are counted (§5); the company working week, with upcoming leave recounted when it changes. Staff categories can be added from the same page.
- **Leave transactions** (§13, §14): every credit, approval, cancellation and adjustment with the balance after it, a summary (opening, earned, manual credit, manual deduction, used, closing, pending), and a manual credit/deduction form with a required reason. Employees see their own as *Leave history*.
- **Annual leave report** (§19): per person for a leave year and type — opening, earned, adjusted, days used in each month (leave across two months is split), pending, closing — with Excel and CSV export.
- **Payroll PDF**: the monthly payroll sheet is now in the PDF export too (§12).
- **Government holidays** (§11): a list for the selected year (Date / Day / Holiday) with add, rename and remove; import straight from Excel in the government notification's layout (`01-Jan-2026`, `26/01/2026`…); load the fixed-date national holidays.
- **Profile** page for every employee; **change password** from the app.
- **Sign-ins**: the administrator creates a sign-in for anyone without one and resets passwords; the temporary password is shown once and must be changed at first sign-in. Anyone can sign in with their employee ID as well as their email.
- **Notifications** use the framework's wording ("New leave request submitted by Ravi for 12–14 September", "…has been rejected. Reason: …") and employees are emailed the decision (§17).
- **Sample organisation**: Simon & Sons with 17 people across six departments, real designations, reporting managers, holidays and leave at every stage. The hosted preview's older placeholder people are renamed in place.

### Fixed
- Casual and sick leave were credited twice to everyone set up by the installer (once at setup, again by the leave-year job), which is why balances read 24 instead of 12. Setup now records that the year was opened and pro-rates mid-year joiners like the job does; migration `0007` reverses the duplicate with a correcting ledger entry on existing databases.
- The dashboard showed the manager field while leave actually went to the team lead; it now shows the reporting manager, and who the leave goes to when that differs.
- The first leave rules took effect on the install date, so leave earlier in the year could not be recorded; they now start with the leave year.
- The change-password screen was never shown, so temporary passwords were never replaced; accounts created by HR, bulk provisioning or an admin reset now must change it at first sign-in.
- Moving someone to another team moved their department but left them reporting to their old team lead; they now report to the new lead (with history), unless a manager had been chosen deliberately. The team dialog stays open to add several people, and says what changed.
- HR could open department-head, team-lead and reporting-manager fields they cannot save; those now show who decides them instead.
- "Deactivate" on departments and teams used an add-person icon; "1 days"; the leave year read "2026–2027" for a calendar year; a nested database transaction could fail on SQLite and deadlock on Postgres.

### Changed
- Rebuilt the local knowledge graph from current source: 1,223 nodes, 2,292 edges, 146 communities. Generated `public/` and `api/` bundles stay out via `.graphifyignore`. `graphify-out/` is not committed.

## 0.1.10 — 2026-09-21

### Added — Leave Tracker functional framework gaps

- **Employee overview**: identity (ID, department, reporting manager, leave year), yearly eligibility / earned / used / pending / available, month-by-month leave summary, upcoming approved leave, and upcoming holidays. Available balance does not drop until a request is approved; pending is shown separately. Team leads see pending requests on the same page.
- **Monthly payroll leave report** (`Reports → Monthly Payroll`): year and month selector with Employee ID, name, department, Opening, Earned, Used, Pending, Closing. Included on Excel and CSV export.
- **Holiday spreadsheet import**: HR can import `date,name,kind` CSV (Excel saved as CSV) from the holiday calendar, with a downloadable template.
- **Overlap block**: a second request that occupies the same dates as a pending or approved one is refused (`LEAVE_OVERLAP`). Morning and afternoon on the same day may both stand.
- **Earned leave default**: 2 days credited each month (24 days a year), configurable in Settings. New employees receive catch-up monthly accruals for elapsed months of the current leave year, recorded on `accrual_run` so the job cannot double-credit.
- **Mobile number** on add/edit employee.

### Fixed
- Hosted Vercel build: keep a committed `api/index.js` stub so Vercel CLI 59 can match `functions.api/index.js` before `vercel-bundle.mjs` overwrites it. Recent production deploys failed with “pattern doesn't match any Serverless Functions”.

## 0.1.9 — 2026-09-21

### Added — Administrator controls, leave allowances, bulk holiday calendar

- **Approval routing** (`/admin/routing`, administrator only): appoint team leads and department heads, assign a specific approver to any one person (overrides the ladder), arrange dated cover while an approver is away, and see exactly where each person's leave goes today, with plain-language warnings for gaps. Pending requests can be reassigned. HR can no longer change leads/heads (`approval.routing.manage`). Migration `0005_approval_controls.sql`.
- **Users & access** (`/admin/users`): change roles (with descriptions), disable/enable accounts, sign out everywhere, release a bound workstation. Guards stop an administrator locking themselves out or disabling the last administrator.
- **Leave allowances** (`/allowances`): set this year's allowance for one leave type across many people at once. Writes a ledger ADJUSTMENT for the difference; never drops below leave already taken or pending (those people are reported, the rest are updated). Administrators now hold `leave.balance.adjust`.
- **Holiday calendar**: select several days (toggle, Shift-click range, weekday headings), or quick-select patterns such as "2nd Saturday of every month in 2026", then mark them as holidays, optional holidays, working days, or back to normal in one step (`POST /api/v1/holidays/bulk`). Leave already booked over changed days is recounted; meaningless changes (a weekday "made working", clearing a normal day) are skipped and reported.
- **Approvals inbox** (`/approvals`): team leads, department heads and covers now see requests routed to them (previously only HR/admin saw the approval queue). Requesters see who their request is waiting on. Navigation is grouped by role with a pending-approvals badge.

### Changed
- Added `.graphifyignore` so the knowledge graph skips generated build output (`public/`, `api/`, `dist/`). Minified bundles had dominated the most-connected nodes; the graph is now 1,130 nodes / 1,799 edges of real source and docs.

### Fixed
- "My requests" ignored the status and search filters.
- Server test runs crashed with too many parallel database workers; capped at two.

## 0.1.8 — 2026-09-12

### Fixed — Hosted preview kept serving an older UI after `git push`

Vercel production (`sns-leave-os.vercel.app`) was last deployed from the CLI against an older commit. `.vercelignore` excluded the web source and told the hosted build to reuse a prebuilt `public/` folder, so Reports, custom selects, and the rest of the localhost UI never reached the preview. The hosted build now compiles `apps/web` with Vite and always replaces `public/` from that output.

### Added — Office Security Perimeter, Workstation 1:1 Binding, On-Behalf Leave & Hierarchy Notifications

- **Office Network Perimeter Enforcement**: Implemented `isOfficeNetwork(ip)` check covering local loopbacks, RFC 1918 private subnets (`10.0.0.0/8`, `192.168.0.0/16`, `172.16.0.0/12`), and office gateway IP. Blocks remote / offsite logins from registering attendance signals in `attendance_raw`, writing `auth.offsite_attendance_suppressed` to the immutable audit log.
- **Workstation-to-Employee 1:1 Device Binding**: Added database table `workstation_device` via migration `0004_workstation_device_binding.sql`. Clients generate and send an immutable device token (`X-Workstation-Id`). Each office workstation is strictly paired to a single employee on initial login; cross-account logins from paired office computers are aborted with `403 WORKSTATION_MISMATCH` and recorded as `auth.workstation_violation` in `audit_event`, eliminating "buddy punching".
- **Team Lead On-Behalf Sudden Leave**: Team leads, managers, HR officers, and administrators can now submit unplanned or sudden leave on behalf of absent team members directly from `Apply.tsx`. Includes an "Applying For" switcher (`Myself` vs `On Behalf of Team Member`) with employee dropdown, live balance lookup, and routing calculation. Submissions record both target employee and submitter, log `leave.request.submitted_on_behalf` audit events, and notify the absent employee.
- **Downstream Hierarchy Notification Flow**:
  - When approved by a Team Lead: the employee receives confirmation, while the Department Head and HR Officers receive `leave.approved.informational` notifications with employee and duration details.
  - When approved by a Department Head: HR Officers and Administrators receive informational notifications.
  - When approved by HR: Administrators receive informational notifications.
- **Development vs. Production Environment Guardrails**:
  - In development mode (`LEAVEOS_ENV=development`), workstation 1:1 binding restrictions are bypassed (`enforceWorkstationBinding: false`), allowing testers and developers to freely switch between and log into any account (Admin, Team Lead, Department Head, HR, Employee) on their single browser/machine without being blocked by `403 WORKSTATION_MISMATCH`.
  - In production mode (`LEAVEOS_ENV=production`), `showDemoAccounts` and `seedOnEmpty` are strictly enforced as `false` (no demo accounts panel, no testing mode badge, no synthetic account seeding), while `enforceWorkstationBinding` is strictly enforced (`true`) to prevent buddy punching and unauthorized cross-account logins on office workstations.
  - Updated `scripts/start-leaveos.mjs` and `apps/web/src/pages/Login.tsx` to ensure seamless demo accounts display and one-click role logins in development, while guaranteeing a clean, production-grade interface in production.

## 0.1.7 — 2026-09-12

### Added — Executive Reports & Analytics, Multi-Sheet Excel and PDF Export

- **Executive Reports & Analytics Dashboard (`apps/web/src/pages/Reports.tsx`)**: Replaced the basic 3-card view with an executive-grade reporting suite. Features a 5-card KPI ribbon (Total Leave Taken, Active Headcount, Average Days / Staff, Pending Approvals with alert state, and Audit & Compliance tracking DW-32 self-approvals).
- **Interactive Multi-Tab Breakdown**:
  - **Monthly Trends**: Proportional visual bar chart with hover tooltips and accessible tabular data showing days, request counts, and employee numbers.
  - **Department Breakdown**: Tracks department code, headcount, total days taken, average days per employee, request volume, and visual utilization share meters.
  - **Leave Type Distribution**: Color-tokened leave category pills, total days taken, request count, employee count, and percentage share progress bars.
  - **Employee Leave Balances**: Real-time search across name, code, department, or team, paired with custom `<Select>` dropdown filters for Department and Status. Displays employee code, department, team, `<StatusPill>`, entitlement days, taken days, bold color-coded remaining balance, and pending days badge.
- **Multi-Sheet Excel Export (`/api/v1/reports/export.xlsx`)**: Integrated SheetJS (`xlsx`) to produce a structured, multi-tab `.xlsx` workbook containing *Executive Summary*, *Departments*, *Leave Types*, *Monthly Trends*, and *Employee Balances* with bold headers and auto-proportioned column widths.
- **Executive Vector PDF Export (`/api/v1/reports/export.pdf`)**: Server-side vector PDF generation using `pdf-lib` with Simon & Sons Leave OS header, reporting period metadata, KPI highlight cards, department summary table, leave type utilization table, and multi-page employee balance table with running footers and page counts.
- **Clean Print Layout (`@media print`)**: Comprehensive print stylesheet hiding sidebar, navigation, search filters, and action buttons for clean browser printing.
- **Local & Vercel Deployment Parity**: Both `xlsx` and `pdf-lib` are 100% pure JavaScript with zero native C++ binaries, bundled into `api/index.js` via esbuild for Vercel serverless while functioning 100% offline on the local office LAN.
- **RBAC & Audit Compliance**: Every export endpoint strictly enforces `report.export` authorization via `authorizeAction` and logs immutable `report.exported` events to `audit_event` per ADR 0006 and ADR 0004.

## 0.1.6 — 2026-09-12

### Changed — Comprehensive custom dropdown system and sidebar layout refinement

- **Universal Custom Select System (`@sns/ui`)**: Built and deployed an accessible, keyboard-friendly custom `Select` popover component across all pages and dialog modals (Leave Type on Apply page, filter bars and modals in People and Attendance, Accrual & Probation and Leave Year on Settings). Completely eliminates OS-native Windows dropdown menus, replaced with custom floating popover cards, subtle ambient elevation shadows, 180° chevron rotation, hover states, and checkmark indicators. Supports full-width form layouts and hidden input constraint validation.
- **Sidebar Dimensions & Separation**: Slimmed the primary navigation sidebar from 248px to 216px for balanced proportions. Replaced harsh 1px perpendicular black boxy borders with tonal surface separation (`#f8f8f6` sidebar vs `#ffffff` canvas) and an ambient diffused micro-shadow, paired with a backdrop-blurred topbar.
- **Localhost Developer Experience & Demo Accounts**: Updated `scripts/start-leaveos.mjs` to default `LEAVEOS_DEMO_ACCOUNTS=true` for local runs, making demo accounts immediately accessible on `localhost:3000`. Updated `package.json` `"start"` script to automatically run `pnpm build` prior to starting the server, ensuring local builds never serve stale bundles. Fixed static file route caching in Fastify (`apps/server/src/app.ts`).

## 0.1.5 — 2026-09-08

### Fixed — leave balances no longer reset to zero at the leave year boundary

Entitlement is scoped to a leave period. A new period appears on the first day of the new
leave year and **nothing granted anything into it**, so on that date every balance in the
company read zero and nobody could apply. There was no carry-forward job and no expiry job
either, despite both being designed and documented.

`openCurrentPeriod()` now opens the period for everyone: grants the new year's entitlement
(pro-rated for mid-year joiners), carries unused days forward up to the policy cap, and
records anything above the cap as an explicit `EXPIRY` entry against the closing period so
the old year still reconciles. It is idempotent via `period_rollover_run`, so repeated runs
— including several restarts on 1 January — cannot double-grant. It also runs once at
startup, so a host that was switched off over the new year catches up when it comes back.

### Fixed — monthly accrual ignored HR's settings and could credit twice

The job called `defaultRulesForCode()`, so any accrual method or entitlement HR published
in Settings was ignored. It now reads the published `leave_policy_version`. It also had no
idempotency guard while running on a twelve-hour timer, so on the first of the month it
fired twice and credited everyone twice; `accrual_run` now holds one row per employee,
leave type and month.

Carried-forward days now lapse on their expiry date, capped at what is actually unused so
expiry can never push a balance negative.

### Changed — leave follows the organisation chart

Supersedes ADR 0009. A team member's request is decided by their **team lead**, a team
lead's by their **department head**, a department head's by **HR**, and HR's by an
**administrator**. Routine leave no longer lands on HR at all.

- Position decides the rung, not the account role: a team lead is an ordinary employee
  account that happens to lead a team.
- A rung is skipped only for a real gap — nobody appointed, the approver is the person
  asking, their account is disabled, or they are on leave — and the reason is stored on the
  request so an escalation is explainable afterwards.
- **Authority comes from being the assigned approver**, not from a company-wide permission.
  A team lead can decide their own team's requests without being able to touch anyone
  else's. HR and administrators keep an override.
- Nobody decides their own request; a lone administrator remains the documented exception.
- If the whole chain is empty the request is refused with a 409 naming the missing rung.

### Added

- **`pnpm service install`** registers Leave OS as a Windows Service: starts at boot before
  anyone logs in, survives the host user logging out, restarts on failure, and cannot be
  closed by accident. `status`, `start`, `stop`, `restart`, `uninstall` included.
- The apply screen now names **who the request will go to** before you submit it — "Ravi
  Example (team lead)" — including the reason when it has escalated.
- The seeded sample organisation models a real structure: Engineering (head: Sofia)
  containing Platform (lead: Ravi, member: Amina) and Customer Support, so the hierarchy is
  visible immediately.
- 40 new tests: the routing ladder in isolation, the hierarchy end to end through the API,
  and period rollover, accrual idempotency and carry-forward expiry. 157 tests total.
- Hosted preview: an already-seeded Vercel/Supabase database now gains Sofia (department
  head) and the Engineering org on cold start. `seedOnEmpty` only runs once, so without
  this backfill the hierarchy sample people never appeared on the live preview.


## 0.1.4 — 2026-09-08

### Fixed — the hosted deployment could not submit or approve leave

Root cause: **Postgres folds unquoted identifiers to lower case; SQLite preserves them.**
Queries written as `SELECT quantity_half_days AS quantityHalfDays` returned a
`quantityhalfdays` key on Postgres, so every reader of `row.quantityHalfDays` got
`undefined`. `availableHalfDays()` then threw `quantityHalfDays must be an integer`,
which the error handler turned into a generic 500. Twelve aliases across four files were
affected:

- `usecases/leave.ts` balance read — broke **preview, apply, and approve** (every balance lookup)
- `usecases/leave.ts` approver resolution — `userId`/`employeeId` came back undefined, so
  approval steps were written without a resolvable approver
- `ctx.ts` reporting graph — `managerEmployeeId` undefined, so `collectReports()` built an
  empty tree and manager-scoped visibility silently returned nothing
- `usecases/people.ts` manager-cycle checks

Fixed in the translation layer (`toPostgresSql` now quotes camelCase aliases), so the whole
class is handled and cannot recur in new queries. Type names in casts are left alone.

Also fixed: `GET /api/v1/teams` returned 500 on Postgres. `WHERE (? IS NULL OR ...)` gives
Postgres no way to infer the parameter type and it rejects the query; the parameter is now
cast explicitly.

### Added

- **`pnpm start` / `Start Leave OS.cmd`** — one command starts the server bound to the LAN,
  prints the address colleagues should open, and opens it locally.
- **23 tests for the hosted Postgres path**, run against real Postgres via PGlite (WASM).
  This path previously had no tests at all, which is why it shipped unable to apply for
  leave. Covers submit, approve, reject, withdraw, ledger entries, approver resolution,
  identifier case folding, and every read surface.

### Changed

- Generated deployment bundles (`api/`, `public/`) are ignored by lint, format, and git.
  They were being linted as source and failing `pnpm check` with 1,756 errors.

## 0.1.10 — 2026-08-28

### Added — Temporary Vercel + Supabase hosted preview

- Fastify entry at the repository root so the same API can run as a Vercel Function for
  company click-through testing. Office go-live remains SQLite on one Windows machine.
- `DATABASE_URL` / `SUPABASE_DB_URL` already switched the API to Postgres; hosted preview
  now also turns on secure cookies, `trustProxy`, demo-account sign-in, and first-run seed
  when the database is empty.
- Daily cron tick (`GET /api/v1/internal/cron` with `CRON_SECRET`) replaces in-process
  `setInterval` jobs, which do not survive serverless freeze.
- File backup stays SQLite-only. Attachments on the preview host are ephemeral.

This is not a cloud product. Tear the preview down when verification is done (DW-41).

## 0.1.9 — 2026-08-27

### Added — Department Management, Team Management, Team Rosters & Full Employee Lifecycle

- **Department Management**:
  - **Create, List & Edit Departments**: HR Officers and Admins can create departments with unique uppercase codes (e.g., `ENG`, `HR`, `FIN`) and assign Department Heads.
  - **Department Deactivation / Archival Guard**: Safe archival with active employee protection (prevents deactivation if active staff are still assigned to the department).
  - **Department Cards**: Visual cards showing department code badge, assigned department head, active staff headcount, and active team counts.
- **Team Management & Membership Rosters**:
  - **Create, List & Edit Teams**: Create teams scoped to departments and assign Team Leads.
  - **Interactive Team Membership Management**: Interactive modal allowing HR/Admin to add employees to a team or remove members with single-click actions and instant reactive updates.
  - **Team Archival**: Safely deactivates teams and automatically unlinks existing members (`team_id = NULL`) while keeping them in their respective departments.
  - **Team Cards & Filtering**: Filter teams by department and keyword search; cards display department tags, assigned leads, and total member count.
- **Complete Employee Lifecycle & Management**:
  - **Add Employee**: Full employee creation form with dynamic team selection (filtered by selected department) and optional account provisioning.
  - **Edit Employee**: Full editing of personal details, department, team, job title, employment type, location, manager hierarchy, and employment status with optimistic locking.
  - **Deactivate Employee**: Secure exit recording with exit date and deactivation reason, disabling user account logins while immutably preserving historical records.
  - **Reactivate Exited Employee**: One-click reactivation restoring employee status to `active`, clearing exit dates, and re-enabling login account access.
  - **Temporary Password Reset**: Generate one-time temporary passwords for employees with click-to-copy modal.
- **Multi-Tab People View (`/people`)**:
  - Dedicated accessible tabs for `Employees`, `Departments`, and `Teams`.
  - Top KPI metrics: Total Staff, Active Staff, On Probation, Exited Staff.
  - Live search and multi-dimensional filters (Department, Team, Status).
- **Backend API & Contracts**:
  - Endpoints: `POST /api/v1/departments`, `PATCH /api/v1/departments/:id`, `POST /api/v1/departments/:id/archive`, `POST /api/v1/teams`, `PATCH /api/v1/teams/:id`, `POST /api/v1/teams/:id/archive`, `POST /api/v1/teams/:id/members`, `POST /api/v1/employees/:id/reactivate`.
  - Zod schemas in `@sns/contracts`: `createDepartmentBodySchema`, `updateDepartmentBodySchema`, `createTeamBodySchema`, `updateTeamBodySchema`, `teamMembersBodySchema`, `reactivateEmployeeBodySchema`.
  - All operations append strictly to `audit_event`.
- **Automated Integration Tests**:
  - Added test suites in `apps/server/src/people.test.ts` verifying department CRUD & duplicate code rejection, team CRUD & member rosters, and employee deactivation/reactivation lifecycle.
- **Seamless Demo Login & Testing Access**:
  - Removed forced password change gate (`PasswordPage`) from login and routing flows, allowing all demo accounts (`admin`, `amina`, `ravi`, `helen`, `paul`, `nora`) to log in immediately with their standard demo credentials without interruption.
  - Reset `must_change_password` flag to `0` across all seeded and provisioned demo accounts.
  - Added password reveal toggle and 1-Click Instant Login buttons on the sign-in screen.

## 0.1.8 — 2026-08-27

### Fixed & Enhanced — Directory Visibility Scoped to Admins/HR & Calendar Recalculation

- **Removed Directory Access for Standard Employees**:
  - Removed "Directory" link from employee navigation (`EMPLOYEE_NAV` in `Shell.tsx`).
  - Protected `/people` route in `App.tsx` to require `employee.read:company` or `employee.read:reports_recursive` permissions, automatically redirecting unauthorized employees to `/`.
  - Updated action button guards in `People.tsx` to require explicit company-level scopes (`employee.create:company`, `employee.update:company`, `employee.archive:company`).
  - Added frontend permission unit tests in `apps/web/src/App.test.ts`.

- **Robust Calendar Recalculation Across Locations & Employees**:
  - `recalculateLeaveRequestsForDate` and `holidaysForEmployee` now reliably match all employees and active leave requests (pending, approved, draft) spanning a modified calendar date, including employees with unassigned or fallback locations.
  - Recalculates both `leave_request.total_half_days` and granular `leave_request_day` records (`is_counted`, `skip_reason`).
  - Automatically updates `balance_ledger` holds (`HOLD_RELEASE` + `PENDING_HOLD` for pending requests, `ADJUSTMENT` for approved requests).
- **Instant Employee Overview & Balance Synchronization**:
  - Employee Overview (`/`), My Requests (`/requests`), and Request Details (`/requests/:id`) immediately reflect the recalculated leave day counts and updated remaining balances (`left`, `taken`, `total`).
  - Added comprehensive query invalidations across `home`, `reqs`, `req`, `dash`, and `availability` upon calendar edits.
- **Automated Verification**:
  - Enhanced integration tests in `apps/server/src/calendar.test.ts` to verify that converting a holiday to a declared working day or deleting a holiday instantly recalculates existing leave requests and updates the employee's overview balance and requests list.

### Added — Notification Click Redirection & Interactive Popover Overhaul

- **Interactive Notification Click Redirection**:
  - Clicking any notification in the topbar dropdown automatically marks that notification as read, closes the popover, and instantly navigates to the relevant entity / page:
    - **Leave Requests / Decisions**: Navigates directly to the curved floating detail window for that request (`/requests/:id`) or the approvals queue (`/requests`).
    - **Attendance & Presence Signals**: Navigates to `/attendance`.
    - **Holiday Calendar**: Navigates to `/calendar`.
    - **People & Directory**: Navigates to `/people`.
- **Interactive Notification Popover Redesign**:
  - Distinct color-coded icons and badge borders for each notification type (e.g., green for approved, red for rejected, blue for pending requests, indigo for attendance, purple for calendar).
  - High-contrast typography with bold unread indicators, relative timestamps (e.g., `Just now`, `5m ago`, `2h ago`), hover animations, and subtle chevron indicators.
  - One-click **Mark all read** action with instant cache invalidation.
  - Full keyboard accessibility and auto-dismiss on outside click or Escape key.
- **Backend API & Tests**:
  - Enhanced `POST /api/v1/notifications/read` and `markNotificationsRead` to support marking individual notifications as read by ID or marking all as read.
  - Added automated test in `apps/server/src/leave.test.ts` verifying notification creation upon submission, payload metadata (`entity_type: 'leave_request'`, `entity_id`), and individual read status updates.

## 0.1.6 — 2026-08-27

### Added — Attendance & Presence Signals Page Redesign, Manual Corrections & Batch CSV Import

- **Modernized Attendance & Presence Signals (`/attendance`)**:
  - **4 Top KPI Cards**: Live telemetry cards showing Total Signals (with week-over-week trends), Today Login Signals, Earliest Presence time, and Latest Active presence across the organization.
  - **ADR 0011 Philosophy Banner**: Transparent educational banner clarifying login-derived presence evidence (positive presence signals vs unverified absences).
  - **Multi-Filter & Search Toolbar**: Live keyword search across employee names, codes, and departments; quick date preset buttons (`Today`, `Yesterday`, `Last 7 Days`, `All Dates`) plus custom date picker; signal source filters (`All`, `Web Login`, `Hardware/CSV Import`); and department selectors with active filter tag chips and clear-all action.
  - **High-Contrast Presence Ledger**: High-legibility table featuring employee avatar chips, work date badges, source badges (`Login` vs `Import`), formatted first/last login times, computed presence duration windows, and manual correction badges.
  - **Curved Floating Modals**:
    - **Inspect Signal Window**: Curved floating window (`border-radius: 20px`) with raw device JSON inspector, employee work context, first/last login signals, and immutable correction timeline.
    - **Manual Correction Window**: Audit-compliant manual correction dialog with field selector (`first_login_at`, `last_login_at`, `work_date`, `notes`), new value input, and mandatory audit reason prompt (preserving raw signals per ADR 0011).
    - **CSV Import Modal**: Hardware/biometric bulk import modal with file upload, drag-and-drop, raw CSV text input, live column/row preview table, and sample template download (`/api/v1/attendance/template.csv`).
  - **Client-side Filtered CSV Export**: Quick download of the currently filtered attendance view for payroll and audit review.
- **Backend API & Contracts**:
  - `GET /api/v1/attendance`: Filtered presence queries with RBAC scoping (`attendance.read`), date/source/department/keyword filters, computed KPI metrics, and correction histories.
  - `POST /api/v1/attendance/corrections`: Append-only manual corrections inserting into `attendance_correction` with before/after audit event `attendance.corrected`.
  - `POST /api/v1/attendance/import`: Batch import of external hardware signals with employee code validation, upsert handling, and audit event `attendance.imported`.
  - `GET /api/v1/attendance/template.csv`: Standard downloadable CSV template for hardware clocking integrations.
- **Integration Tests**:
  - Added comprehensive test suite in `apps/server/src/attendance.test.ts` verifying automatic login presence recording, filtered listings, manual corrections, and CSV batch importing.

## 0.1.5 — 2026-08-27

### Added — Employee Directory CRUD Operations & High-Contrast Visual Redesign

- **Full Employee Directory CRUD Operations (`/people`)**:
  - **Add Employee**: Complete creation modal with first/last name, employee code, work email, joined date, probation date, and organization selectors (Department, Job Title, Office Location, Employment Type, and Reporting Manager) with user account provisioning.
  - **Edit Employee**: Curved floating modal for updating employee profile details (names, contact, department, role, location, manager, probation end date, and status) with optimistic concurrency validation (`version`).
  - **Cycle Prevention**: Live graph cycle prevention prohibiting circular management reporting hierarchies.
  - **Deactivate / Exit Employee**: Modal for marking employees as exited with departure reason and exit date; securely disables login accounts and revokes active sessions while preserving historical ledger data.
  - **Admin Password Reset**: Allows HR/Admin to reset an employee's password and view/copy a one-time temporary password sheet.
  - **Directory Filtering & KPIs**: Live search across all employee fields, department dropdown filter, status filter (`Active`, `Probation`, `Notice`, `Exited`, `Suspended`), and top-level KPI summary cards.
- **High-Contrast Grid & Table Styling**:
  - Rebuilt team availability grid (`/team`) with crisp borders (`1.5px solid #94a3b8` on working days), 2-tier column headers (weekday + day of month), today highlight, and distinct status color cells (amber pending, indigo approved, red holiday, slate weekend).
  - Enhanced global border tokens across all tables and calendar views.
- **Backend API & Tests**:
  - Added `PATCH /api/v1/employees/:id` (`updateEmployee`) and `GET /api/v1/employees/:id` (`getEmployee`).
  - Added full test suite in `apps/server/src/people.test.ts` validating employee creation, updates, concurrency conflicts, and deactivation.

## 0.1.4 — 2026-08-27

### Added — Curved Floating Preview Window with Employee Leave History

- **Curved Floating Preview Window**:
  - Replaced side drawer with an elevated, centered curved floating window (`border-radius: 20px`) with frosted glass backdrop blur and smooth scale-in animation.
  - Interactive rows across Approvals queue, Admin dashboard, and Employee overview.
- **Employee Leave History & Approver Decision Context**:
  - Displays total days taken this year across all leave types.
  - Displays taken vs granted days and remaining balance for the requested leave type.
  - Computes and highlights projected remaining balance if approved.
  - Shows interactive chips for all leave type balances (Paid, Sick, Casual, etc.).
  - Lists prior leave history records (date ranges, type, days count, and status) so approvers have instant context for decisions.
- **Full Preview Components**:
  - Employee header with initials avatar, department, reports-to manager, and live status pill.
  - Day-by-day calendar schedule breakdown and step-by-step approval audit trail.
  - Supporting document card with download link and file size formatting.
  - In-window Approve, Reject (with reason dialog), and Withdraw action toolbar.
- **Dynamic Request Recalculation on Calendar Changes**:
  - When an admin/HR changes a calendar day from a holiday/weekend to a working day (`declared_working` or deleting/modifying a public holiday), existing pending, approved, and draft leave requests spanning that date are automatically recalculated.
  - Days previously marked as skipped (`is_counted = 0`) update to counted leave days (`is_counted = 1`, `skip_reason = null`).
  - Total working days (`total_half_days`) and balance ledger entries (`PENDING_HOLD` / `ADJUSTMENT`) update automatically with an immutable audit trail (`leave.request.recalculated`).
- **Backend API**:
  - Enhanced `requestDetail` in `queries.ts` to compute append-only ledger balances, total leave taken YTD, and prior requests for the employee.
  - Added `recalculateLeaveRequestsForDate` in `usecases/leave.ts` invoked upon any holiday calendar change or removal.

## 0.1.3 — 2026-08-27


Production-readiness pass. Details in `docs/IMPLEMENTATION-LOG.md`; register entries
DW-52 … DW-63.

### Fixed — production deployment

- **The production server served no interface.** The static-file path resolved to
  `<repo>/web/dist`, which never exists, so every page returned 404 while the API worked.
- **A strict CSP would have shipped an unstyled, unfontned UI.** `style-src 'self'` blocks
  React's element style attributes and `font-src 'self'` blocks the bundler's inlined
  `data:` font subsets. Both relaxed to exactly what the bundle needs; `script-src` is
  untouched.

### Fixed — access control

- **`/api/v1/dashboard` had no permission check.** Any signed-in employee could read
  company headcount, department leave statistics, and the pending approval queue by
  calling it directly.

### Fixed — holiday calendar

- **A date could hold a public, an optional, *and* a declared-working entry at once.** The
  unique constraint included `kind`, so re-marking a day added a row instead of replacing
  one and the calendar showed whichever was read first. Migration
  `0002_holiday_one_kind_per_date` enforces one entry per date; the route now upserts.
- **Deleting a holiday deleted that date from every calendar** in the company. Now scoped.
- Marking a day validates its name, reports success and failure, pre-fills the existing
  name, and offers "Clear this day". Arrow keys move through the grid, every cell announces
  its date and status, and there is a legend and an empty state.
- Every calendar change writes an audit event.

### Added — complete leave rules editor

- Settings → Leave Rules now edits all thirteen policy fields the domain enforces —
  entitlement, accrual method and cadence, mid-year pro-rating, carry-forward cap and
  expiry, probation restriction and limit, half-days, minimum notice, maximum consecutive
  days, negative balance, and the attachment threshold — each with a plain-English hint and
  an effective date. Previously only entitlement days could be changed.
- Publishing records an audit event with the before and after rules, in one transaction.
- Read-only for anyone without policy permission, rather than hidden.

### Changed — production posture

- Removed all development scaffolding from the interface: the placeholder warning banner,
  the "Placeholder rules" dashboard tile, and the "Placeholder entitlement" note on every
  balance card. `isPlaceholder` is gone from the domain type, contracts, seed, and API.
- Dashboard metrics are now four figures an approver can act on: awaiting decision (with
  how long the oldest has waited), out today (named), starting leave within seven days, and
  active employees.
- Balance cards no longer render a "0 / 0" tile for a type with no entitlement and no
  history. "Taken" is summed from the ledger rather than inferred as entitlement minus
  remaining, which was wrong once any adjustment or carry-forward existed.
- The holiday calendar starts empty instead of seeded with invented public holidays.

### Tests

- 16 new tests covering holiday upsert and replacement, calendar-scoped deletion, audit
  events, permission denial, the three holiday kinds driving working-day counts, published
  rules taking effect immediately, and dashboard scope. 69 tests total.

## 0.1.2 — 2026-08-26

Remediation pass after a full codebase inspection. Details in
`docs/IMPLEMENTATION-LOG.md`; register entries DW-42 … DW-51.

### Security

- **Fixed an authentication bypass: any password was accepted.** `login()` called an async
  failure helper without `await`, so the rejection never propagated and control continued
  into session creation. A wrong password returned 200 with valid session cookies.
- **Fixed a remote denial of service from the same defect.** The un-awaited rejection was
  unhandled and terminated the server process, so one failed sign-in took the site down.
- Enabled type-aware linting with `no-floating-promises` / `no-misused-promises`, the rules
  that make this class of defect visible.
- Added `GET /api/v1/attachments/:id`. Uploads previously had no retrieval path.
  Permission-checked, medical classification enforced, path-guarded, and 403 is identical
  for missing and forbidden records.

### Data integrity

- Withdrawing a request now awaits its ledger hold release; it could previously fail to
  return the balance.
- Three `audit()` writes and the notification-read write are awaited, so they can no longer
  land outside their transaction.
- Fixed a first-run seeding race that left the administrator with an opening balance for
  only one leave type instead of all entitled types.

### Fixed

- Sign-out now returns to the sign-in screen. It previously revoked the session correctly
  on the server but left the user looking at the application.
- Sample accounts sign in directly and are listed on the sign-in screen in development, so
  every role is testable. Previously only the administrator could sign in.
- `.env` is now read; development defaults its data directory to `./data` rather than
  `%PROGRAMDATA%`, which needs elevation.
- The bundled Instrument Sans now actually applies — the token named `'Instrument Sans'`
  but the package registers `'Instrument Sans Variable'`, so the interface had been
  rendering in the system sans-serif.

### Accessibility

- Accessible names added to the sample-account buttons, the duration radios (previously
  announced as "on"), and the mobile menu button.

### Tests

- 9 new regression tests: wrong password, unknown email, no session on failure, no password
  in logs, lockout, logout revocation, cookie clearing, and both seeding races.
  53 tests total.

## 0.1.1 — 2026-08-26

- Optional preview database: set `DATABASE_URL` (or `SUPABASE_DB_URL`) to a Postgres URI for hosted company verification. Unset it for the office SQLite product.
- This is not a cloud go-live. Core operation remains local-first.

## 0.1.0 — 2026-08-26

First implementable v1 for local testing.

- Monorepo (pnpm): `domain`, `database`, `auth`, `contracts`, `config`, `ui`, `server`, `web`, `desktop`
- First-run wizard, Argon2id passwords, server-side sessions, CSRF
- Leave apply / approve / reject / withdraw / cancel with immutable balance ledger
- HR-centred approval routing; managers cannot approve (D-08)
- Settings → Leave Rules (versioned) and Leave Year
- Holiday calendar including optional holidays and declared working days
- Directory, bulk-ready account provisioning, employee deactivation (no deletes)
- In-app notifications and best-effort email outbox (authority-free links)
- Login attendance **signals** only; no absence inference (ADR 0011)
- Reports with CSV export, audit log, backup endpoint, health
- Desktop control panel that supervises the server process (window close does not stop it)

Not verified: clean-machine install, LAN HTTPS, signed installer, NVDA pass, disk-full (F-10).
