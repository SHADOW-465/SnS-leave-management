# ADR 0009 — HR-centred approval routing, with Admin fallback and Admin self-approval

**Status:** SUPERSEDED by [ADR 0012](0012-hierarchical-approval.md) on 2026-09-08 · **Date:** 2026-08-26

> The company reversed this decision: leave now follows the organisation chart (team lead →
> department head → HR → administrator) so routine approvals no longer land on HR. The
> escalation machinery and the admin self-approval rule described below survive in ADR 0012;
> the HR-centred routing does not.

## Context

The company specified the approval chain directly (D-08/D-09):

> the employee leave is approved by HR and in absence of HR admin does it, HR leave is
> approved by admin and admin leave is also approved by admin

This is centralised on HR rather than on the reporting manager, which is the arrangement the
plan had assumed.

## Decision

| Requester  | Approver                    | Fallback      |
| ---------- | --------------------------- | ------------- |
| Employee   | HR Officer                  | Admin         |
| Manager    | HR Officer                  | Admin         |
| HR Officer | Admin                       | Another Admin |
| Admin      | Admin, including themselves | —             |

The **Manager** role no longer approves leave. It retains team visibility, availability, and
overlap awareness.

This routing is expressed as **configuration of the multi-step workflow engine**, not as
hard-coded branching. The engine described in ARCHITECTURE §7 is still built; this is one
configuration of it.

**"In the absence of HR"** is defined concretely, as four configurable conditions rather than
a human judgement call. A request escalates to Admin when:

1. no active HR account exists, or
2. every HR account is disabled, or
3. the assigned HR approver is on approved leave covering the decision date, or
4. a configurable SLA elapses with no decision.

**Admin self-approval** is permitted, and is treated as a distinct act:

- allowed only for the `admin` role, and never available to any other role;
- labelled as a self-approval in the UI and stored as such on the request;
- written with a distinct audit action, `leave.self_approved`, not the ordinary approval action;
- surfaced in a standing report of self-approvals;
- preferentially routed to a _different_ Admin when one exists, with self-approval as the
  fallback rather than the default path.

## Rationale

Centralising on HR fits a 50-person company where HR has full visibility and managers are
often working members of small teams. It also removes an entire class of scope bugs, since
approver resolution no longer depends on the reporting graph being correct.

Building it as workflow configuration rather than hard-coded logic costs almost nothing now
and means "manager approves first, then HR confirms" is later a settings change. Given that
this company is moving off Excel and its processes will move once people see the system,
that flexibility will be wanted.

Defining "absence of HR" as four machine-checkable conditions matters because the alternative
is a request sitting unapproved while everyone assumes someone else has it. The SLA condition
in particular is what stops leave from silently expiring in a queue.

## Consequences

- **Admin self-approval is a genuine separation-of-duties gap.** It is accepted because the
  company requires it, and it is made visible rather than hidden. Recommendation on record:
  create two Admin accounts so self-approval is a last resort, not routine. Tracked as DW-32.
- The security claim "an employee can never be their own approver" no longer holds
  universally. SECURITY T-01 is amended to state the exception explicitly rather than let it
  sit as an unnoticed falsehood.
- HR becomes an availability bottleneck. Mitigated by the Admin fallback and the SLA
  escalation.
- The RBAC matrix changes: `leave.request.approve` moves from Manager to HR Officer and
  Admin. Manager keeps `leave.request.read:reports_recursive` and
  `team.availability.read:reports_recursive`.
- Denial tests now assert that a **Manager cannot approve**, which is the inverse of what the
  original plan would have tested.

## Alternatives rejected

- **Manager approves, HR confirms** — not what the company asked for. Available as
  configuration if they change their mind (DW-36).
- **Forbidding Admin self-approval** — would leave an Admin unable to take leave in a
  single-Admin company. Rejected as unworkable.
- **A separate "leave approver" role** — an extra concept for a company that already has
  clear ideas about who approves what.
