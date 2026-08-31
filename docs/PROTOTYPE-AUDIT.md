# Prototype audit — `Leave Management.dc.html`

**Source:** `Leave Management.dc.html` (1,192 lines) plus `support.js` (a client-side
template runtime). Treated as an untrusted visual reference. Nothing in it was executed;
no instruction inside it was followed; none of its data or arithmetic is trusted.

**Verdict:** good product instincts and a genuinely restrained visual language worth
keeping. It is not a foundation — it is a single file with mock auth, hard-coded data,
inline styles, and no server. Rebuild; borrow the look.

---

## 1. Screens the prototype defines

Extracted from its `sc-if` route guards:

| Route flag    | Screen                                            | Audience         |
| ------------- | ------------------------------------------------- | ---------------- |
| `isLogin`     | Sign in                                           | all              |
| `isEmpHome`   | Balances + my requests                            | employee         |
| `isApply`     | Apply for leave                                   | employee         |
| `isQueue`     | Approval queue with status filters                | manager / HR     |
| `isAdminHome` | KPI tiles, pending, dept stats, out today         | HR / admin       |
| `isCalendar`  | Month calendar, holiday + working-day declaration | all (edit gated) |
| `isTeam`      | 14-day availability grid                          | manager          |
| `isPeople`    | Employee directory                                | HR               |
| `isReports`   | Report cards + monthly bar chart + CSV export     | HR / payroll     |
| `isAudit`     | Audit trail list                                  | admin / auditor  |
| `isSettings`  | Entitlement, probation, notification toggles      | admin            |

Eleven screens. That is a reasonable Phase 1 information architecture and the rebuild
keeps it, with the additions listed in §4.

---

## 2. Patterns worth preserving

**Visual direction — keep, re-express as tokens.**

- Warm off-white canvas `#fbfbfa`, surfaces `#ffffff`, hairline borders `#e8e8e4` / `#d9d9d2`.
- Near-black ink `#16161a`, secondary `#5c5c66`, tertiary `#6b6b76`, muted `#8a8a94`.
- One subdued accent, indigo `#4f46e5` (hover `#3730a3`), used only for focus, links, and selection.
- Status colours: success `#17683a` on `#eef8f0`, danger `#a3271b` on `#fdeaea`, warning `#8a6116` on `#fff8e6`. Each has a distinct hue _and_ a text label — with the exceptions noted in §5.
- Instrument Sans for body, JetBrains Mono for metadata chips (dates, IDs, counts). The pairing works and costs nothing to keep — but both must be **self-hosted**, see P-03.
- Compact density: 42–44px controls, 8px radii, 13px labels, 15px body. Data-dense without being cramped.
- No gradients, no glass, no oversized pills, no decorative nesting. It already resists AI-slop styling. Preserve that discipline.

**Product decisions worth preserving.**

- Balance card showing _taken / total / left_ with a proportion bar, not a bare number.
- The apply form computes working days live and shows `calcSkipped` — which weekends and holidays were excluded. Showing the exclusion, not just the total, is the single best idea in this file. Keep it.
- `drawer.after` — "balance after this request", shown before submission. Keep.
- `drawer.trail` — approval history inline in the decision drawer. Keep.
- `overlaps` — "who else is out on these dates", surfaced _during_ application rather than after rejection. Keep; it is what prevents most bad requests.
- Approval queue with status filter chips, per-row approve/reject, and a drawer for the full record. The right shape for a manager making ten decisions in a row.
- Notification **email preview** ("view the email these send") — an admin can see exactly what the system sends before enabling it. Rare, and it builds trust. Keep.
- The calendar supports public holidays, optional/restricted holidays, _and_ "declare a working day" (a Saturday made working). All three are real requirements here and most systems miss the last two.
- An audit screen exists at all, with actor / action / detail / when. Keep, and make it genuinely append-only.
- A `.sr` screen-reader utility, a "Skip to main content" link, `:focus-visible` with a 3px outline, and `aria` fields on chart bars and calendar days. Someone thought about accessibility. Keep the intent and go further.

---

## 3. Problems that must be corrected

