# Roles, permissions, and scope

Planning document.

**The two rules everything else follows from:**

1. **Default deny.** Nothing is permitted unless a permission explicitly grants it.
2. **Roles come from the authenticated account.** There is no role selector on the login
   form. (The prototype had one — see PROTOTYPE-AUDIT P-01.)

---

## 1. Permission grammar

```
<resource>.<action>:<scope>
```

Examples: `leave.request.create:self` · `leave.request.approve:direct_reports` ·
`employee.read:department` · `payroll.export:company` · `system.backup.create:company`

### Scopes, narrowest to widest

| Scope               | Resolves to                                                         |
| ------------------- | ------------------------------------------------------------------- |
| `self`              | Only records whose subject is the acting user's own employee record |
| `direct_reports`    | Employees whose `manager_employee_id` is the actor                  |
| `reports_recursive` | The actor's full reporting subtree, to any depth                    |
| `team`              | Employees in the actor's team                                       |
| `department`        | Employees in the actor's department                                 |
| `location`          | Employees at the actor's location                                   |
| `company`           | All employees                                                       |

A permission check receives the **principal** and the **target record**, and asks: does any
granted permission for this resource and action have a scope that contains this target?
Scopes are computed server-side from the employee graph. A client never sends a scope.

`self` is additive: a manager with `leave.request.read:direct_reports` also holds
`leave.request.read:self` and can see their own requests.

### Field-level authorisation

Scope answers _which rows_. Some columns need a separate answer.

| Classification    | Guarded by                             | Applies to                                                    |
| ----------------- | -------------------------------------- | ------------------------------------------------------------- |
| `payroll`         | `employee.field.payroll.read:<scope>`  | salary, CTC, bank details, payroll export columns             |
| `medical`         | `attachment.medical.read:<scope>`      | sick-leave certificates and any attachment classified medical |
| `identity`        | `employee.field.identity.read:<scope>` | national ID, passport, date of birth                          |
| `contact_private` | `employee.field.contact.read:<scope>`  | personal email, personal phone, home address                  |

A manager can see that a report took sick leave. A manager **cannot** open the medical
certificate unless separately granted. This separation is deliberate and is tested.

---

## 2. Default roles

| Role                     | Intent                                                               | Notably does **not** have                                                                                      |
| ------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Employee**             | Their own record, their own leave, the shared calendar               | Anyone else's balances or contact details                                                                      |
| **Manager**              | Employee, plus **visibility** for their reporting subtree            | **Leave approval** (see below), company-wide reports, payroll fields, medical attachments, user administration |
| **HR Officer**           | People and leave administration company-wide, **and leave approval** | **Backup, restore, configuration, user impersonation, audit deletion** — see §5                                |
| **Payroll Officer**      | Payroll-relevant fields and exports                                  | Approval rights, leave configuration, employee editing                                                         |
| **System Administrator** | Accounts, roles, system operations, backups, configuration           | Nothing structurally, which is why it is separate and rare — and every action is audited                       |
| **Read-only Auditor**    | Read everything relevant to compliance, write nothing                | Any mutation whatsoever, including approvals                                                                   |

Roles are editable data, not code. A company can create "HR Manager (Bangalore)" as HR
Officer permissions at `location` scope instead of `company`.

### Who approves leave (D-08/D-09)

| Requester  | Approver                        | Fallback      |
| ---------- | ------------------------------- | ------------- |
| Employee   | **HR Officer**                  | Admin         |
| Manager    | **HR Officer**                  | Admin         |
| HR Officer | **Admin**                       | Another Admin |
| Admin      | **Admin, including themselves** | —             |

**Managers do not approve leave.** This is the company's decision, not an oversight. The
Manager role exists here for team visibility, availability planning, and overlap awareness.
The workflow engine supports manager approval and it is one settings change away if the
company later wants it (DW-36).

Escalation to Admin is automatic when no active HR account exists, when every HR account is
disabled, when the assigned HR approver is on approved leave covering the decision date, or
when a configurable SLA elapses without a decision.

**Admin self-approval** is permitted and is deliberately not disguised as an ordinary
approval: it is available only to `admin`, labelled as a self-approval on the request and in
the UI, written with a distinct `leave.self_approved` audit action, and listed in a standing
self-approval report. Where a second Admin exists, requests route to them first. See
[ADR 0009](adr/0009-approval-routing.md) and DW-32.

---

## 3. Permission matrix

`✓` granted · `—` not granted · scope shown where narrower than `company`

