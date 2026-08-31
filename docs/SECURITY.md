# Security design and threat model

Planning document. **Nothing here is verified.** Every control below is a design intent
until its test is written and run; the verification report at the end of the build will
say which were actually exercised.

---

## 1. Threat model

Assets, in order of what would hurt most to lose: the leave and audit history (integrity),
employee personal data (confidentiality), medical certificates and payroll fields
(confidentiality, high sensitivity), system availability during working hours.

| #    | Threat                                               | Realistic scenario                                                                                      | Controls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-01 | **Malicious or curious employee**                    | An employee reads a colleague's salary or medical certificate, or approves their own leave              | Default-deny RBAC enforced in use-cases _and_ repositories; field-level classification for payroll, medical, identity; approvers are resolved server-side, never chosen by the requester; every denial audited. **Exception, stated rather than hidden: an Admin may approve their own leave (D-08).** It requires a distinct permission, is labelled as a self-approval on the record and in the UI, writes a `leave.self_approved` audit action, and appears in a standing report. See T-19 |
| T-02 | **Lost or stolen employee laptop**                   | A laptop with a live browser session is taken                                                           | Session expiry (8h absolute, 2h idle); HttpOnly cookies so no token is readable by script or by a file copy; nothing sensitive cached in `localStorage`; administrator can revoke any session immediately; server-side sessions mean revocation is instant, not "until the JWT expires"                                                                                                                                                                                                       |
| T-03 | **Stolen backup file**                               | A USB drive with a backup copy leaves the building                                                      | Backups encrypted at rest for any off-machine copy; restrictive ACLs on the backup folder; a backup contains password _hashes_ (Argon2id), not passwords; documented procedure treats the backup as equally sensitive to the live database — because it is                                                                                                                                                                                                                                    |
| T-04 | **Direct API calls bypassing the UI**                | Someone reads the JS bundle, finds `/api/v1/employees`, and calls it with their own cookie              | Authorisation is server-side in the use-case; the UI is never a control; every `—` in the RBAC matrix has a direct-API denial test; filter and sort fields validated against an allowlist so no column can be selected or ordered by arbitrarily                                                                                                                                                                                                                                              |
| T-05 | **Altered import file**                              | A modified CSV grants someone 400 leave days, or a formula injects into an export                       | Zod validation per row; balance changes only ever via ledger entries, never a direct write; dry run with a preview and reconciliation totals before commit; one transaction boundary — all or nothing; the source file and its SHA-256 preserved; CSV exports prefix `= + - @` with an apostrophe to defeat formula injection                                                                                                                                                                 |
| T-06 | **Path traversal on attachments**                    | A filename of `..\..\config.json`, or a download request with a crafted id                              | Stored names are generated server-side and never derived from user input; the original name is stored as data and never used as a path; downloads are looked up by database id, never by path; the resolved absolute path is asserted to be inside the attachments root before any read                                                                                                                                                                                                       |
| T-07 | **Upload abuse**                                     | A 4 GB file, a PHP script renamed `.pdf`, a zip bomb, an SVG with script                                | Size cap enforced while streaming, not after; magic-byte detection with an allowlist (PDF, PNG, JPEG); `detected_type` must match the declared type; stored outside the webroot; served with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`; SVG not accepted                                                                                                                                                                                                        |
| T-08 | **Session theft**                                    | Token captured in transit or borrowed from a shared machine                                             | HTTPS on the LAN with a trusted internal certificate; `HttpOnly`, `SameSite=Strict`, `Secure` when TLS is on; only the token _hash_ is stored, so a database read does not yield usable tokens; session rotated on login and on password change; all sessions revoked on password change                                                                                                                                                                                                      |
| T-09 | **Brute-force login**                                | Scripted password guessing against a known work email                                                   | Argon2id (deliberately slow); per-account incremental delay; temporary lockout after N failures; per-IP rate limit; every attempt logged **without** the password; login response and timing are identical for unknown-email and wrong-password                                                                                                                                                                                                                                               |
| T-10 | **Accidental server shutdown**                       | Someone closes the control panel window and everyone loses access                                       | The window minimises to tray; "Stop server and exit" is a separate action with a warning and an active-session count; a permanent notice about sleep and shutdown; a recommendation of a dedicated host with sleep disabled and a UPS                                                                                                                                                                                                                                                         |
| T-11 | **Power loss during a write**                        | The building loses power mid-approval                                                                   | WAL journal mode; `synchronous = FULL`; every multi-step operation in one transaction so the approval, ledger entry, audit event, and outbox row commit together or not at all; integrity check on startup after an unclean shutdown; nightly verified backups                                                                                                                                                                                                                                |
| T-12 | **Unauthorised payroll access**                      | An HR account is used to pull salary data                                                               | Payroll fields are a separate permission that HR Officer does not hold; payroll export is its own audited permission; every payroll read is audited                                                                                                                                                                                                                                                                                                                                           |
| T-13 | **Privilege escalation via request body**            | A crafted request includes `"role": "admin"` or `"scope": "company"`                                    | Zod schemas use strict object parsing — unknown keys are rejected, not stripped silently; role and scope are never accepted from a client under any circumstance; the attempt is audited                                                                                                                                                                                                                                                                                                      |
| T-14 | **Malicious or compromised dependency**              | A transitive package exfiltrates data                                                                   | Lockfile committed; `pnpm audit` and a licence report in CI and as a release gate; no telemetry; a strict CSP means an injected script has no permitted destination; the server makes no outbound connections at all unless email is explicitly enabled                                                                                                                                                                                                                                       |
| T-15 | **XSS / CSRF**                                       | Injected script or a cross-site form post                                                               | React escapes by default and `dangerouslySetInnerHTML` is banned by lint rule; strict CSP with no `unsafe-inline` and no `unsafe-eval`; `SameSite=Strict` plus a double-submit CSRF token on every non-GET request                                                                                                                                                                                                                                                                            |
| T-16 | **Physical access to the host**                      | Someone sits at the office PC                                                                           | Windows account required; the data folder has restrictive ACLs; full-disk encryption (BitLocker) recommended and documented; the control panel does not display employee data                                                                                                                                                                                                                                                                                                                 |
| T-17 | **Insider tampering with history**                   | Someone edits the audit log or a balance to cover a mistake                                             | `audit_event` and `balance_ledger` are append-only, enforced by triggers that raise on `UPDATE` and `DELETE`; corrections are reversing entries with a reason; nobody, including System Administrator, has a UI path to delete either                                                                                                                                                                                                                                                         |
| T-18 | **Internet exposure**                                | Port forwarding "so people can apply from home"                                                         | The server binds to the configured LAN interface only; the documentation states that public exposure is unsupported pending a security review, and explains the specific risks rather than just forbidding it                                                                                                                                                                                                                                                                                 |
| T-19 | **Admin self-approval abuse**                        | The single Admin approves their own leave repeatedly, or approves leave they are not entitled to        | Accepted by company decision (D-08) and made visible rather than prevented: a separate permission, a distinct audit action, a visible label on the record, a standing self-approval report, and preferential routing to a second Admin where one exists. **Recommendation on record: create two Admin accounts.** Tracked as DW-32                                                                                                                                                            |
| T-20 | **Approval by email interception**                   | Someone with access to an HR mailbox — forwarded mail, a shared screen, a synced phone — approves leave | **Email links carry no authority.** They are plain redirect targets; sign-in is always required before any approval action. There is no one-click approve, no signed action token, and no magic link. See [ADR 0010](adr/0010-email-deep-links.md)                                                                                                                                                                                                                                            |
| T-21 | **Mailbox credential theft**                         | The configured SMTP password is read from config, logs, or a support bundle                             | Stored via Windows DPAPI scoped to machine and service account; never in `config.json`, the repository, logs, or the support bundle; redacted by the logger serialiser. Compromise yields the ability to send mail, not to approve anything (T-20)                                                                                                                                                                                                                                            |
| T-22 | **Leaked information in notification email**         | A leave request's medical context sits in an inbox outside company control                              | Email body is minimal by design — requester, leave type, dates, working days, link. No reason text, no attachments, no balances, nothing medical                                                                                                                                                                                                                                                                                                                                              |
| T-23 | **Credential distribution during bulk provisioning** | A file of usernames and passwords circulates by email or USB and is kept afterwards                     | No such file is produced. Bulk provisioning generates strong temporary passwords, stores only Argon2id hashes, marks accounts for forced change, and produces a **one-time credential sheet** that is viewable once, never re-retrievable, and audited on generation (D-15, DW-33)                                                                                                                                                                                                            |
| T-24 | **Attendance inference causing real-world harm**     | The system infers absence from a missing login; an employee loses pay for a day they worked             | **v1 makes no such inference.** Login data is stored as a positive signal only; absence is never derived from its absence. The inference layer is blocked on company rules (D-11, DW-31, [ADR 0011](adr/0011-login-derived-attendance.md))                                                                                                                                                                                                                                                    |

---

## 2. Authentication

**Passwords** — Argon2id. Starting parameters: `memoryCost` 19 MiB (19456 KiB), `timeCost` 2,
`parallelism` 1 — the OWASP-recommended minimum configuration — calibrated on the actual
host at build time to a target of 250–500 ms per hash, and recorded in an ADR with the
measured figure. Per-password random salt (handled by the Argon2 encoding). The parameters
are stored alongside the hash so they can be raised later and existing passwords rehashed
transparently on next successful login.

**Password policy** — minimum 12 characters, checked against a bundled list of common
passwords, no composition rules (they produce `Password1!` and nothing else). Reuse of the
last 5 passwords blocked. No forced periodic expiry.

**Temporary passwords** — administrator reset generates a random temporary password shown
once, marks `must_change_password`, and expires in 24 hours. The user cannot reach any page
other than the change-password screen until it is changed.

**Bulk provisioning (D-15)** — HR imports a spreadsheet of employees; the system generates a
strong random temporary password per person, stores only the Argon2id hash, and marks each
for forced change. A **one-time credential sheet** is produced for distribution: viewable and
printable once, never re-retrievable afterwards, and its generation is audited. Existing
accounts are skipped rather than overwritten, so the import is idempotent. No file containing
live passwords is ever created — see T-23 and DW-33 for why the requested SQL-file approach
was replaced with this.

**Sessions** — opaque 256-bit random tokens from a CSPRNG. Only `SHA-256(token)` is stored.
Cookie: `HttpOnly`, `SameSite=Strict`, `Secure` when TLS is active, `Path=/`, no `Domain`
attribute. **No token in `localStorage`, ever.** Absolute lifetime 8 hours, idle timeout
2 hours. Rotated on login and on password change; all other sessions revoked on password
change. The user can list and revoke their own sessions; an administrator can revoke anyone's.

**CSRF** — `SameSite=Strict` is the primary control. A double-submit token accompanies it:
a random value in a readable cookie plus a matching `X-CSRF-Token` header on every
state-changing request, compared with a constant-time comparison.

**Lockout** — 5 consecutive failures locks the account for 15 minutes, with an incremental
delay before that (250ms, 500ms, 1s, 2s). Locking is per account _and_ per IP, so an
attacker cannot lock out the whole company by failing logins against every address. The
lockout message does not confirm whether the account exists.

---

## 3. Transport

LAN HTTPS via a fixed hostname (e.g. `leave.sns.local`) and a certificate trusted by every
client. Two supported paths:

1. **Internal CA generated at first run** — a root certificate created once, kept offline
   and access-controlled, issuing a server certificate valid for 398 days. The root is
   installed into the Trusted Root store on each client machine.
2. **An existing company CA** — preferred where one exists, because distribution is already
   solved.

Documented for both: creation, distribution, per-client installation with verification,
renewal with a reminder before expiry, and how to confirm the padlock is genuine.

**Operators are never told to click through a certificate warning.** A warning means the
setup is wrong, and the troubleshooting guide treats it as a defect with a specific cause,
not an inconvenience.

TLS 1.2 minimum, TLS 1.3 preferred. HSTS is **not** set — on a LAN hostname with a private
CA, HSTS makes recovery from a certificate mistake considerably worse.

---

## 4. Headers and CSP

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self';
  img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none';
  frame-ancestors 'none'; base-uri 'none'; form-action 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: geolocation=(), camera=(), microphone=(), interest-cohort=()
Cache-Control: no-store            (on authenticated responses)
```

