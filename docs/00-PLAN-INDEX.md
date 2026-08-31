# Plan package — Simon & Sons Leave OS

**Status:** v1 application code exists for local testing (2026-08-26). Planning documents
remain the source of truth for behaviour. Installation and LAN claims are not verified.

Nothing in this directory is a verified claim about a running system; it is a design.

## Read in this order

| #   | Document                                                     | What it answers                                                                          |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 1   | [PROTOTYPE-AUDIT.md](PROTOTYPE-AUDIT.md)                     | What the `Leave Management.dc.html` prototype gets right, what is wrong, what is missing |
| 2   | [ASSUMPTIONS-AND-DECISIONS.md](ASSUMPTIONS-AND-DECISIONS.md) | **The decisions register — all 21 answered and binding**                                 |
| 3   | [PRODUCT-SCOPE.md](PRODUCT-SCOPE.md)                         | Included, deferred, explicitly excluded                                                  |
| 4   | [ARCHITECTURE.md](ARCHITECTURE.md)                           | Processes, ports, data flow, leave state machine, email                                  |
| 5   | [DATABASE-SCHEMA.md](DATABASE-SCHEMA.md)                     | Tables, ledger design, constraints, retention, ER diagram                                |
| 6   | [RBAC.md](RBAC.md)                                           | Roles, permission grammar, scope rules, matrix, approval routing                         |
| 7   | [SECURITY.md](SECURITY.md)                                   | 24 threats, auth, TLS, uploads, logs, backups, accepted risks                            |
| 8   | [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md)                         | Tokens, responsive strategy, accessibility, the nine required states                     |
| 9   | [TESTING.md](TESTING.md)                                     | Test layers, 24 failure tests, release gates                                             |
| 10  | [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)             | Milestones M0–M8, dependencies, risks, exit criteria                                     |
| 11  | [DEFERRED-WORK.md](DEFERRED-WORK.md)                         | **Everything deliberately not built, and what unblocks each**                            |
| —   | [adr/](adr/)                                                 | Architecture Decision Records 0001–0011                                                  |
| —   | [../AGENTS.md](../AGENTS.md)                                 | Standing instructions for anyone working in this repo                                    |

## The five decisions that shaped this most

1. **HR approves, not managers** (D-08/D-09). HR decides employee and manager requests; Admin
   decides HR requests and covers HR's absence; Admin may self-approve. Managers keep
   visibility only. → [ADR 0009](adr/0009-approval-routing.md)
2. **Email is in scope, and carries no authority** (D-13). Notifications to HR/Admin through a
   configured mailbox, with links that redirect to login — never one-click approval from an
   inbox. In-app notifications stay primary and email failure changes nothing.
   → [ADR 0010](adr/0010-email-deep-links.md)
3. **HR configures everything** (D-03, D-04, D-06). Leave rules, leave year, holidays, and
   declared working days are all UI-editable. Seeded values are labelled placeholders and must
   be replaced before go-live.
4. **Login attendance is a signal, not a verdict** (D-11). A login records presence; a missing
   login records nothing and never implies absence. → [ADR 0011](adr/0011-login-derived-attendance.md)
5. **Nothing is ever deleted** (D-21). Employees are deactivated with immediate access
   revocation. Retention classifications are stored so a future policy is possible; no deletion
   job exists and none may be enabled without legal approval.

## Documents written during the build, not now

Operator manuals would require inventing screenshots, paths, and command output for software
that does not exist — and the brief forbids claiming unverified installation steps. They are
scheduled in M7 and written _while_ installing the real thing:

`INSTALLATION-FOR-BEGINNERS`, `FIRST-RUN-WIZARD`, `NETWORK-AND-HTTPS`, `BACKUP-AND-RESTORE`,
`ADMIN-GUIDE`, `MANAGER-GUIDE`, `EMPLOYEE-GUIDE`, `EXCEL-MIGRATION`, `UPGRADE-AND-ROLLBACK`,
`TROUBLESHOOTING`, `OPERATIONS-RUNBOOK`, `UNINSTALLATION`, `DEVELOPER-SETUP-WINDOWS`,
`BUILD-AND-PACKAGE`, `README.md`, `CHANGELOG.md`, `.env.example`.

## Two things I changed rather than implemented as asked

Both are in [DEFERRED-WORK.md](DEFERRED-WORK.md); say the word and either goes back.

- **DW-33** — the requested SQL file of usernames and passwords is replaced by bulk
  provisioning with generated temporary passwords and a one-time credential sheet. Argon2id
  stores a one-way hash, so there is no password to put in such a file, and a file of live
  credentials in circulation is a standing risk. Same convenience, no loose passwords.
- **`AGENTS.md` and `DEFERRED-WORK.md` exist now, not after v1.** Written at the end from
  memory, a deferred-work list is always incomplete — items get forgotten precisely because
  they were deferred.

## What approval means

Approving authorises **M0 and M1** — the repository skeleton and the vertical slice
(install → create admin → authenticate → create employee → submit leave → approve → ledger and
audit written → back up → restart → verify persistence). Every later milestone has its own
go/no-go.

**Nothing blocks M0.** `pnpm` is not installed on this machine (Node 24.13.0 is); M0 installs it.
