# Office Security, Workstation Binding, and Hierarchy Leave Specification

This document details the architectural rules, security boundaries, and hierarchical workflow requirements for Simon & Sons Leave OS, addressing:

1. Physical and network perimeters preventing remote login and fake attendance.
2. Workstation-to-employee 1:1 binding preventing unauthorized account switching ("buddy punching").
3. Sudden uninformed leave submission by Team Leads on behalf of absent team members.
4. Hierarchical approval routing and downstream informational notifications for higher-ups.

---

## 1. Network Perimeter & Attendance Fraud Prevention

### 1.1 The Threat Model

Simon & Sons Leave OS derives daily attendance signals from successful employee sign-ins (`attendance_raw` table via ADR 0011). Without network controls, an employee could sit at home, log into the web interface from a personal device or home Wi-Fi, and falsely record active office attendance.

### 1.2 Enforcement Mechanisms

1. **Local LAN Isolation (Office Server Boundary)**:
   - On the primary office deployment, the Leave OS server runs on a dedicated Windows machine connected exclusively to the office Local Area Network (LAN).
   - The server binds to `0.0.0.0:3000` on a private RFC 1918 subnet (`10.x.x.x` or `192.168.x.x`).
   - Without an explicit port-forward on the office gateway router or an active corporate VPN, devices on external residential or cellular networks cannot route packets to the office server.
2. **Subnet & Office Gateway Allowlist**:
   - The server inspects the client connecting IP (`req.ip` / `req.socket.remoteAddress`).
   - Attendance signals are created **only** when `isOfficeNetwork(req.ip)` is true.
   - For cloud or hybrid deployments (e.g. Vercel hosted preview), the company's verified static public egress IP and office Wi-Fi subnets are whitelisted in `app_setting`.
   - Any login from outside the verified office perimeter either:
     - Rejects authentication with `403 FORBIDDEN: Access restricted to office network`, OR
     - Allows portal view of records but logs the attendance signal as `ATTENDANCE_OFFSITE_IGNORED` so no fraudulent working hours are credited.

---

## 2. Workstation-to-Employee 1:1 Device Binding

### 2.1 The Threat Model

An employee in the office could attempt to log into a coworker's account from their own computer (or log in on a coworker's unattended computer) to submit leave or fake attendance on their behalf ("buddy punching").

### 2.2 Enforcement Mechanism

1. **Workstation Hardware Token / Device Identity**:
   - Each office computer is assigned an immutable cryptographic device token (`workstation_device_id`) generated via browser `crypto.subtle` and persisted in the local browser vault / WebAuthn container.
2. **Strict 1:1 Employee Binding (`employee_workstation`)**:
   - A database mapping `employee_id <-> workstation_device_id` pairs each employee to their designated office computer.
   - **On Login**:
     - The client sends the device token in a secure header `X-Workstation-Id`.
     - If the workstation is bound to Employee A and Employee B attempts to log in, the server immediately aborts the session:
       ```
       DEVICE_MISMATCH (403): This workstation is bound to Employee [A].
       Cross-account logins are prohibited on office workstations.
       ```
     - If an employee attempts to log in from a new, unrecognized device (e.g. personal mobile phone or unassigned PC), the system blocks the session until an HR Officer or IT Administrator authorizes the new workstation binding.
3. **Audit Trail**:
   - Any device mismatch attempt is logged to `audit_event` with action `auth.workstation_violation`, capturing actor, attempted identity, IP address, and workstation fingerprint.

---

## 3. Team Lead "On-Behalf-Of" Sudden Leave Submission

### 3.1 The Business Need

Employees sometimes take sudden, unplanned leave (medical emergency, sudden sickness, bereavement, or sudden transit failure) and are unable to log into the office system before the workday starts. In such cases, the employee typically informs their Team Lead via phone or message. The Team Lead must be able to record the leave in Leave OS so team availability, calendar coverage, and attendance reconciliation stay accurate.

### 3.2 Workflow & Permissions

