# ADR 0005 — Argon2id passwords and opaque server-side sessions

**Status:** Accepted (planning) · **Date:** 2026-08-25

## Context

The prototype has no authentication: the role is a radio button and any password is accepted.
Everything below replaces that.

## Decision

**Passwords** — Argon2id. Starting parameters `memoryCost` 19456 KiB, `timeCost` 2,
`parallelism` 1 (the OWASP minimum configuration), calibrated on the actual host to
250–500 ms per hash and the measured value recorded in this file at M7. Parameters are
stored with the hash so they can be raised later, with transparent rehash on next login.

**Sessions** — opaque 256-bit CSPRNG tokens. **Only `SHA-256(token)` is stored.** Delivered
in a cookie: `HttpOnly`, `SameSite=Strict`, `Secure` when TLS is active, `Path=/`, no
`Domain`. Absolute lifetime 8 hours, idle timeout 2 hours. Rotated on login and on password
change; all other sessions revoked on password change.

**CSRF** — `SameSite=Strict` as the primary control, plus a double-submit token compared in
constant time on every non-GET request.

**Lockout** — incremental delay (250ms, 500ms, 1s, 2s) then a 15-minute lock after 5
consecutive failures, applied per account _and_ per IP.

## Rationale

Argon2id is the current recommendation and resists both GPU and side-channel attacks.
Calibrating on the real host matters — parameters tuned on a developer laptop can make login
unusable on a mini-PC, and the temptation is then to weaken them silently.

Opaque server-side sessions over JWTs: **revocation is instant.** A JWT stays valid until it
expires no matter what you do, which makes "an employee left today" and "that laptop was
stolen at lunch" into problems you cannot actually solve. Server-side sessions also keep the
token meaningless if leaked from a log.

Storing only the hash means a database read — or a stolen backup — yields no usable session token.

Per-IP lockout alongside per-account matters: account-only lockout lets an attacker lock out
the entire company by failing five logins against every known work email.

## Consequences

- Every authenticated request costs one indexed session lookup. Negligible.
- Login is deliberately slow (~300 ms). This is the point.
- Sessions need periodic sweeping; an hourly job handles it.
- Password change invalidating all other sessions will occasionally surprise a user. The UI
  says so before the change is made.

## Alternatives rejected

- **JWT in `localStorage`** — no revocation, and readable by any script that gets in.
- **JWT in a cookie** — solves the XSS read, not the revocation problem.
- **bcrypt** — acceptable, but Argon2id is the better current choice and is available.
- **Forced periodic password expiry** — produces `Password1!`, `Password2!`, and a sticky
  note. Deliberately not implemented.
