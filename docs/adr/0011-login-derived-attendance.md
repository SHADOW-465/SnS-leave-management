# ADR 0011 — Login-derived attendance is a signal, not a verdict

**Status:** Accepted · **Date:** 2026-08-26

## Context

The company specified (D-11):

> Build CSV/XLSX attendance import first, preserving raw imported records and recording
> corrections separately. Do not build a biometric-device integration until the device brand,
> model, API and export format are supplied. employee logs in and attendance is logged for
> that day (this may need finetuning in the future)

The company flagged the finetuning caveat themselves, which is the right instinct.

## Decision

Two attendance sources, both stored as immutable raw records feeding the same
raw-plus-corrections model:

1. **File import** — CSV/XLSX rows preserved verbatim, `source = 'import'`.
2. **Login-derived** — a successful login writes an attendance signal for that date,
   `source = 'login'`, recording the first and last login timestamps and the client address.

**A login signal is evidence of presence, never a verdict about attendance.** Specifically,
in v1:

- A login writes a **positive** signal for that date.
- **The absence of a login writes nothing, and implies nothing.** The system will not report
  someone absent because they did not log in.
- Signals are visible to HR as one input among others, and are correctable through the same
  correction workflow as imported data — corrections stored separately, never overwriting the
  raw signal.
- No hours are computed, no lateness is flagged, no half-day is inferred.

## Rationale

A login proves that an account authenticated. It does not prove a person was at work, and the
gap between the two is wide enough to cause real harm if the system pretends otherwise:

- Someone works all day on the shop floor and never opens a browser — no login.
- Someone logs in from home on a day off to check their balance — a login.
- Someone logs in at 09:00, leaves at 10:00 — a login identical to a full day.
- Shared or borrowed credentials produce a login for the wrong person.

An attendance system that quietly turned "no login" into "absent" would generate payroll and
disciplinary consequences from an artefact of how people use software. That is not a bug that
gets caught in testing; it gets caught by an employee losing a day's pay.

Storing it as a signal keeps the data — which is genuinely useful, and free to collect — while
refusing the inference that is not yet safe to make. When the company supplies its rules
(expected hours, remote-work policy, half-day thresholds, what a missing login should mean),
the inference layer sits on top of data already collected, with no migration and no
backfill gap.

Using the same raw-plus-corrections model as file import means one mental model, one
correction workflow, one audit path, and one place where the effective value is derived.

## Consequences

- The login handler writes an attendance signal inside the login transaction. It must never
  be able to fail a login — a signal-write failure is logged and swallowed, because being
  unable to record attendance is not a reason to lock someone out of the system.
- Attendance reporting in v1 shows signals and imported records, and is explicit that it is
  not a completeness measure. The UI says so where it could otherwise mislead.
- Duplicate logins on one date update first/last timestamps rather than creating rows.
- Tracked as DW-31, with the inference layer blocked on company rules.
- Privacy: login times are behaviour data. They are visible to HR and to the employee
  themselves, subject to normal RBAC scope, and are covered by the retention classifications
  from D-21.

## Alternatives rejected

- **Treat a login as a full day of attendance** — wrong on its face, and wrong in a direction
  that costs people money.
- **Treat a missing login as absence** — the same error with worse consequences.
- **Wait for the biometric device before building any attendance** — discards data that is
  free to collect now, and the device is blocked on information the company does not have (DW-09).
- **A separate schema for login attendance** — two models, two correction workflows, two
  places to reconcile.