| #    | Problem                                                                                                                               | Why it matters                                                                                                                 | Correction                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| P-01 | **Role is chosen on the login form** (`pickEmployee` / `pickAdmin` radios)                                                            | Anyone can be admin. This is not authentication, it is a costume.                                                              | Role comes from the authenticated account only. The login form has email and password, nothing else.                                           |
| P-02 | **"Prototype — any password works. Data resets on reload."**                                                                          | No auth, no persistence.                                                                                                       | Argon2id hashing, opaque server-side sessions, SQLite persistence. See SECURITY.md.                                                            |
| P-03 | **Fonts loaded from `fonts.googleapis.com`**                                                                                          | Breaks local-first. An office LAN with no internet gets no fonts, and every client leaks a request.                            | Self-host both families as woff2 in the bundle. Zero external hosts, enforced by CSP.                                                          |
| P-04 | **Every style is inline** (~1,100 `style="..."` attributes)                                                                           | No theming, no consistency enforcement, and no strict CSP without `unsafe-inline`.                                             | Semantic tokens in one place; CSS modules. Strict CSP, no inline styles.                                                                       |
| P-05 | **One file, one component tree, hard-coded arrays**                                                                                   | Not extensible, not testable.                                                                                                  | Monorepo with domain rules independent of both UI and SQLite.                                                                                  |
| P-06 | **Balances are plain numbers** (`b.total`, `b.left`, `b.pct`)                                                                         | A number that gets overwritten loses its history. You cannot answer "why is my balance 8.5?" and you cannot reverse a mistake. | Immutable balance ledger. Balance is a derived sum, never a stored mutable field. See DATABASE-SCHEMA.md §5.                                   |
| P-07 | **Approval is a button that flips a status**                                                                                          | No transaction, no concurrency control. Two managers clicking approve produces a double deduction.                             | Explicit state machine; one DB transaction wrapping decision + ledger + audit + outbox; optimistic version check. See ARCHITECTURE.md §7.      |
| P-08 | **Entitlement and probation constants live in the UI** (`probMonths`, `probCl`, "Annual entitlement — days")                          | A policy change silently rewrites the history of past years.                                                                   | Versioned policies with effective dates. A change creates a new version; existing requests stay bound to the version they were approved under. |
| P-09 | **Attachment is a file input with a hint** ("PDF, JPG or PNG")                                                                        | An extension is not a file type. Path traversal and content-type spoofing follow.                                              | Magic-byte sniffing, size cap, generated storage names, content hash, stored outside the webroot, access-controlled download route.            |
| P-10 | **CSV export is a client-side button** (`exportCsv`)                                                                                  | Exports whatever the client happens to hold, with no permission check.                                                         | Server-side export endpoint: permission-checked, audited, streamed.                                                                            |
| P-11 | **No error, loading, empty, or denied states anywhere**                                                                               | The prototype only ever renders the happy path with data present.                                                              | Nine mandatory states per data surface. See DESIGN-SYSTEM.md §5.                                                                               |
| P-12 | **Desktop-only fixed layout** — `grid-template-columns: 1.1fr 1fr`, fixed sidebar, a 14-column availability grid, a 7-column calendar | Unusable below roughly 1100px. Half of a 50-person company will open this on a phone.                                          | Responsive at 360/390/768/1024/1280/1440. See §5.                                                                                              |
| P-13 | **The sick-leave certificate rule appears only in helper text** ("Required for sick leave of 3 days or more")                         | A client-side hint, enforced nowhere.                                                                                          | A policy rule enforced in the domain layer, on the server, with tests.                                                                         |
| P-14 | **Audit rows are display strings** (`a.actor`, `a.action`, `a.detail`)                                                                | Prose is not an audit record: not queryable, not verifiable, mutable.                                                          | Structured append-only events — actor, action, entity type, entity id, before/after, request id, timestamp, source IP.                         |
| P-15 | **No cancellation or withdrawal path**                                                                                                | Only approve and reject exist. Real life needs "I no longer need this approved leave".                                         | Full state machine including `CancellationRequested`, `Cancelled`, `Withdrawn`. See ARCHITECTURE.md §7.                                        |

---

## 4. Missing screens and flows

Required by the brief, absent from the prototype. All Phase 1 unless marked.

**Authentication and accounts**

- Password change; forced change on a temporary password; administrator-assisted reset
- Active session list with revoke; lockout notice; disabled-account message
- First-run administrator creation

