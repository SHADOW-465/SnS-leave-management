# Implementation log — v1

Started from Claude session `bbb7f915-68fa-415b-993d-d39284d5fe05` (planning complete, no
application code). Implementation run 2026-08-26.

## Commands

- `npm install -g pnpm` (corepack EPERM on Program Files)
- `pnpm install` (native `better-sqlite3` skipped; Node 24 `node:sqlite` used)
- `pnpm check` — **passed** 2026-08-26 (format, lint, typecheck, 45 tests)

## Adapter change

`better-sqlite3` could not be built (no Node 24 prebuild, no VS C++ tools). v1 uses
`node:sqlite` (Node 24), as named in ADR 0003. Claimed: unit/integration tests against a
real SQLite file. **Not claimed:** Electron-packaged native rebuild.

## What was built

M0–M6 application code sufficient to **test v1 locally**: server + web UI matching the
prototype visual language, plus a desktop supervisor.

## Claims that are not verified

- Packaged Electron installer / Forge native rebuild
- LAN HTTPS from a second machine
- Certificate trust (D-18)
- Clean-machine install (D-16)
- Manual keyboard + NVDA pass (DW-39)
- Disk-full (F-10)
- Real mailbox delivery (DW-34)
- Excel import against real company workbooks (DW-11)

## Desktop

`pnpm --filter @sns/desktop dev` requires Electron to load TypeScript workspace packages.
The supported v1 test path is `pnpm dev` (server + Vite). Closing a browser tab does not
stop the server; stopping the `pnpm dev` process does.

---

## Remediation pass — 2026-08-26 (Claude)

Triggered by: sign-out not working, features untestable, "login page is only for admin",
and the prototype's visual identity missing. Full codebase inspection found five defects
that were considerably more serious than the reported symptoms.

### Critical — authentication

**`login()` accepted every password, and any wrong password crashed the server.**
`apps/server/src/usecases/auth.ts` called an `async fail()` helper without `await`. The
`throw` inside it became an un-awaited rejected promise, so control flowed straight on to
session creation — a wrong password returned 200 with valid cookies. The same unhandled
rejection terminated the Node process, making a failed login a one-request remote denial
of service.

Reproduced before the fix:

```
POST /api/v1/auth/login {"password":"totally-wrong-password"}  -> HTTP 200 + session cookies
POST /api/v1/auth/login {"email":"nobody@nowhere.invalid"}     -> process exit
```

Fixed by having the helper _return_ the error so each call site reads
`throw await failure(...)`. Verified: 401, no `set-cookie`, zero session rows, server still
answering.

### Critical — lint could not catch it

`eslint.config.js` used the non-type-checked preset, so `no-floating-promises` was not
running. Enabled type-aware linting (`projectService`) with `no-floating-promises` and
`no-misused-promises`. That immediately surfaced four more real defects:

| Location                     | Defect                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `usecases/leave.ts` withdraw | `releaseHold()` not awaited — a withdrawn request could fail to return its balance  |
| `usecases/leave.ts` ×3       | `audit()` not awaited — audit events could land outside their transaction           |
| `routes.ts` notifications    | `markNotificationsRead()` not awaited — "mark all read" returned OK without writing |
| `usecases/setup.ts`          | three seed functions not awaited (below)                                            |

### High — first-run seeding race

`completeSetup` called `seedLeaveTypes`/`seedWorkflows`/`seedPlaceholderHolidays` without
`await`, then `grantOpeningBalances`, which reads `leave_type`. The administrator received
an opening balance for only whichever type happened to be inserted first.

Observed: admin 1 ledger row / 24 half-days; everyone else 3 rows / 84. Now 3 / 84 for all.

### High — sign-out did nothing

`Shell.tsx` called `queryClient.clear()`, which removes cached queries but does not
re-render mounted observers, so the app stayed on screen. The server side was correct all
along (session revoked, cookies cleared — verified by replaying the cookie). Replaced with
a full page load, which also guarantees no previous user's data survives in memory.

### Medium — testability

- Nothing read `.env`; `.env.example` was decorative. Added a small loader in `@sns/config`.
- Development defaulted its data directory to `%PROGRAMDATA%`, which needs elevation. It
  now uses `./data` when `LEAVEOS_ENV` is development or test.
