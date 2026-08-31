# ADR 0007 — Zod contracts generate both validation and the OpenAPI document

**Status:** Accepted (planning) · **Date:** 2026-08-25

## Context

Three things must agree about the shape of every request and response: the server's runtime
validation, the client's TypeScript types, and the API documentation. Maintained separately,
they diverge — and the documentation diverges first and most quietly.

## Decision

`packages/contracts` holds a Zod schema per endpoint for params, query, body, and response.
From that single definition:

- the server validates at runtime,
- TypeScript types are inferred for both server and client,
- the OpenAPI document is generated.

All object schemas use **strict** parsing: unknown keys are rejected, not silently stripped.

## Rationale

One definition cannot drift from itself. Generated documentation is the only kind that stays
true, because nobody remembers to update the other kind.

Strict parsing is a security control, not a style preference: a request body carrying
`"role": "admin"` or `"scope": "company"` is rejected outright rather than quietly ignored,
and the attempt is visible and auditable. Silent stripping hides probing.

## Consequences

- The contracts package is a required dependency of both `server` and `web`, and must stay
  free of runtime dependencies on either.
- A breaking schema change is visible as a type error across the whole repository, which is
  the desired behaviour.
- Strict parsing means an older client sending an extra field breaks. Acceptable — client
  and server ship together in one installer.
- The OpenAPI document is a build artefact, not a hand-maintained file, and is regenerated
  in CI with a check that it is up to date.

## Alternatives rejected

- **Hand-written OpenAPI** — drifts within a fortnight.
- **tRPC** — good type safety, but produces no OpenAPI document, and the brief requires one.
- **JSON Schema directly** — verbose, and loses TypeScript inference.
- **Non-strict parsing** — hides exactly the requests worth noticing.