1. **Role Scope Expansion**:
   - Update `packages/domain/src/authz/permissions.ts` to include `'leave.request.create:reports_recursive'` and `'leave.request.create:team'`.
   - Update `packages/domain/src/authz/roles.ts` so `manager` holds `leave.request.create:team` and `leave.request.create:reports_recursive`.
2. **User Interface (`apps/web/src/pages/Apply.tsx`)**:
   - If the logged-in user is a Team Lead, Department Head, or HR Administrator:
     - An **Applicant Selector** appears at the top of the Apply form:
       - `[ Apply for Myself ]` (default)
       - `[ Apply on behalf of Team Member ▾ ]`
     - Selecting a team member populates that employee's available leave types, current period balances, and calendar working-day calculations.
     - The submitter enters the reason and notes the communication (e.g., _"Informed via phone at 8:30 AM due to acute illness"_).
3. **Database & Audit Attribution**:
   - `leave_request` stores:
     - `employee_id`: The absent employee (recipient of the leave).
     - `submitted_by`: The user ID of the Team Lead who entered it.
     - `submission_channel`: `'on_behalf_of'`.
   - An immutable audit entry `leave.request.submitted_on_behalf` is recorded with both actor and target employee.
   - The absent employee receives an automated notification:
     > _"Leave submitted on your behalf: [Team Lead Name] recorded [Leave Type] for [Dates]."_

---

## 4. Hierarchical Routing & Higher-Up Notifications

### 4.1 Hierarchy Ladder (Established & Preserved)

Per ADR 0012 and `packages/domain/src/leave/routing.ts`, approval routes strictly along the organisation hierarchy:

1. **Team Member** -> **Team Lead**
2. **Team Lead** -> **Department Head**
3. **Department Head** -> **HR Officer**
4. **HR Officer** -> **Administrator**
5. **Administrator** -> **Administrator** (with mandatory self-approval audit flag)

A rung is **only escalated** if the designated approver is unavailable:

- Position is vacant / unassigned (`no_team_lead`, `no_department_head`).
- Approver is the requester themselves (`approver_is_requester`).
- Approver account is disabled (`approver_disabled`).
- Approver is currently away on approved leave (`approver_on_leave`).
- SLA elapsed (`sla_elapsed`).

Routine leave decisions are made at the lowest competent rung and do **not** require routine HR approval.

### 4.2 Downstream Notification Rules

The company requires that higher-ups stay informed of approved leave without being spammed by denied/rejected requests:

1. **When a Request is Approved (`decision === 'approve'`)**:
   - **Requester Notification**: The employee receives an in-app notification confirming their leave is approved.
   - **Higher-Up Informational Notifications**:
     - **If approved by a Team Lead**:
       - The **Department Head** receives an informational notification.
       - Active **HR Officers** receive an informational notification.
     - **If approved by a Department Head**:
       - Active **HR Officers** and **Administrators** receive an informational notification.
     - **If approved by HR**:
       - Active **Administrators** receive an informational notification.
   - **Notification Content**:
     - Type: `leave.approved.informational`
     - Title: `Leave Approved: [Employee Name] ([Department])`
     - Body: `[Approver Name] ([Approver Role/Title]) approved [Leave Type] for [Employee Name] from [Start Date] to [End Date] ([X] days).`
     - Entity: `leave_request`, ID: `[Request ID]`

2. **When a Request is Denied / Rejected (`decision === 'reject'`)**:
   - **Requester Only**: The employee receives an in-app notification explaining that their leave was rejected and displaying the rejection reason.
   - **Higher-Ups Sparing Rule**: **No notification is sent to Department Heads, HR Officers, or Administrators.** Routine denied requests remain local between the lead and employee, avoiding management notification overload.

---

## 5. Security & Verification Checklist

- [ ] Unauthenticated / offsite network requests cannot generate valid attendance records.
- [ ] Office workstation device binding prevents cross-account logins on shared/assigned terminals.
- [ ] Team Lead can submit leave on behalf of absent direct reports with clear audit attribution.
- [ ] Hierarchical routing preserves: Member -> Lead -> Head -> HR -> Admin.
- [ ] Approved leave dispatches informational notifications to higher-ups (Dept Head, HR).
- [ ] Rejected leave never spams notifications to higher-ups.