- Sample accounts existed but their password was only ever printed to a console, and all
  five were flagged `must_change_password` — hence "the login page is only for admin".
  They now sign in directly, and the sign-in screen lists them (development only, driven by
  an explicit `demo.accounts` marker so a real account can never appear there).

### Medium — the prototype's typography never applied

`tokens.css` asked for `'Instrument Sans'`; `@fontsource-variable/instrument-sans`
registers the family as `'Instrument Sans Variable'`. The app had been rendering in the
system sans-serif. Fixed the font stack; both families were already bundled locally.

### Medium — missing and inaccessible

- Added `GET /api/v1/attachments/:id`. Upload existed with no way to retrieve a file;
  `safeStoredPath` was imported and unused. The route resolves by database id, applies
  `attachment.medical.read` for medical classification, and returns 403 identically for
  missing and forbidden records.
- Accessible names added: sample-account buttons, the duration radios (announced as "on"),
  and the mobile menu button.
- Removed 14 dead `void x;` lint-suppression statements and their unused imports.

### Verified this pass

- `pnpm check` — format, lint (type-aware), typecheck, **53 tests** across 12 files.
- 9 new regression tests in `apps/server/src/auth.test.ts` covering wrong password, unknown
  email, no session on failure, no password in logs, lockout, logout revocation, cookie
  clearing, and the two seeding races.
- Browser, employee → HR round trip: apply (preview showed 3 working days, balance after 9,
  approver HR Officer) → submit → HR sees it → approve. Ledger reads
  `ENTITLEMENT_GRANT +24, PENDING_HOLD -6, HOLD_RELEASE +6, DEDUCTION -6` = 18 half-days =
  9 days, matching the preview exactly. Audit, in-app notifications for both parties, and a
  queued (not blocking) outbox row all present.
- RBAC denials by direct API call: manager approve 403, manager payroll export 403,
  HR system-health 403.
- Sign-out returns to the sign-in screen; replaying the old cookie gives 401.
- Mobile 375px: navigation collapses to a labelled menu button.

### Still not verified

Unchanged from the list above: packaged Electron installer, LAN HTTPS from a second
machine, certificate trust, clean-machine install, manual keyboard/NVDA pass, disk-full,
real mailbox delivery, Excel import against real workbooks.

---

## Production-readiness pass — 2026-08-27 (Claude)

Triggered by: development scaffolding visible as product (a placeholder banner, a
"Placeholder rules" KPI, "Placeholder entitlement" on balance cards), the holiday calendar
not working, and a request to verify the rules editor was genuinely complete. Inspection
found two defects that would have made the packaged product unusable.

### Critical — the production build did not work at all

**The server served no interface.** `path.resolve(here, '../../../web/dist')` from
`apps/server/src` resolves to `<repo>/web/dist`. The build output is at
`apps/web/dist`. Every page request returned 404 while the API answered normally — which
is why this was never noticed in development, where Vite serves the UI on its own port.

**A strict CSP would have shipped an unstyled interface.** `style-src 'self'` blocks
React's element `style` attributes, which this codebase uses throughout, and
`font-src 'self'` blocks the `data:` font subsets the bundler inlines. Both were verified
failing in a real browser against the production server before the fix, and verified clean
after. `script-src` remains `'self'` with `script-src-attr 'none'` — the directive that
actually prevents XSS is unchanged. Recorded as an accepted deviation in SECURITY.md.

### Critical — dashboard scope leak

`dashboard()` called `requirePrincipal` and then `void p` — no permission check. Reproduced
before the fix: an employee account received company headcount, per-department leave
statistics, and the pending approval queue.

```
GET /api/v1/dashboard  (as employee)  ->  200 {"kpis":[...],"deptStats":[...]}   # before
GET /api/v1/dashboard  (as employee)  ->  403                                     # after
```

### High — the holiday calendar

The reported "doesn't seem to be working properly" had four causes:

