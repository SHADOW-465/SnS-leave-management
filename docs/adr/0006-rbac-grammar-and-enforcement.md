# ADR 0006 — Permission grammar and where enforcement lives

**Status:** Accepted (planning) · **Date:** 2026-08-25

## Context

Managers must see their reports and nobody else's. HR must see everyone but must not hold
system power. Payroll fields need protection separate from row access. And the prototype
enforces nothing at all.

## Decision

Permission strings are `resource.action:scope`, e.g. `leave.request.approve:direct_reports`.
Scopes, narrowest to widest: `self`, `direct_reports`, `reports_recursive`, `team`,
`department`, `location`, `company`.

**Default deny.** Roles are data, not code.

**Enforcement happens in the use-case**, as its first act, with the principal and the
resolved target. Every use-case takes a `RequestContext` as its first argument, so it cannot
be called without a principal — the type system forbids it. Repositories returning
employee-scoped data _also_ apply the scope predicate in SQL, as a deliberate second layer.

Routes perform no authorisation. The UI hides controls it cannot use, as a courtesy, and
every hidden control has a matching server denial test.

Field-level classifications (`payroll`, `medical`, `identity`, `contact_private`) are checked
separately from row scope.

## Rationale

Route-level guards are forgotten exactly once, and the resulting hole is invisible until
someone finds it. A use-case that structurally cannot run without a principal fails closed.

The SQL scope predicate is redundant on purpose: a forgotten `authorize` call still returns
no rows the caller should not see. Two independent mistakes are needed to leak data.

Row scope and field sensitivity are genuinely different questions. A manager legitimately
sees a report's leave request _and_ must not see the medical certificate attached to it.
One mechanism cannot express that cleanly.

## Consequences

- More ceremony per use-case. Accepted.
- The permission list must be canonical and seeded — a permission string typo becomes a
  silent denial otherwise. A test asserts every permission referenced in code exists in the seed.
- Denial tests are **generated from the RBAC matrix**, so a new permission cannot be added
  without its denials.
- Every 403 writes an audit event.

## Alternatives rejected

- **Route-level middleware guards only** — one forgotten decorator is a breach.
- **Role checks in the UI** — not a control, and the brief explicitly forbids relying on it.
- **Row-level security in the database** — SQLite does not have it, and the future PostgreSQL
  adapter should not be the only place the rules exist.
- **A generic policy engine (CASL, Casbin)** — a dependency and a second mental model for a
  fixed, well-understood matrix of six roles. Reconsider only if roles become dynamic.
