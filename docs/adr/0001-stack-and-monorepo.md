# ADR 0001 — Stack and monorepo layout

**Status:** Accepted (planning) · **Date:** 2026-08-25

## Context

A local-first employee management system for ~50 people, run on one Windows machine, with a
future cloud path that must not require a rewrite. The stack was fixed by the brief; this
record captures the choices _inside_ that constraint.

## Decision

pnpm workspaces, TypeScript strict, Node 24 LTS. Packages split as in ARCHITECTURE §2, with
a one-way dependency rule enforced by an ESLint boundary rule.

**Fastify serves both the JSON API and the built web assets from a single process on a
single port.**

`packages/domain` depends on nothing else in the repository and defines repository
_interfaces_; `packages/database` implements them for SQLite.

## Rationale

One port means one certificate, one firewall rule, one thing to start, and one thing to
explain to an operator who has never installed a server. A separate static host would double
the operational surface for no benefit on a LAN.

The domain/repository split is the only abstraction introduced before its second
implementation exists. It earns that exception because the brief explicitly requires a
future PostgreSQL adapter, and retrofitting the boundary after SQLite types have leaked
through the codebase is a far larger job than establishing it now.

## Consequences

- A UI change requires a full rebuild and restart. Acceptable — releases are infrequent.
- The boundary rule will occasionally be inconvenient. That is what it is for.
- `domain` cannot use Drizzle types, so some duplication of shape between domain models and
  database rows is accepted deliberately.

## Alternatives rejected

- **Next.js** — the brief fixes React + Vite, and server components add a mental model this
  team does not need for a LAN-served app.
- **Separate API and web processes** — two ports, two certificates, two failure modes.
- **A single package, no workspaces** — the domain rules would become untestable in
  isolation and the storage boundary would not survive contact with a deadline.