| Permission                      | Employee | Manager             | HR Officer          | Payroll | SysAdmin | Auditor |
| ------------------------------- | -------- | ------------------- | ------------------- | ------- | -------- | ------- |
| `employee.read`                 | `self`   | `reports_recursive` | ✓                   | ✓       | ✓        | ✓       |
| `employee.create`               | —        | —                   | ✓                   | —       | —        | —       |
| `employee.update`               | `self`¹  | —                   | ✓                   | —       | —        | —       |
| `employee.archive`              | —        | —                   | ✓                   | —       | —        | —       |
| `employee.field.payroll.read`   | `self`   | —                   | —                   | ✓       | —        | ✓       |
| `employee.field.payroll.update` | —        | —                   | —                   | ✓       | —        | —       |
| `employee.field.identity.read`  | `self`   | —                   | ✓                   | —       | —        | ✓       |
| `employee.field.contact.read`   | `self`   | `direct_reports`²   | ✓                   | —       | —        | ✓       |
| `org.structure.read`            | ✓        | ✓                   | ✓                   | ✓       | ✓        | ✓       |
| `org.structure.manage`          | —        | —                   | ✓                   | —       | ✓        | —       |
| `leave.request.create`          | `self`   | `self`              | `self` + on-behalf³ | `self`  | `self`   | —       |
| `leave.request.read`            | `self`   | `reports_recursive` | ✓                   | —       | ✓        | ✓       |
| `leave.request.approve`         | —        | **—**⁴              | ✓                   | —       | ✓        | —       |
| `leave.request.reject`          | —        | **—**⁴              | ✓                   | —       | ✓        | —       |
| `leave.request.self_approve`    | —        | —                   | —                   | —       | ✓⁹       | —       |
| `leave.request.withdraw`        | `self`   | `self`              | `self`              | `self`  | `self`   | —       |
| `leave.request.cancel`          | —        | —                   | ✓                   | —       | —        | —       |
| `leave.balance.read`            | `self`   | `direct_reports`    | ✓                   | ✓       | —        | ✓       |
| `leave.balance.adjust`          | —        | —                   | ✓⁵                  | —       | —        | —       |
| `leave.policy.read`             | ✓        | ✓                   | ✓                   | ✓       | ✓        | ✓       |
| `leave.policy.manage`           | —        | —                   | ✓                   | —       | —        | —       |
| `holiday.calendar.read`         | ✓        | ✓                   | ✓                   | ✓       | ✓        | ✓       |
| `holiday.calendar.manage`       | —        | —                   | ✓                   | —       | —        | —       |
| `approval.workflow.manage`      | —        | —                   | ✓                   | —       | ✓        | —       |
| `team.availability.read`        | `team`   | `reports_recursive` | ✓                   | —       | —        | ✓       |
| `attachment.upload`             | `self`   | `self`              | ✓                   | —       | —        | —       |
| `attachment.read`               | `self`   | `direct_reports`⁶   | ✓                   | —       | —        | ✓       |
| `attachment.medical.read`       | `self`   | —                   | ✓                   | —       | —        | ✓       |
| `attendance.import`             | —        | —                   | ✓                   | —       | ✓        | —       |
| `attendance.read`               | `self`   | `direct_reports`    | ✓                   | ✓       | —        | ✓       |
| `attendance.correct`            | —        | `direct_reports`⁷   | ✓                   | —       | —        | —       |
| `report.leave.view`             | —        | `reports_recursive` | ✓                   | ✓       | —        | ✓       |
| `report.export`                 | —        | `reports_recursive` | ✓                   | ✓       | —        | ✓       |
| `payroll.export`                | —        | —                   | —                   | ✓       | —        | ✓       |
| `notification.read`             | `self`   | `self`              | `self`              | `self`  | `self`   | `self`  |
| `audit.read`                    | —        | —                   | ✓⁸                  | —       | ✓        | ✓       |
| `user.account.read`             | `self`   | —                   | ✓⁸                  | —       | ✓        | ✓       |
| `user.account.create`           | —        | —                   | ✓¹⁰                 | —       | ✓        | —       |
| `user.account.disable`          | —        | —                   | ✓¹⁰                 | —       | ✓        | —       |
| `user.password.reset`           | —        | —                   | ✓¹⁰                 | —       | ✓        | —       |
| `user.session.revoke`           | `self`   | —                   | ✓¹⁰                 | —       | ✓        | —       |
| `role.assign`                   | —        | —                   | ✓¹⁰                 | —       | ✓        | —       |
| `system.config.manage`          | —        | —                   | —                   | —       | ✓        | —       |
| `system.backup.create`          | —        | —                   | —                   | —       | ✓        | —       |
| `system.backup.restore`         | —        | —                   | —                   | —       | ✓        | —       |
| `system.health.read`            | —        | —                   | —                   | —       | ✓        | ✓       |
| `system.logs.read`              | —        | —                   | —                   | —       | ✓        | ✓       |
| `data.export.full`              | —        | —                   | —                   | —       | ✓        | —       |
| `import.run`                    | —        | —                   | ✓                   | —       | ✓        | —       |

