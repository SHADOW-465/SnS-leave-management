# Simon & Sons Leave OS

Local-first employee and leave management for one Windows machine on the office LAN.

This is **v1 for developer testing**. Installation, LAN HTTPS, TLS trust, and accessibility
are **not verified** until those exact tests are run and recorded.

## 10-minute developer start (Windows)

1. Node 24+
2. `pnpm install`
3. `pnpm seed:demo` — creates the sample organisation (skip it to run the first-run wizard instead)
4. `pnpm dev` — API at `http://127.0.0.1:3000`, UI at `http://localhost:5173`
5. Open the UI. The sign-in page lists every sample person; click one to sign in as them.

### The sample organisation

Simon & Sons, a printing and publishing house: Management, Production (Printing and Binding
teams), Editorial, Quality Assurance, Human Resources, and Finance — 17 people plus the
administrator, each with a designation, department, reporting manager and some leave history.
Addresses end in `@sns.test` (a reserved domain that can never receive mail). Anyone can also
sign in with their employee ID, e.g. `SNS-1005`.

| Who                                  | Sign in                               | Try                                                      |
| ------------------------------------ | ------------------------------------- | -------------------------------------------------------- |
| Arjun Das, administrator             | `admin@sns.test` / `ChangeMe_admin_1` | Reporting managers, Users & access, Leave configuration  |
| Anitha Joseph, HR manager            | `anitha@sns.test`                     | Employees, Users & access, holidays, allowances, reports |
| Rajesh Menon, managing director      | `rajesh@sns.test`                     | Approves HR's leave (Managing Director role)             |
| David Fernandes, production manager  | `david@sns.test`                      | Approves the supervisors; his own leave goes to HR       |
| John Mathew, printing supervisor     | `john@sns.test`                       | Approves Vijay and Priya                                 |
| Vijay Anand, machine operator        | `vijay@sns.test` or `SNS-1005`        | Applies for leave, sees balance and history              |
| Ramesh Nagarajan, payroll accountant | `ramesh@sns.test`                     | Monthly payroll report and export                        |

Everyone except the administrator uses `ChangeMe_demo_1`.

**The approval hierarchy** — leave always goes one level up:

```
Administrator / Managing Director   approve HR's leave (and each other's)
HR                                  approves managers' leave
Manager (department head)           approves team leads, and staff with no team lead
Team lead                           approves their team
Employee                            applies
```

HR's leave never goes to a manager, and HR cannot approve another HR person's leave. The
person who has to decide is notified; the employee is told the decision. HR, administrators
and managers see their people's leave on their dashboards rather than as notifications.

### A five-minute walkthrough

1. **Vijay** applies for two days of Annual Leave. The form shows the working days (weekends
   and holidays skipped), his balance, and that it will go to John.
2. **John** sees it under _Pending requests_ with Vijay's balance and history, and approves or
   rejects it with a remark. Vijay is notified; his balance drops only on approval.
3. **Anitha (HR)** opens _Payroll & annual reports_ → _Monthly Payroll_ and exports Excel.
4. **Arjun (admin)** opens _Reporting managers_, moves Vijay to Kumar from a chosen date, and
   opens _History_ to see the change recorded.
5. **Anitha (HR)** applies for leave: it goes to **Rajesh (MD)**, never to a manager.
   **David (manager)** applies: it goes to **Anitha (HR)**.
6. Still as Arjun, _Leave configuration_: change the monthly credit, give Management 2.5 days a
   month, change the weekend, or choose what someone joining mid-month earns.

### Configuring for a real office

Everything is set in the app — no code changes:

- **Leave types** — out of the box there is one, **Annual Leave**, exactly as the functional
  framework describes it: 2 days credited every month (24 a year), unused days carried forward,
  weekends and government holidays not counted, the joining month pro-rated. There are no
  casual, sick or earned leave types, because the framework does not describe any. A company
  that needs another kind of leave can add its own, rename, mark unpaid, or archive a type —
  archived types keep all their history.

- **Leave configuration** — per leave type: monthly credit or yearly grant, rate per staff
  category and during probation, joining-month rule, carry-forward, maximum balance, whether
  weekends and holidays count, notice, half days. Also the working week and the leave year.
- **Government holidays** — add, rename, remove, bulk-select days (e.g. every 2nd Saturday),
  load the fixed-date national holidays, or import the government list from Excel.
- **Reporting managers** — who approves whose leave, with dated history; cover while away.
- **Users & access** — HR or an administrator adds an employee and their sign-in, edits the account, or removes it (the person is marked as left; history is kept).
- **Leave allowances / Leave transactions** — set a person's allowance, or record a manual
  credit or deduction with a reason. Balances are never edited directly.

### Hosted preview (temporary)

The office product is SQLite. For a clickable verification link the API can run on Vercel
against a Supabase Postgres database. This is **not** the office product (DW-29, DW-41).

1. Create a Supabase project. Copy the **Session pooler** or direct URI (`sslmode=require`).
   Never put a Supabase anon key in the browser — the browser talks only to this API.
2. In the Vercel project, set `DATABASE_URL` to that URI (Production + Preview).
   Optional: `CRON_SECRET` for the daily job tick, `LEAVEOS_PUBLIC_URL` to the deployment URL.
3. Deploy. The first request migrates the schema and seeds the synthetic demo accounts.

Sign-in (synthetic only): the same sample organisation as above. A preview database seeded
by an older version is upgraded in place on the next cold start — the placeholder people are
renamed, never deleted.

Attachments and file backups do not persist on Vercel. Unset `DATABASE_URL` and drop the
preview project when verification is finished.

## Checks

```
pnpm check
```

Format, lint, typecheck, unit and integration tests. A passing check is not evidence that
installation, LAN access, or TLS trust work.

## Layout

See `docs/00-PLAN-INDEX.md` and `AGENTS.md`. Dependency rule: `domain` imports nothing else
in the repo; `web` imports `contracts` and `ui` only; `desktop` never opens the database.

## What is deliberately not in v1

See `docs/DEFERRED-WORK.md`. Statutory payroll, biometric devices, cloud hosting, and
automatic deletion are blocked or out of scope.
