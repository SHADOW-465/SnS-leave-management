# Design system, responsive strategy, and accessibility

Planning document. Tokens are proposed values, to be verified for contrast before
implementation.

The prototype's visual direction is good and is kept. Its _implementation_ — 1,100 inline
style attributes, a fixed desktop layout, remote fonts — is not.

---

## 1. Principles

1. **Semantic tokens, one location.** Components reference `--color-status-approved`, never
   `#17683a`. A colour used directly in a component is a lint error.
2. **Density with air.** This is a data tool. Compact rows, generous line-height, real
   whitespace between groups.
3. **One accent.** Indigo carries focus, links, and selection. It does not decorate.
4. **No decoration without a job.** No gradients, no glass, no shadow stacks, no nested
   cards, no hover scaling, no animation that is not communicating a state change.
5. **One icon family** — Lucide, bundled. No emoji as an interface element.
6. **Everything local.** Fonts, icons, and images ship in the bundle. Zero external requests,
   enforced by CSP.

---

## 2. Tokens

Colour values are the prototype's, kept as the starting palette. **Every foreground/background
pair is contrast-checked before implementation and the measured ratio is recorded here.**
`text-muted` is already known to fail — see §4.

```
/* Surfaces */
--surface-canvas:        #fbfbfa
--surface-default:       #ffffff
--surface-raised:        #f6f6f3
--surface-sunken:        #f4f4f1
--surface-selected:      #e6e6ff

/* Borders */
--border-subtle:         #e8e8e4
--border-default:        #d9d9d2
--border-strong:         #a8a8a0     /* added — the prototype lacked a strong border */

/* Text */
--text-primary:          #16161a     /* 16.4:1 on white */
--text-secondary:        #5c5c66     /*  7.2:1 */
--text-tertiary:         #6b6b76     /*  5.6:1 */
--text-muted:            #8a8a94     /*  3.4:1 — LARGE TEXT AND NON-ESSENTIAL ONLY, see §4 */
--text-on-accent:        #ffffff

/* Accent */
--accent-default:        #4f46e5
--accent-hover:          #3730a3
--accent-subtle-bg:      #e6e6ff

/* Status — each pairs with a text label and a distinct icon, never colour alone */
--status-approved-fg:    #17683a   --status-approved-bg:  #eef8f0
--status-rejected-fg:    #a3271b   --status-rejected-bg:  #fdeaea
--status-pending-fg:     #8a6116   --status-pending-bg:   #fff8e6
--status-neutral-fg:     #5c5c66   --status-neutral-bg:   #efefeb

/* Typography */
--font-body:  "Instrument Sans", ui-sans-serif, system-ui, sans-serif
--font-mono:  "JetBrains Mono", ui-monospace, monospace
--text-xs: 12px  --text-sm: 13px  --text-base: 15px  --text-lg: 17px
--text-xl: 20px  --text-2xl: 24px --text-3xl: 30px   --text-4xl: 38px
--leading-tight: 1.15   --leading-normal: 1.55

/* Spacing — 4px base, limited scale */
--space-1: 4px   --space-2: 8px   --space-3: 12px  --space-4: 16px
--space-5: 20px  --space-6: 24px  --space-8: 32px  --space-10: 40px  --space-14: 56px

/* Radius — four values, no more */
--radius-sm: 5px  --radius-md: 8px  --radius-lg: 10px  --radius-full: 999px

/* Elevation — two levels only */
--shadow-sm: 0 1px 2px rgba(22,22,26,.06)
--shadow-md: 0 4px 12px rgba(22,22,26,.08)     /* modals and drawers only */

/* Controls */
--control-height: 42px          /* 44px minimum touch target on coarse pointers */
--focus-ring: 3px solid var(--accent-default)   /* offset 2px */
```

Both font families are self-hosted woff2 with `font-display: swap` and a matched system
fallback stack, so a font that fails to load does not shift the layout meaningfully.

---

## 3. Responsive strategy

Breakpoints: **360 · 390 · 768 · 1024 · 1280 · 1440**. Every one is checked at every
milestone, not at the end.

| Surface                 | ≥1280                            | 768–1279                                         | <768                                                                                          |
| ----------------------- | -------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Shell                   | Fixed sidebar + content          | Collapsible sidebar (icons)                      | Drawer behind a labelled control; focus trap, ESC, `aria-expanded`                            |
| Login                   | Two columns                      | Single column, aside below                       | Single column, aside removed                                                                  |
| KPI tiles               | 4 across                         | 2 across                                         | 1 across                                                                                      |
| Request / people tables | Full columns                     | Priority columns, the rest behind "show details" | One card per row; the two decision-critical fields promoted; no horizontal scroll             |
| Approval queue          | Table + side drawer              | Table + full-width drawer                        | Card list + full-screen sheet                                                                 |
| Month calendar          | 7-column grid                    | 7-column grid, compact cells                     | **Agenda list** — day, person, status. Not a shrunken grid.                                   |
| Team availability       | 14-day grid                      | 7-day grid with paging                           | One row per person, horizontal scroll, sticky name column, with the date range stated in text |
| Apply form              | Two columns, live summary beside | Single column, summary above submit              | Single column, summary above submit, sticky submit bar                                        |
| Charts                  | Chart + data table               | Chart + data table                               | **Data table only**, with the chart offered behind a disclosure                               |
| Modals                  | Centred dialog                   | Centred dialog                                   | Full-screen sheet                                                                             |

**Deliberate horizontal scroll** is allowed for the availability grid only, and only with a
sticky first column, a visible scroll affordance, and a text statement of the visible range.
Nowhere else.

