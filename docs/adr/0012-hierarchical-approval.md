# ADR 0012 — Leave follows the organisation chart

**Status:** Accepted · **Date:** 2026-09-08 · **Supersedes:** [ADR 0009](0009-approval-routing.md)

## Context

ADR 0009 centralised every approval on HR, on the company's instruction at the time
(D-08/D-09). In practice that puts all of a fifty-person company's routine leave on one
or two people, and the company has now asked for the opposite:

> the member leave should go to team lead and get approved, not everything should burden
> the hr or admin in edge cases or in need of escalation it can move to HR, the team lead
> leave should go to HR and so on, the proper hierarchy should be followed

The organisation already has the structure this needs: departments contain teams, teams
have a lead, departments have a head. None of it was being used for routing.

## Decision

Leave is decided by the person directly above the requester in the organisation chart.

| Requester       | Decided by            | Then                                  | Then               |
| --------------- | --------------------- | ------------------------------------- | ------------------ |
| Team member     | **Team lead**         | Department head                       | HR → Administrator |
| Team lead       | **Department head**   | HR                                    | Administrator      |
| Department head | **HR**                | Administrator                         | —                  |
| HR officer      | **Administrator**     | —                                     | —                  |
| Administrator   | Another administrator | Themselves, marked as a self-approval | —                  |

**Position, not role, decides the rung.** A team lead is an ordinary `employee` account
that happens to lead a team. `requesterKindFrom()` reads the org chart; an explicit
`hr_officer` or `admin` role outranks an org position.

**A rung is skipped only for a real gap**, and the reason is stored on the request:

- nobody is appointed to it (`no_team_lead`, `no_department_head`)
- the only candidate is the person asking (`approver_is_requester`)
- their account is disabled (`approver_disabled`)
- they are themselves on approved leave that day (`approver_on_leave`)

**A team lead needs no company-wide permission.** Authority comes from being the assigned
approver on that request. `decideLeave` allows whoever the request was routed to;
`leave.request.approve:company` remains an HR and administrator override. Reading follows
the same rule, so a lead can open the request they are asked to decide, and their
approvals queue is populated by the routing rather than by broad read rights.

**Nobody decides their own request.** A lone administrator remains the single documented
exception, recorded as a self-approval.

## Rationale

Routing on the org chart is what people already expect, and it removes the bottleneck the
company objected to: routine leave is now decided by someone who knows whether the team can
spare the person that week, which HR cannot know for fifty people.

Making authority follow the _assignment_ rather than a role is the part that matters
technically. The alternative — granting team leads `leave.request.approve:company` — would
let any lead approve anybody's leave anywhere in the company. Assignment-based authority
grants exactly the power the hierarchy implies and nothing more.

Escalation reasons are enumerated rather than left to judgement so a request can never sit
unrouted while everyone assumes someone else has it, and so an escalation can be explained
afterwards rather than only noticed at the time.

## Consequences

- HR's load drops to exceptions, escalations, and their own team. This was the point.
- **Appointing leads and heads is now operationally significant.** A team with no lead
  silently escalates to the department head. That is safe, but it undoes the benefit, so
  the org structure needs to be kept current.
- The Manager _role_ is no longer what grants approval; leading a team is. The role remains
  useful for visibility scope.
- More approvers means more people who can see a colleague's leave reason — but only for
  requests routed to them, which is narrower than the previous company-wide HR view.
- If the whole chain is empty the request is refused with a 409 naming the missing rung,
  rather than failing obscurely or inventing an approver.
- The seeded sample organisation now models this: Engineering (head: Sofia) with the
  Platform team (lead: Ravi, member: Amina) and Customer Support, so the chain is visible
  the moment anyone opens the app.

## Alternatives rejected

- **Keeping HR-centred routing** (ADR 0009) — explicitly rejected by the company.
- **Routing on `manager_employee_id`** — a second, parallel hierarchy that has to be kept
  in step with teams and departments. The org chart already expresses it once.
- **Granting team leads company-wide approval** — far more authority than the hierarchy
  implies, and it would let any lead approve anyone.