| Cause                                      | Effect                                                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNIQUE (holiday_calendar_id, date, kind)` | One date could be public _and_ optional _and_ declared-working simultaneously. Re-marking added a row; the UI showed whichever `find()` hit first, so the change looked ignored |
| Route did a plain `INSERT`                 | No upsert path existed                                                                                                                                                          |
| `DELETE FROM holiday WHERE date = ?`       | Removed that date from **every** calendar in the company                                                                                                                        |
| No validation or error surfacing           | An empty name silently saved the literal string `"public"`; a failed request showed nothing at all                                                                              |

Fixed with migration `0002_holiday_one_kind_per_date` (rebuilds the table with
`UNIQUE (holiday_calendar_id, date)`, keeping the most recent row per date), an
`ON CONFLICT DO UPDATE` route, calendar-scoped deletion with date validation, and audit
events for create/update/remove.

Verified that the calendar genuinely drives the leave engine:

```
Mon 7 – Fri 11 Sep 2026                     -> 5 working days
  + public holiday on the 10th              -> 4 working days, skipped "10 Founders Day"
  + optional holiday on the 10th instead    -> 5 working days   (correctly not excluded)
Fri 11 – Mon 14 Sep 2026                    -> 2 working days
  + Sat 12 declared a working day           -> 3 working days
```

### High — the rules editor was not complete

The domain enforces thirteen policy fields. The Settings page could edit **one**
(entitlement days) and wrote `isPlaceholder = false` as a side effect. Rebuilt as a full
editor — accrual method and cadence, mid-year pro-rating, carry-forward cap and expiry,
probation restriction and limit, half-days, minimum notice, maximum consecutive days,
negative balance, attachment threshold — grouped into four fieldsets, each field with a
plain-English hint, plus an effective date, dirty-state tracking, discard, and explicit
success and error states. Publishing is transactional and writes an audit event carrying
the before and after rules.

Verified a published rule is enforced immediately, through the API and through the UI:

```
publish CL maxConsecutiveDays=2 -> submit 4 days -> LEAVE_MAX_CONSECUTIVE
publish CL minNoticeDays=3      -> submit tomorrow -> LEAVE_MIN_NOTICE
UI: Casual leave 12 -> 15 days, v3 -> v4
```

### Medium — production posture and metrics

- Removed `isPlaceholder` from the domain type, contracts, seed, `/me`, the health
  endpoint, and every screen. `PLACEHOLDER_POLICY` is now `DEFAULT_POLICY`.
- The dashboard KPI row is four figures an approver can act on: awaiting decision (with how
  long the oldest has waited), out today (named), starting leave within seven days, active
  employees. The "Placeholder rules: Yes" tile is gone.
- Balance cards: a type with no entitlement and no history no longer renders "0 / 0".
  "Taken" is summed from `DEDUCTION`/`ENCASHMENT`/`EXPIRY` ledger rows rather than inferred
  as entitlement minus remaining, which is wrong once any adjustment or carry-forward exists.
- The calendar seeds no holidays. Inventing plausible-looking public holidays and shipping
  them as company data is worse than an empty calendar with a clear empty state.
- Page-level inline `<style>` blocks moved into `product.css` as real classes.

### Accessibility

Accessible names added where the tree reported none or reported a value: the leave-rules
fields and toggles (via explicit `id`/`htmlFor` and `useId`), the policy expand controls,
and the leave-year inputs. Calendar cells announce e.g. "Thu, 27 Aug 2026, working day" or
"…, Public holiday: Founders Day"; arrow keys move through the grid.

### Verified this pass

- `pnpm check` — format, type-aware lint, typecheck, **69 tests** (16 new).
- Production build served from Fastify on :3300: `index.html`, CSS, JS, and woff2 all 200;
  SPA deep links serve the app; API 404s stay JSON; **zero CSP violations** in the browser
  console; `Instrument Sans Variable` reports `loaded`.
- Browser, HR: dashboard shows the four new KPIs and no banner; opened Casual leave, changed
  12 → 15 days, published, saw v4; added a holiday from the calendar and saw it in the grid,
  the sidebar, and the month list; empty-name validation refused to save.
- API: employee dashboard 403, employee holiday write 403, employee policy publish 403.

### Still not verified

Unchanged: packaged Electron installer, LAN HTTPS from a second machine, certificate trust,
clean-machine install, manual keyboard/NVDA pass, disk-full, real mailbox delivery, Excel
import against real workbooks.