No `unsafe-inline` for scripts or styles — which is precisely why the prototype's inline
styling cannot be carried over (PROTOTYPE-AUDIT P-04). The Electron renderer gets an
equally strict policy of its own, plus `sandbox: true`, `contextIsolation: true`,
`nodeIntegration: false`, and a preload that exposes an explicit command allowlist rather
than a generic IPC bridge.

---

## 5. Logging

**Logged:** timestamp, level, request id, route, status, duration, actor user id (not name),
outcome. Authentication successes and failures. Every authorisation denial. Every
administrative action.

**Never logged:** passwords or any fragment of one, session tokens or their hashes, CSRF
tokens, attachment contents, medical text, payroll values, personal contact details, full
request bodies for auth routes. Redaction is applied by a serialiser at the logger level so
it cannot be forgotten at a call site.

Logs rotate by size and age, live in the data folder under restrictive ACLs, and are
readable only through the control panel or by an operator with file access. The support
bundle carries logs with secrets redacted and no employee data.

---

## 6. Windows hardening

- Data folder `%PROGRAMDATA%\SimonAndSons\LeaveOS\`: full control for SYSTEM and the
  Administrators group, read/write for the dedicated service account, **no access for
  Users**. ACLs applied at first run and re-verified by the health check, which reports
  `degraded` if they drift.
- Windows Firewall: one inbound rule for the chosen port, scoped to the local subnet.
  Created by the installer with the operator's explicit consent, and shown before it is applied.
- BitLocker recommended for the host, with the trade-offs explained.
- The certificate passphrase and any SMTP password are stored via DPAPI, scoped to the
  machine and the service account. Never in `config.json`, never in the repository.
- No telemetry. The server makes no outbound network connection unless email is explicitly
  enabled by an administrator.

---

## 7. Backups

- SQLite's **online backup API** (`VACUUM INTO` / the backup interface) against the live
  database. **Never** a file copy of an active database — with WAL that produces a corrupt
  or stale artefact, and this failure is silent until the day it matters.
- Every backup is verified: open the copy, `PRAGMA integrity_check`, confirm the schema
  version, count key tables. A backup that fails verification is recorded as **failed** and
  raises the control panel to `degraded`. An unverified backup is not counted as a backup.
- Automatic before every migration.
- Retention 7 daily / 4 weekly / 12 monthly (D-20).
- Off-machine copy is encrypted, and the procedure is documented.
- **A restore drill is a release gate and a quarterly runbook item.** A backup nobody has
  restored is a hypothesis.

---

## 8. Incident response

1. **Contain** — control panel → Stop server. Everyone is offline; that is the correct
   first move for a suspected compromise.
2. **Preserve** — export a support bundle, copy the current logs and database _before_
   changing anything.
3. **Revoke** — restart, revoke all sessions, force password change for affected accounts.
4. **Assess** — the audit log is the primary source. Query by actor and by entity.
5. **Recover** — restore from a verified backup if integrity is in doubt. Record the
   restore point and what was lost between it and the incident.
6. **Record** — what happened, what was accessed, what was changed, what was fixed.

Named owner required: the person who runs this is the same person who owns backups (D-20).

---

## 9. Known risks accepted for this release

Stated plainly rather than buried.

| Risk                                                                        | Why accepted                                                                               | Mitigation                                                                                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Single machine, single point of failure**                                 | 50 employees; high availability is not proportionate                                       | UPS, verified daily backups, documented recovery time, honest documentation about what an outage means                                               |
| **Self-signed internal CA**                                                 | No public DNS, no public CA option on a `.local` hostname                                  | Documented trust installation and verification; an existing company CA is preferred if one exists                                                    |
| **Unsigned installer** (D-19)                                               | No code-signing certificate assumed available                                              | SmartScreen behaviour documented honestly; SHA-256 checksums published; buying an OV certificate is recommended                                      |
| **No SSO** (D-15)                                                           | No directory assumed                                                                       | Strong password policy, lockout, session control                                                                                                     |
| **Local disk backups by default**                                           | Off-machine copies need a company decision (D-20)                                          | Off-machine procedure documented; the health check flags a stale backup as `degraded`                                                                |
| **Email depends on an external mailbox provider** (D-13)                    | The company has no SMTP server; a configured mailbox is the pragmatic path                 | Best-effort by design: queued, retried, dead-lettered. In-app notifications are primary and unaffected. The system is fully usable with email broken |
| **Admin self-approval** (D-08)                                              | Required by the company; a single-Admin company otherwise cannot take leave                | Separate permission, distinct audit action, visible label, standing report, second-Admin routing preferred. See T-19, DW-32                          |
| **Login-derived attendance is incomplete** (D-11)                           | A login is not proof of presence, and the rules for interpreting it have not been supplied | Stored as a signal only; no absence inference in v1. See T-24, DW-31                                                                                 |
| **Hostname, firewall, and certificate approach not finalised** (D-17, D-18) | The responsible network person has not been identified and the CA situation is unknown     | The wizard defers all three, supports both certificate paths, and never asks anyone to bypass a warning. DW-12, DW-13                                |
| **No rate limiting between LAN clients beyond auth routes**                 | A hostile LAN is a different threat model than the one assumed                             | Documented; revisit if the network becomes untrusted                                                                                                 |