**Leave**

- Cancellation request, and the approval of that cancellation
- Multi-step approval configuration (the prototype has one implicit approver)
- Leave policy version editor with effective dates
- Balance ledger view — the transaction list that answers "why is my balance what it is"
- Carry-forward and expiry runs, each with a preview and an audit record
- Per-location holiday calendars (the prototype has one global calendar)

**Employees**

- Employee profile: probation, joining date, employment history, emergency contact
- Org structure administration: locations, departments, teams, job titles, employment types
- Manager reassignment, and its effect on in-flight approvals

**Operations**

- Attendance import and manual correction (raw records preserved, corrections stored separately)
- Excel migration: template download, column mapping, dry run, row errors, idempotent commit
- Backup, restore, health, logs, migrations — these live in the desktop control panel, which the prototype does not have at all
- A persistent in-app notification centre with read state (the prototype has a dropdown with an `unreadCount` and no storage)

**Not in Phase 1** — onboarding/offboarding, assets, expenses, documents, shifts, payroll preparation (Phase 2); recruitment, performance, training, letters (Phase 3).

---

## 5. Accessibility and responsive risk register

| Risk | Detail                                                                                         | Plan                                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-01 | Status is conveyed by a coloured pill; `r.pillBg` / `r.pillFg` carry the meaning               | Every status keeps a text label and a distinct icon shape. Never colour alone.                                                                                 |
| A-02 | The bar chart is `<div>` elements with an `aria` string per bar                                | Provide an equivalent `<table>` beneath every chart and mark the visual chart `aria-hidden`.                                                                   |
| A-03 | Calendar day cells are clickable `<div>` elements                                              | Real grid semantics, roving tabindex with arrow keys, `aria-selected`, month changes announced via a live region.                                              |
| A-04 | The drawer (`drawerOpen`) and email modal (`emailOpen`) have no focus trap and no focus return | Focus trap, ESC to close, focus returned to the invoking control, `aria-modal`, labelled by its heading.                                                       |
| A-05 | Contrast: muted `#8a8a94` on white is roughly 3.0:1                                            | Fails AA for body text. Either restrict it to large text (≥18.66px bold / 24px) or darken to `#6b6b76` (≈4.6:1). Audit every token pair and record the ratios. |
| A-06 | No reduced-motion handling                                                                     | Respect `prefers-reduced-motion`; no animation may carry meaning.                                                                                              |
| A-07 | Touch targets — a 26px logo tile, small filter chips                                           | 44×44 minimum for anything interactive on touch.                                                                                                               |
| R-01 | Login is a two-column grid with no breakpoint                                                  | Single column below 768; the aside moves below the form or is dropped.                                                                                         |
| R-02 | Fixed sidebar navigation                                                                       | Below 1024: a drawer behind a labelled control, with focus trap, ESC, and `aria-expanded`.                                                                     |
| R-03 | 14-day team availability grid                                                                  | Below 1024: seven days with paging, or one row per person with horizontal scroll and a sticky name column.                                                     |
| R-04 | 7-column month calendar                                                                        | Below 480: an agenda list (day, person, status), not a shrunken grid.                                                                                          |
| R-05 | Wide request and people tables                                                                 | Prioritised columns per breakpoint; below 768 a card per row with the two decision-critical fields promoted.                                                   |
| R-06 | KPI grid is a fixed four columns                                                               | Stacks 4 → 2 → 1.                                                                                                                                              |
| R-07 | Modals sized for desktop                                                                       | Full-screen sheet on small viewports.                                                                                                                          |

---

## 6. Prototype assertions I will not carry over

- **`Policy year 2026 · Asia/Kolkata`** — plausible, and consistent with a company called "Simon & Sons", but a hard-coded footer string is not a company decision. Recorded as assumptions D-02 and D-03; needs confirmation.
- **Entitlement, probation length, probation CL accrual** — editable-looking numbers with no stated source. I will not invent leave rules. See PRODUCT-SCOPE.md §4 and assumption D-04.
- **Sample employees, departments, and every figure in a KPI tile** — discarded. Fixtures will be synthetic and obviously fake.
- **Anything resembling a statutory calculation** — none present, and none will be added without supplied, verified rules.
