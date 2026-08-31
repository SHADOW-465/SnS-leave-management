# ADR 0010 — Email notifications with authority-free deep links

**Status:** Accepted · **Date:** 2026-08-26 · **Amends:** ADR 0008

## Context

The company specified (D-13):

> No SMTP server. A simple email through the configured email should be sent to the HR or
> admin from the app so that they can be notified of any requests from the employees, and in
> that email there should be a redirect link to their login that allows to go to approve that
> or decline that. Also in-app notifications are also main, email is for safety not to miss
> any requests.

This moves email from "optional adapter, off by default" into Phase 1.

## Decision

**Transport.** Email is sent through a **configured mailbox account** — an SMTP account such
as a company Google Workspace or Microsoft 365 mailbox — not a self-hosted mail server. Host,
port, and username live in configuration; the password is stored via Windows DPAPI, scoped to
the machine and service account. Never in `config.json`, never in the repository.

**The link carries no authority.** The email contains an ordinary HTTPS link to the request
page, for example `https://<host>/requests/01J7X…`. Clicking it while not signed in lands on
the login screen; after authenticating, the user arrives at that request with the approve and
decline actions available if — and only if — their permissions allow it.

There is **no token in the email that grants any capability.** No one-click approve, no
magic link, no signed action URL.

**In-app notifications remain primary.** Both the in-app notification and the outbox row are
written in the same transaction as the business change. Email is drained separately, retried
with backoff, and dead-lettered after N attempts. If the mail provider is unreachable — no
internet, wrong password, throttling — the request, the notification, the approval, and every
other function are completely unaffected. Failed sends are visible to Admin, and an
accumulating dead-letter count raises the control panel to `degraded`.

**Content is minimal.** Requester name, leave type, dates, working days, and the link. No
reason text, no attachment, no medical detail, no balance figures — email leaves the building
and lands in an inbox we do not control.

## Rationale

**Why no one-click approval from the email.** It is the obvious convenience and it is an
approval mechanism with no authentication sitting in an inbox. Emails get forwarded,
auto-forwarded to personal accounts, synced to phones, read on shared screens, and left in
archives for years. Anyone holding the message could approve leave as the recipient, and the
audit log would record the legitimate approver. A redirect to login costs one extra click and
removes the entire class of problem.

**Why a mailbox account rather than a mail server.** The company has no SMTP server and
should not be asked to run one. An existing mailbox works immediately, and this is a
notification path, not bulk mail.

**Why email must never be required.** The system is local-first and must work with no
internet. Email depends on an external provider, which makes it the least reliable component
in the system. Treating it as best-effort — exactly as the company framed it, "for safety not
to miss any requests" — is what keeps that unreliability contained.

**Why minimal content.** A leave request can contain medical context. Email is not a
confidential channel; the link is.

## Consequences

- Delivery is asynchronous, up to about a minute. Stated in the UI.
- Outbox depth and dead-letter count become health-check inputs.
- The SMTP password is a secret to manage, rotate, and keep out of logs and support bundles.
- Sending requires outbound network access from the host — the only outbound connection the
  server ever makes, and only when email is enabled.
- Mail providers may throttle or require an app-specific password; setup documentation covers
  Google Workspace and Microsoft 365 specifically.
- The email preview screen from the prototype is kept: an Admin can see exactly what the
  system sends before enabling it.

## Alternatives rejected

- **One-click approve/decline links with a signed token** — convenient, and an unauthenticated
  approval mechanism living in an inbox.
- **Email as the primary notification channel** — makes an external provider a dependency of
  a local-first system.
- **A local SMTP relay** — another service for an operator to install, run, and understand.
- **Full request detail in the email body** — leaks potentially medical information into an
  uncontrolled channel.