**Footnotes**

1. Employees may update their own contact and emergency-contact details only. Not their
   department, manager, joining date, or status. The write is field-restricted and audited.
2. Work contact details. Personal email, phone, and address remain HR-only.
3. HR may create a request on behalf of an employee. The record permanently stores both the
   subject and the actor; it never looks like the employee submitted it.
4. **Managers do not approve leave** (D-08). HR approves employee and manager requests; Admin
   approves HR requests and acts as the fallback when HR is unavailable. Denial tests assert
   that a Manager calling the approve endpoint receives 403.
5. A balance adjustment **requires a reason** and writes an `ADJUSTMENT` ledger entry plus an
   audit event. It never edits a number.
6. Non-medical attachments on requests the manager is deciding.
7. A manager may _propose_ a correction; it takes effect on HR approval.
8. HR sees audit events and account records for people-related actions. HR does **not** see
   system administration events, and cannot read security configuration.
9. Admin self-approval (D-08). A separate permission from ordinary approval so it can be
   audited, reported, and withdrawn independently. Applies only to the Admin's own request.
10. HR and administrators manage sign-in accounts from Users & access: create an employee
    with any role, edit the account, or remove it. Removal deactivates the employee and
    disables the sign-in; the record is kept (D-21). Only an administrator can grant or
    remove the administrator role. A manager, payroll officer, auditor, or employee who
    calls these endpoints receives 403.

---

## 4. Enforcement

**Where the check happens.** Inside the use-case, as its first act, with the principal and
the resolved target:

```ts
// illustrative
export async function approveLeaveRequest(
  ctx: RequestContext, // principal, requestId, transaction
  input: ApproveLeaveInput,
) {
  const request = await repo.leaveRequest.byId(input.requestId);
  ctx.authorize('leave.request.approve', { employeeId: request.employeeId });
  // ...state machine, ledger, audit, outbox — all in one transaction
}
```

- Every use-case takes `ctx` as its first argument. A use-case cannot be called without a
  principal, because the type system will not allow it.
- Repositories that return employee-scoped data also accept the principal and apply the
  scope predicate in SQL. Two layers, deliberately — a forgotten use-case check still does
  not leak rows.
- Routes do no authorisation. They validate input, call a use-case, and shape the response.
- The UI hides controls the user cannot use. That is a courtesy, never a control. Every
  hidden control has a corresponding server denial test.

**Denials are audited.** A 403 writes an audit event with actor, permission attempted, and
target. Repeated denials are a signal worth having.

**403 leaks nothing.** "You do not have permission to view this employee" is returned
whether or not that employee exists.

---

## 5. Why HR is not an administrator

HR Officer is the most powerful _people_ role and holds no _system_ power: no backup, no
restore, no configuration, no account creation, no impersonation, no ability to touch the
audit log.

The reason is separation of duties. An HR account is used daily by several people, is the
most likely to be phished, and is the most likely to be shared "just this once". If that
account could also restore a database or create administrator accounts, one compromised HR
session ends the integrity of the entire system. System Administrator is a separate,
rarely-used account with its own credentials and full auditing.

**There is no impersonation feature.** "Log in as this user to see what they see" is the
single most abusable feature in systems like this. If support needs it later, it will be
built as a time-boxed, consent-required, loudly-audited session with a persistent banner —
and it will be its own ADR, not a quiet addition.

---

## 6. Tests this document owes

Named here so they cannot be forgotten. Detail in [TESTING.md](TESTING.md) §4.

- Every cell in §3 marked `—` has a test asserting a 403 from a **direct API call**, not from a hidden button.
- Manager scope: cannot read a peer, cannot read another department, **can** read an indirect report under `reports_recursive`.
- **A Manager calling approve or reject receives 403** (D-08).
- Manager cannot open a medical attachment on a request belonging to a report.
- Payroll Officer cannot approve leave; Manager cannot read a payroll field.
- HR cannot approve their own request; it routes to Admin. An HR user calling approve on their own request receives 403.
- An Admin approving their own request requires `leave.request.self_approve`, is recorded with the `leave.self_approved` audit action, and appears in the self-approval report.
- Escalation to Admin fires under each of the four absence conditions, and not otherwise.
- Auditor receives 403 on every write endpoint in the application, enumerated from the route table.
- HR receives 403 on backup, restore, configuration, and account creation.
- An employee cannot change their own `department_id`, `manager_employee_id`, `joined_on`, or `status`.
- An expired or revoked session receives 401 on every authenticated route.
- Changing a user's role takes effect on the next request, and existing sessions do not retain stale permissions.
- A request body containing a `scope` or `role` field is ignored, and the attempt is audited.