---

## 4. Accessibility — WCAG 2.2 AA targets

| Area         | Commitment                                                                                                                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keyboard     | Every function reachable and operable by keyboard. Logical tab order. No traps except intentional modal traps.                                                                                                                               |
| Focus        | Visible 3px ring at 2px offset on every focusable element. Never `outline: none` without a replacement.                                                                                                                                      |
| Skip link    | "Skip to main content" as the first focusable element — the prototype had this; keep it.                                                                                                                                                     |
| Headings     | One `h1` per page, no level skipped, headings describe content rather than styling.                                                                                                                                                          |
| Forms        | Every input has a `<label>`. Errors are programmatically associated via `aria-describedby`, announced in a live region, and listed at the top of the form with anchor links.                                                                 |
| Modals       | `role="dialog"`, `aria-modal`, labelled by heading, focus trapped, ESC closes, focus returns to the trigger.                                                                                                                                 |
| Tables       | Real `<table>` with `<th scope>` and a `<caption>`. Sortable headers use `aria-sort`.                                                                                                                                                        |
| Calendar     | Grid semantics, roving tabindex with arrow keys, `aria-selected`, month changes announced.                                                                                                                                                   |
| Charts       | An equivalent `<table>` accompanies every chart; the visual chart is `aria-hidden`. This is the only correct answer for a div-based bar chart.                                                                                               |
| Status       | Never colour alone. Text label plus a distinct icon shape for approved / pending / rejected.                                                                                                                                                 |
| Contrast     | 4.5:1 for body text, 3:1 for large text and UI boundaries. **`--text-muted` at 3.4:1 is restricted to text ≥24px, or ≥18.66px bold, or purely decorative content.** Anything smaller uses `--text-tertiary`. Measured and recorded per pair. |
| Motion       | `prefers-reduced-motion: reduce` removes all non-essential animation. No animation carries meaning on its own.                                                                                                                               |
| Touch        | 44×44 CSS px minimum on coarse pointers.                                                                                                                                                                                                     |
| Zoom         | Usable at 200% zoom and at 320px equivalent width with no loss of function.                                                                                                                                                                  |
| Language     | `lang` set. Dates rendered unambiguously (`12 Mar 2026`, never `03/12/2026`).                                                                                                                                                                |
| Live regions | Toasts and async results announced politely; errors assertively.                                                                                                                                                                             |

**Verification:** axe-core in component tests, a keyboard-only pass per flow, and a manual
screen-reader pass with NVDA on the key employee and manager journeys. Automated checks
catch roughly a third of real issues, so the manual pass is the gate, not the axe score.
Accessibility is **not claimed as verified** until that manual pass is run and recorded.

---

## 5. The nine required states

Every data surface implements all nine. A screen is not done until each has been seen.
Reviewed as a checklist per screen, and each is a Playwright or Storybook case.

| State                  | Requirement                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Loading**            | Skeleton matching the final layout. No spinner-only screens. No layout shift on arrival.                                                                                    |
| **Empty**              | Explains what would appear here and offers the action that creates the first one. Never a bare "No data".                                                                   |
| **No search results**  | Distinct from empty. Echoes the query, offers to clear filters.                                                                                                             |
| **Validation error**   | Field-level messages, a summary at the top with anchors, focus moved to the summary.                                                                                        |
| **Permission denied**  | "You do not have permission to view this." Explains who to ask. Never a raw 403 and never a blank page.                                                                     |
| **Server unavailable** | "Cannot reach the Leave OS server." Names the likely cause — the office computer may be off — and offers retry. This is the state that will be seen most often in real use. |
| **Offline**            | Browser lost the network. Distinct from server-unavailable, because the fix is different.                                                                                   |
| **Stale data**         | A background refetch failed but cached data is shown. Says so, with the age, and a manual refresh.                                                                          |
| **Unexpected error**   | Human sentence, a request id to quote, a retry, and a collapsed technical section. Never a stack trace as the primary content.                                              |

**No premature optimistic UI.** A leave request shows as submitted only after the server
transaction commits. The prototype's instant status flip is exactly the pattern that makes
users distrust a system the first time it lies to them. Optimistic updates are permitted
only for genuinely reversible, non-consequential interactions such as marking a
notification read.

---

## 6. Component inventory (Phase 1)

**Primitives** — Button, IconButton, Input, Textarea, Select, Combobox, Checkbox, Radio,
DatePicker (native `<input type="date">` as the base — it is keyboard- and
screen-reader-correct for free, and localised by the browser), FileInput, Switch, Badge,
StatusPill, Avatar, Tooltip, Spinner, Skeleton.

**Layout** — AppShell, SidebarNav, MobileNavDrawer, PageHeader, Section, Card, Toolbar,
SplitView.

**Data** — DataTable (sortable, paginated, responsive-card fallback), DefinitionList,
KeyValueGrid, EmptyState, ErrorState, PermissionDeniedState, Pagination.

**Feedback** — Toast, InlineAlert, ConfirmDialog, Drawer, Modal, FormErrorSummary.

**Domain** — BalanceCard, LeaveRequestRow, ApprovalDrawer, WorkingDaysSummary (with the
skipped-days breakdown), OverlapWarning, MonthCalendar, AgendaList, AvailabilityGrid,
ApprovalTrail, LedgerTable, AuditEventRow, ImportPreviewTable.

Each ships with its states, an axe test, and a keyboard test. No component library is
adopted; the inventory is small and specific enough that a dependency would cost more in
override-fighting than it saves.
