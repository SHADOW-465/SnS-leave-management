import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '../node_modules/.pnpm/@electric-sql+pglite@0.5.8/node_modules/@electric-sql/pglite/dist/index.js';
import { hashPassword, verifyPassword } from '../packages/auth/src/index.js';
import { toPostgresSql, PG_APPEND_ONLY_TRIGGERS } from '../packages/database/src/dialect.js';

// Argon2 hashes for the seed passwords
const DEMO_PASSWORD = 'ChangeMe_demo_1';
const ADMIN_PASSWORD = 'ChangeMe_admin_1';

export type PersonDef = {
  key: string;
  code: string;
  first: string;
  last: string;
  title: string;
  role:
    'admin' | 'director' | 'hr_officer' | 'manager' | 'employee' | 'payroll_officer' | 'auditor';
  deptCode: string;
  teamCode?: string;
  leadsTeam?: string;
  headsDept?: boolean;
  managerKey?: string;
  category: 'PERM' | 'PROD' | 'MGMT';
  joined: string;
  probationEnd?: string;
};

export const DEPARTMENTS = [
  { code: 'PUB', name: 'Digital Publishing & Composition' },
  { code: 'ITES', name: 'ITES & Data Operations' },
  { code: 'QA', name: 'Quality Assurance & Editorial' },
  { code: 'TECH', name: 'Content Technology & Tools' },
  { code: 'HR', name: 'Human Resources & Administration' },
  { code: 'ADM', name: 'Administration' },
];

export const TEAMS = [
  { code: 'TEAM-PUB', deptCode: 'PUB', name: 'e-Publishing & Conversion' },
  { code: 'TEAM-ITES', deptCode: 'ITES', name: 'Data Processing & Annotation' },
  { code: 'TEAM-QA', deptCode: 'QA', name: 'Quality Control & Pre-Media' },
  { code: 'TEAM-TECH', deptCode: 'TECH', name: 'Workflow & Automation' },
  { code: 'TEAM-HR', deptCode: 'HR', name: 'HR Operations & Support' },
];

export const PEOPLE: PersonDef[] = [
  // ADMIN
  {
    key: 'admin',
    code: 'SNS-1000',
    first: 'Vijay',
    last: 'Antony',
    title: 'IT Administrator',
    role: 'admin',
    deptCode: 'ADM',
    category: 'MGMT',
    managerKey: 'rajesh',
    joined: '2020-01-06',
  },

  // 1. Digital Publishing & Composition (PUB) / Team: e-Publishing & Conversion (TEAM-PUB) - 10 members
  {
    key: 'suresh',
    code: 'SNS-1001',
    first: 'Suresh',
    last: 'Kumar',
    title: 'Publishing Operations Manager',
    role: 'manager',
    deptCode: 'PUB',
    teamCode: 'TEAM-PUB',
    leadsTeam: 'TEAM-PUB',
    headsDept: true,
    managerKey: 'rajesh',
    category: 'MGMT',
    joined: '2018-03-12',
  },
  {
    key: 'meera',
    code: 'SNS-1002',
    first: 'Meera',
    last: 'Krishnan',
    title: 'Senior Typesetting Specialist',
    role: 'employee',
    deptCode: 'PUB',
    teamCode: 'TEAM-PUB',
    managerKey: 'suresh',
    category: 'PROD',
    joined: '2019-06-17',
  },
  {
    key: 'arun',
    code: 'SNS-1003',
    first: 'Arun',
    last: 'Prakash',
    title: 'InDesign & Pagination Specialist',
    role: 'employee',
    deptCode: 'PUB',
    teamCode: 'TEAM-PUB',
    managerKey: 'suresh',
    category: 'PROD',
    joined: '2020-02-10',
  },
  {
    key: 'karthi',
    code: 'SNS-1004',
    first: 'Karthi',
    last: 'Keyan',
    title: 'XML / HTML Conversion Lead',
    role: 'employee',
    deptCode: 'PUB',
    teamCode: 'TEAM-PUB',
    managerKey: 'suresh',
    category: 'PROD',
    joined: '2021-04-05',
  },
  {
    key: 'priya',
    code: 'SNS-1005',
    first: 'Priya',
    last: 'Dharshini',
    title: 'eBook Production Executive',
    role: 'employee',
    deptCode: 'PUB',
    teamCode: 'TEAM-PUB',
    managerKey: 'suresh',
    category: 'PROD',
    joined: '2021-09-20',
  },
  {
    key: 'vignesh',
    code: 'SNS-1006',
    first: 'Vignesh',
    last: 'S',
    title: 'Digital Publishing Operator',
    role: 'employee',
    deptCode: 'PUB',
    teamCode: 'TEAM-PUB',
    managerKey: 'suresh',
    category: 'PROD',
    joined: '2022-01-18',
  },
  {
    key: 'deepa',
    code: 'SNS-1007',
    first: 'Deepa',
    last: 'R',
    title: 'Pre-Press Composition Associate',
    role: 'employee',
    deptCode: 'PUB',
    teamCode: 'TEAM-PUB',
    managerKey: 'suresh',
    category: 'PROD',
    joined: '2022-08-11',
  },
  {
    key: 'saravanan',
    code: 'SNS-1008',
    first: 'Saravanan',
    last: 'M',
    title: 'MathML & TeX Typesetter',
    role: 'employee',
    deptCode: 'PUB',
    teamCode: 'TEAM-PUB',
    managerKey: 'suresh',
    category: 'PROD',
    joined: '2023-03-06',
  },
  {
    key: 'nithya',
    code: 'SNS-1009',
    first: 'Nithya',
    last: 'Kalyani',
    title: 'EPUB Quality Specialist',
    role: 'employee',
    deptCode: 'PUB',
    teamCode: 'TEAM-PUB',
    managerKey: 'suresh',
    category: 'PROD',
    joined: '2023-11-15',
  },
  {
    key: 'harish',
    code: 'SNS-1010',
    first: 'Harish',
    last: 'Babu',
    title: 'Junior Layout Artist',
    role: 'employee',
    deptCode: 'PUB',
    teamCode: 'TEAM-PUB',
    managerKey: 'suresh',
    category: 'PROD',
    joined: '2026-07-01',
    probationEnd: '2026-12-31',
  },

  // 2. ITES & Data Operations (ITES) / Team: Data Processing & Annotation (TEAM-ITES) - 10 members
  {
    key: 'dinesh',
    code: 'SNS-1011',
    first: 'Dinesh',
    last: 'Kumar',
    title: 'ITES Operations Manager',
    role: 'manager',
    deptCode: 'ITES',
    teamCode: 'TEAM-ITES',
    leadsTeam: 'TEAM-ITES',
    headsDept: true,
    managerKey: 'rajesh',
    category: 'MGMT',
    joined: '2017-09-04',
  },
  {
    key: 'anandhi',
    code: 'SNS-1012',
    first: 'Anandhi',
    last: 'S',
    title: 'Senior Data Processing Analyst',
    role: 'employee',
    deptCode: 'ITES',
    teamCode: 'TEAM-ITES',
    managerKey: 'dinesh',
    category: 'PERM',
    joined: '2019-01-21',
  },
  {
    key: 'balaji',
    code: 'SNS-1013',
    first: 'Balaji',
    last: 'V',
    title: 'OCR & Digitization Specialist',
    role: 'employee',
    deptCode: 'ITES',
    teamCode: 'TEAM-ITES',
    managerKey: 'dinesh',
    category: 'PERM',
    joined: '2020-05-18',
  },
  {
    key: 'chitra',
    code: 'SNS-1014',
    first: 'Chitra',
    last: 'Devi',
    title: 'Data Verification Executive',
    role: 'employee',
    deptCode: 'ITES',
    teamCode: 'TEAM-ITES',
    managerKey: 'dinesh',
    category: 'PERM',
    joined: '2021-02-15',
  },
  {
    key: 'gowtham',
    code: 'SNS-1015',
    first: 'Gowtham',
    last: 'R',
    title: 'Metadata Indexing Associate',
    role: 'employee',
    deptCode: 'ITES',
    teamCode: 'TEAM-ITES',
    managerKey: 'dinesh',
    category: 'PERM',
    joined: '2021-10-11',
  },
  {
    key: 'janani',
    code: 'SNS-1016',
    first: 'Janani',
    last: 'K',
    title: 'Content Annotation Specialist',
    role: 'employee',
    deptCode: 'ITES',
    teamCode: 'TEAM-ITES',
    managerKey: 'dinesh',
    category: 'PERM',
    joined: '2022-04-04',
  },
  {
    key: 'manikandan',
    code: 'SNS-1017',
    first: 'Manikandan',
    last: 'P',
    title: 'Data Scrubbing Executive',
    role: 'employee',
    deptCode: 'ITES',
    teamCode: 'TEAM-ITES',
    managerKey: 'dinesh',
    category: 'PERM',
    joined: '2022-11-28',
  },
  {
    key: 'poornima',
    code: 'SNS-1018',
    first: 'Poornima',
    last: 'N',
    title: 'Cataloging Specialist',
    role: 'employee',
    deptCode: 'ITES',
    teamCode: 'TEAM-ITES',
    managerKey: 'dinesh',
    category: 'PERM',
    joined: '2023-06-19',
  },
  {
    key: 'sathish',
    code: 'SNS-1019',
    first: 'Sathish',
    last: 'Raj',
    title: 'ITES Associate',
    role: 'employee',
    deptCode: 'ITES',
    teamCode: 'TEAM-ITES',
    managerKey: 'dinesh',
    category: 'PERM',
    joined: '2024-01-15',
  },
  {
    key: 'shalini',
    code: 'SNS-1020',
    first: 'Shalini',
    last: 'M',
    title: 'Data Processing Trainee',
    role: 'employee',
    deptCode: 'ITES',
    teamCode: 'TEAM-ITES',
    managerKey: 'dinesh',
    category: 'PERM',
    joined: '2026-06-15',
    probationEnd: '2026-12-15',
  },

  // 3. Quality Assurance & Editorial (QA) / Team: Quality Control & Pre-Media (TEAM-QA) - 10 members
  {
    key: 'lakshmi',
    code: 'SNS-1021',
    first: 'Lakshmi',
    last: 'Priya',
    title: 'QA & Editorial Manager',
    role: 'manager',
    deptCode: 'QA',
    teamCode: 'TEAM-QA',
    leadsTeam: 'TEAM-QA',
    headsDept: true,
    managerKey: 'rajesh',
    category: 'MGMT',
    joined: '2016-11-07',
  },
  {
    key: 'gokul',
    code: 'SNS-1022',
    first: 'Gokul',
    last: 'Nath',
    title: 'Senior Quality Lead',
    role: 'employee',
    deptCode: 'QA',
    teamCode: 'TEAM-QA',
    managerKey: 'lakshmi',
    category: 'PERM',
    joined: '2018-08-20',
  },
  {
    key: 'hema',
    code: 'SNS-1023',
    first: 'Hema',
    last: 'Malini',
    title: 'Lead Copyeditor',
    role: 'employee',
    deptCode: 'QA',
    teamCode: 'TEAM-QA',
    managerKey: 'lakshmi',
    category: 'PERM',
    joined: '2019-09-02',
  },
  {
    key: 'ilango',
    code: 'SNS-1024',
    first: 'Ilango',
    last: 'T',
    title: 'Technical Proofreader',
    role: 'employee',
    deptCode: 'QA',
    teamCode: 'TEAM-QA',
    managerKey: 'lakshmi',
    category: 'PERM',
    joined: '2020-07-13',
  },
  {
    key: 'keerthana',
    code: 'SNS-1025',
    first: 'Keerthana',
    last: 'S',
    title: 'Editorial QA Analyst',
    role: 'employee',
    deptCode: 'QA',
    teamCode: 'TEAM-QA',
    managerKey: 'lakshmi',
    category: 'PERM',
    joined: '2021-03-22',
  },
  {
    key: 'mohan',
    code: 'SNS-1026',
    first: 'Mohan',
    last: 'Doss',
    title: 'Pre-Media Inspector',
    role: 'employee',
    deptCode: 'QA',
    teamCode: 'TEAM-QA',
    managerKey: 'lakshmi',
    category: 'PERM',
    joined: '2022-02-07',
  },
  {
    key: 'nandhini',
    code: 'SNS-1027',
    first: 'Nandhini',
    last: 'G',
    title: 'Content Quality Analyst',
    role: 'employee',
    deptCode: 'QA',
    teamCode: 'TEAM-QA',
    managerKey: 'lakshmi',
    category: 'PERM',
    joined: '2022-10-17',
  },
  {
    key: 'pradeep',
    code: 'SNS-1028',
    first: 'Pradeep',
    last: 'Kumar',
    title: 'Digital Compliance Reviewer',
    role: 'employee',
    deptCode: 'QA',
    teamCode: 'TEAM-QA',
    managerKey: 'lakshmi',
    category: 'PERM',
    joined: '2023-05-08',
  },
  {
    key: 'radhika',
    code: 'SNS-1029',
    first: 'Radhika',
    last: 'V',
    title: 'Proofreader',
    role: 'employee',
    deptCode: 'QA',
    teamCode: 'TEAM-QA',
    managerKey: 'lakshmi',
    category: 'PERM',
    joined: '2024-02-12',
  },
  {
    key: 'sandhiya',
    code: 'SNS-1030',
    first: 'Sandhiya',
    last: 'B',
    title: 'Editorial Assistant',
    role: 'employee',
    deptCode: 'QA',
    teamCode: 'TEAM-QA',
    managerKey: 'lakshmi',
    category: 'PERM',
    joined: '2026-08-01',
    probationEnd: '2027-01-31',
  },

  // 4. Content Technology & Tools (TECH) / Team: Workflow & Automation (TEAM-TECH) - 10 members
  {
    key: 'ashwin',
    code: 'SNS-1031',
    first: 'Ashwin',
    last: 'K',
    title: 'Publishing Technology Manager',
    role: 'manager',
    deptCode: 'TECH',
    teamCode: 'TEAM-TECH',
    leadsTeam: 'TEAM-TECH',
    headsDept: true,
    managerKey: 'rajesh',
    category: 'MGMT',
    joined: '2017-02-13',
  },
  {
    key: 'bhuvana',
    code: 'SNS-1032',
    first: 'Bhuvana',
    last: 'M',
    title: 'Senior Workflow Automation Engineer',
    role: 'employee',
    deptCode: 'TECH',
    teamCode: 'TEAM-TECH',
    managerKey: 'ashwin',
    category: 'PERM',
    joined: '2018-11-05',
  },
  {
    key: 'chandru',
    code: 'SNS-1033',
    first: 'Chandru',
    last: 'P',
    title: 'Publishing Tool Developer',
    role: 'employee',
    deptCode: 'TECH',
    teamCode: 'TEAM-TECH',
    managerKey: 'ashwin',
    category: 'PERM',
    joined: '2019-12-09',
  },
  {
    key: 'divya',
    code: 'SNS-1034',
    first: 'Divya',
    last: 'Bharathi',
    title: 'Python & XSLT Specialist',
    role: 'employee',
    deptCode: 'TECH',
    teamCode: 'TEAM-TECH',
    managerKey: 'ashwin',
    category: 'PERM',
    joined: '2020-11-23',
  },
  {
    key: 'eashwar',
    code: 'SNS-1035',
    first: 'Eashwar',
    last: 'T',
    title: 'IT Systems & Prepress Admin',
    role: 'employee',
    deptCode: 'TECH',
    teamCode: 'TEAM-TECH',
    managerKey: 'ashwin',
    category: 'PERM',
    joined: '2021-08-16',
  },
  {
    key: 'gayathri',
    code: 'SNS-1036',
    first: 'Gayathri',
    last: 'R',
    title: 'Scripting & Transformation Engineer',
    role: 'employee',
    deptCode: 'TECH',
    teamCode: 'TEAM-TECH',
    managerKey: 'ashwin',
    category: 'PERM',
    joined: '2022-03-14',
  },
  {
    key: 'jagadeesh',
    code: 'SNS-1037',
    first: 'Jagadeesh',
    last: 'S',
    title: 'Prepress Automation Engineer',
    role: 'employee',
    deptCode: 'TECH',
    teamCode: 'TEAM-TECH',
    managerKey: 'ashwin',
    category: 'PERM',
    joined: '2022-12-05',
  },
  {
    key: 'kavin',
    code: 'SNS-1038',
    first: 'Kavin',
    last: 'Raj',
    title: 'Digital Production Support Analyst',
    role: 'employee',
    deptCode: 'TECH',
    teamCode: 'TEAM-TECH',
    managerKey: 'ashwin',
    category: 'PERM',
    joined: '2023-07-24',
  },
  {
    key: 'lavanya',
    code: 'SNS-1039',
    first: 'Lavanya',
    last: 'D',
    title: 'Database & Asset Management Specialist',
    role: 'employee',
    deptCode: 'TECH',
    teamCode: 'TEAM-TECH',
    managerKey: 'ashwin',
    category: 'PERM',
    joined: '2024-04-08',
  },
  {
    key: 'naveen',
    code: 'SNS-1040',
    first: 'Naveen',
    last: 'Kumar',
    title: 'Junior Tools Developer',
    role: 'employee',
    deptCode: 'TECH',
    teamCode: 'TEAM-TECH',
    managerKey: 'ashwin',
    category: 'PERM',
    joined: '2026-07-15',
    probationEnd: '2027-01-14',
  },

  // 5. Human Resources & Administration (HR) / Team: HR Operations & Support (TEAM-HR) - 10 members
  {
    key: 'anjusha',
    code: 'SNS-1041',
    first: 'Anjusha',
    last: 'R',
    title: 'HR Manager',
    role: 'hr_officer',
    deptCode: 'HR',
    teamCode: 'TEAM-HR',
    leadsTeam: 'TEAM-HR',
    headsDept: true,
    managerKey: 'rajesh',
    category: 'MGMT',
    joined: '2016-04-18',
  },
  {
    key: 'rajesh',
    code: 'SNS-1042',
    first: 'Rajesh',
    last: 'Menon',
    title: 'Managing Director',
    role: 'director',
    deptCode: 'HR',
    teamCode: 'TEAM-HR',
    headsDept: false,
    category: 'MGMT',
    joined: '2015-01-05',
  },
  {
    key: 'ramesh',
    code: 'SNS-1043',
    first: 'Ramesh',
    last: 'V',
    title: 'Senior Payroll Officer',
    role: 'payroll_officer',
    deptCode: 'HR',
    teamCode: 'TEAM-HR',
    managerKey: 'anjusha',
    category: 'PERM',
    joined: '2017-06-12',
  },
  {
    key: 'sanjay',
    code: 'SNS-1044',
    first: 'Sanjay',
    last: 'G',
    title: 'Internal Auditor & Compliance Officer',
    role: 'auditor',
    deptCode: 'HR',
    teamCode: 'TEAM-HR',
    managerKey: 'anjusha',
    category: 'PERM',
    joined: '2019-04-15',
  },
  {
    key: 'swetha',
    code: 'SNS-1045',
    first: 'Swetha',
    last: 'P',
    title: 'Talent Acquisition Lead',
    role: 'employee',
    deptCode: 'HR',
    teamCode: 'TEAM-HR',
    managerKey: 'anjusha',
    category: 'PERM',
    joined: '2020-09-07',
  },
  {
    key: 'tharun',
    code: 'SNS-1046',
    first: 'Tharun',
    last: 'K',
    title: 'HR Operations Executive',
    role: 'employee',
    deptCode: 'HR',
    teamCode: 'TEAM-HR',
    managerKey: 'anjusha',
    category: 'PERM',
    joined: '2021-06-21',
  },
  {
    key: 'usha',
    code: 'SNS-1047',
    first: 'Usha',
    last: 'Rani',
    title: 'Employee Relations Specialist',
    role: 'employee',
    deptCode: 'HR',
    teamCode: 'TEAM-HR',
    managerKey: 'anjusha',
    category: 'PERM',
    joined: '2022-05-16',
  },
  {
    key: 'vimal',
    code: 'SNS-1048',
    first: 'Vimal',
    last: 'Raj',
    title: 'Workplace & Facilities Administrator',
    role: 'employee',
    deptCode: 'HR',
    teamCode: 'TEAM-HR',
    managerKey: 'anjusha',
    category: 'PERM',
    joined: '2023-02-20',
  },
  {
    key: 'yamini',
    code: 'SNS-1049',
    first: 'Yamini',
    last: 'S',
    title: 'HR Compliance Coordinator',
    role: 'employee',
    deptCode: 'HR',
    teamCode: 'TEAM-HR',
    managerKey: 'anjusha',
    category: 'PERM',
    joined: '2024-03-11',
  },
  {
    key: 'zoya',
    code: 'SNS-1050',
    first: 'Zoya',
    last: 'Fathima',
    title: 'HR Executive Trainee',
    role: 'employee',
    deptCode: 'HR',
    teamCode: 'TEAM-HR',
    managerKey: 'anjusha',
    category: 'PERM',
    joined: '2026-08-10',
    probationEnd: '2027-02-09',
  },
];

export async function buildSql(): Promise<string> {
  const demoHash = await hashPassword(DEMO_PASSWORD);
  const adminHash = await hashPassword(ADMIN_PASSWORD);

  const lines: string[] = [];
  const q = (val: unknown) => {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number') return String(val);
    return `'${String(val).replace(/'/g, "''")}'`;
  };

  lines.push(`-- =====================================================================`);
  lines.push(`-- Simon & Sons Leave OS - Navalur Chennai Dataset Reset & Migration`);
  lines.push(`-- Digital Publishing Solutions & ITES Services, Navalur, Chennai`);
  lines.push(`-- 5 Departments, 5 Teams, 10 Members per Department/Team (50 staff) + Admin`);
  lines.push(`-- Admin: Vijay Antony | HR: Anjusha R | Manager: Suresh Kumar`);
  lines.push(`-- Edge cases included for realistic verification on Vercel & Supabase`);
  lines.push(`-- =====================================================================\n`);

  lines.push(`BEGIN;`);
  lines.push(`-- Temporary suppression of append-only triggers for clean reset`);
  lines.push(`DROP TRIGGER IF EXISTS balance_ledger_no_delete ON balance_ledger;`);
  lines.push(`DROP TRIGGER IF EXISTS balance_ledger_no_update ON balance_ledger;`);
  lines.push(`DROP TRIGGER IF EXISTS audit_event_no_delete ON audit_event;`);
  lines.push(`DROP TRIGGER IF EXISTS audit_event_no_update ON audit_event;`);
  lines.push(``);

  // Clean out
  lines.push(`-- 1. Clean out existing leave requests, attendance, balances, and accounts`);
  lines.push(`DELETE FROM period_rollover_run;`);
  lines.push(`DELETE FROM accrual_run;`);
  lines.push(`DELETE FROM permission_request;`);
  lines.push(`DELETE FROM approval_override;`);
  lines.push(`DELETE FROM approval_delegation;`);
  lines.push(`DELETE FROM workstation_device;`);
  lines.push(`DELETE FROM attachment;`);
  lines.push(`DELETE FROM leave_comment;`);
  lines.push(`DELETE FROM approval_step_instance;`);
  lines.push(`DELETE FROM leave_request_day;`);
  lines.push(`DELETE FROM leave_request;`);
  lines.push(`DELETE FROM balance_ledger;`);
  lines.push(`DELETE FROM notification;`);
  lines.push(`DELETE FROM attendance_correction;`);
  lines.push(`DELETE FROM attendance_raw;`);
  lines.push(`DELETE FROM session;`);
  lines.push(`DELETE FROM password_history;`);
  lines.push(`DELETE FROM login_attempt;`);
  lines.push(`DELETE FROM user_role;`);
  lines.push(`DELETE FROM user_account;`);
  lines.push(`DELETE FROM emergency_contact;`);
  lines.push(`DELETE FROM employee_contact;`);
  lines.push(`DELETE FROM employment_history;`);
  lines.push(`UPDATE employee SET manager_employee_id = NULL;`);
  lines.push(`DELETE FROM employee;`);
  lines.push(`UPDATE team SET lead_employee_id = NULL;`);
  lines.push(`DELETE FROM team;`);
  lines.push(`UPDATE department SET head_employee_id = NULL;`);
  lines.push(`DELETE FROM department;`);
  lines.push(`DELETE FROM policy_assignment;`);
  lines.push(`DELETE FROM leave_policy_version;`);
  lines.push(`DELETE FROM leave_type;`);
  lines.push(`DELETE FROM holiday;`);
  lines.push(`DELETE FROM holiday_calendar;`);
  lines.push(`DELETE FROM approval_workflow_step;`);
  lines.push(`DELETE FROM approval_workflow;`);
  lines.push(`DELETE FROM job_title;`);
  lines.push(`DELETE FROM employment_type;`);
  lines.push(`DELETE FROM leave_period;`);
  lines.push(``);

  // Ensure Base Company, Location, Roles, Leave Types, Policies
  lines.push(`-- 2. Core Organization Setup`);
  lines.push(`INSERT INTO role (id, code, name, is_system)
VALUES
  ('role-admin', 'admin', 'Administrator', 1),
  ('role-director', 'director', 'Managing Director', 1),
  ('role-hr_officer', 'hr_officer', 'HR Officer', 1),
  ('role-manager', 'manager', 'Manager', 1),
  ('role-employee', 'employee', 'Employee', 1),
  ('role-payroll_officer', 'payroll_officer', 'Payroll Officer', 1),
  ('role-auditor', 'auditor', 'Auditor', 1)
ON CONFLICT (code) DO NOTHING;\n`);

  lines.push(`INSERT INTO company (id, name, timezone, leave_year_start_month, leave_year_start_day, created_at, created_by, updated_at, updated_by)
VALUES ('company', 'Simon & Sons', 'Asia/Kolkata', 1, 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO UPDATE SET name = 'Simon & Sons', timezone = 'Asia/Kolkata';\n`);

  lines.push(`INSERT INTO location (id, name, code, timezone, created_at, created_by, updated_at, updated_by)
VALUES ('loc-navalur', 'Navalur, Chennai', 'CHE-NAV', 'Asia/Kolkata', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (code) DO UPDATE SET name = 'Navalur, Chennai', timezone = 'Asia/Kolkata';\n`);

  lines.push(`INSERT INTO leave_period (id, label, starts_on, ends_on)
VALUES ('lp-2026', '2026', '2026-01-01', '2026-12-31')
ON CONFLICT (id) DO NOTHING;\n`);

  lines.push(`INSERT INTO leave_type (id, code, name, colour_token, is_paid, unit, created_at, created_by, updated_at, updated_by)
VALUES
  ('lt-al', 'AL', 'Annual Leave', 'accent', 1, 'half_day', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys'),
  ('lt-lop', 'LOP', 'Loss of Pay', 'neutral', 0, 'half_day', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (code) DO NOTHING;\n`);

  lines.push(`INSERT INTO leave_policy_version (id, leave_type_id, version_no, effective_from, rules_json, published_at, published_by, created_at, created_by)
VALUES (
  'lpv-al-1',
  'lt-al',
  1,
  '2026-01-01',
  '{"accrual":{"frequency":"monthly","rateHalfDays":3},"carryForward":{"maxHalfDays":10,"expiryMonths":6},"probation":{"eligible":true,"rateHalfDays":2}}',
  '2026-01-01T00:00:00.000Z',
  'sys',
  '2026-01-01T00:00:00.000Z',
  'sys'
) ON CONFLICT (leave_type_id, version_no) DO NOTHING;\n`);

  lines.push(`INSERT INTO policy_assignment (id, leave_policy_version_id, scope_type, scope_id, priority)
VALUES ('pa-al-comp', 'lpv-al-1', 'company', 'company', 0)
ON CONFLICT (id) DO NOTHING;\n`);

  lines.push(`INSERT INTO employment_type (id, name, code, is_leave_eligible, created_at, created_by, updated_at, updated_by)
VALUES
  ('et-perm', 'Permanent', 'PERM', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys'),
  ('et-prod', 'Production Staff', 'PROD', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys'),
  ('et-mgmt', 'Management', 'MGMT', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (code) DO NOTHING;\n`);

  // Holiday calendar
  lines.push(`INSERT INTO holiday_calendar (id, name, year, created_at, created_by, updated_at, updated_by)
VALUES ('cal-2026', 'Tamil Nadu / Chennai Holidays 2026', 2026, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;\n`);

  const holidays = [
    { date: '2026-01-15', name: 'Pongal', kind: 'public' },
    { date: '2026-01-16', name: 'Thiruvalluvar Day', kind: 'public' },
    { date: '2026-01-17', name: 'Uzhavar Thirunal', kind: 'public' },
    { date: '2026-01-26', name: 'Republic Day', kind: 'public' },
    { date: '2026-04-14', name: 'Tamil New Year', kind: 'public' },
    { date: '2026-05-01', name: 'May Day', kind: 'public' },
    { date: '2026-08-15', name: 'Independence Day', kind: 'public' },
    { date: '2026-10-02', name: 'Gandhi Jayanti', kind: 'public' },
    { date: '2026-10-20', name: 'Ayutha Pooja', kind: 'public' },
    { date: '2026-10-21', name: 'Vijaya Dasami', kind: 'public' },
    { date: '2026-11-08', name: 'Deepavali', kind: 'public' },
    { date: '2026-12-25', name: 'Christmas Day', kind: 'public' },
  ];
  for (const h of holidays) {
    lines.push(`INSERT INTO holiday (id, holiday_calendar_id, date, name, kind)
VALUES (${q(`hol-${h.date}`)}, 'cal-2026', ${q(h.date)}, ${q(h.name)}, ${q(h.kind)})
ON CONFLICT (holiday_calendar_id, date) DO NOTHING;`);
  }
  lines.push(``);

  // Departments
  lines.push(`-- 3. Departments`);
  for (const d of DEPARTMENTS) {
    lines.push(`INSERT INTO department (id, code, name, created_at, created_by, updated_at, updated_by)
VALUES (${q(`dept-${d.code.toLowerCase()}`)}, ${q(d.code)}, ${q(d.name)}, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (code) DO UPDATE SET name = ${q(d.name)};`);
  }
  lines.push(``);

  // Teams
  lines.push(`-- 4. Teams`);
  for (const t of TEAMS) {
    lines.push(`INSERT INTO team (id, department_id, name, created_at, created_by, updated_at, updated_by)
VALUES (${q(`team-${t.code.toLowerCase()}`)}, ${q(`dept-${t.deptCode.toLowerCase()}`)}, ${q(t.name)}, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (department_id, name) DO NOTHING;`);
  }
  lines.push(``);

  // Job titles
  const titles = Array.from(new Set(PEOPLE.map((p) => p.title)));
  lines.push(`-- 5. Job Titles`);
  for (let i = 0; i < titles.length; i++) {
    const t = titles[i];
    lines.push(`INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES (${q(`jt-${i + 1}`)}, ${q(t)}, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;`);
  }
  lines.push(``);

  // Employees & User Accounts & User Roles
  lines.push(`-- 6. Employees and Sign-in User Accounts`);
  for (const p of PEOPLE) {
    const empId = `emp-${p.key}`;
    const userId = `usr-${p.key}`;
    const email = `${p.key}@sns.test`;
    const pwdHash = p.role === 'admin' ? adminHash : demoHash;
    const titleIdx = titles.indexOf(p.title) + 1;
    const titleId = `jt-${titleIdx}`;
    const deptId = `dept-${p.deptCode.toLowerCase()}`;
    const teamId = p.teamCode ? `team-${p.teamCode.toLowerCase()}` : null;
    const catId = `et-${p.category.toLowerCase()}`;
    const status = p.probationEnd ? 'probation' : 'active';
    const probationEnd = p.probationEnd ?? null;

    lines.push(`INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES (${q(empId)}, ${q(p.code)}, ${q(p.first)}, ${q(p.last)}, ${q(email)}, ${q(status)}, ${q(p.joined)}, ${q(probationEnd)}, 'loc-navalur', ${q(deptId)}, ${q(teamId)}, ${q(titleId)}, ${q(catId)}, 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');`);

    lines.push(`INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES (${q(userId)}, ${q(empId)}, ${q(email)}, ${q(p.key)}, ${q(pwdHash)}, 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');`);

    lines.push(`INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT ${q(userId)}, id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = ${q(p.role)};`);

    // Opening Balance (36 half days = 18 days Annual Leave)
    lines.push(`INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES (${q(`bal-${p.key}-open`)}, ${q(empId)}, 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');`);
  }
  lines.push(``);

  // Link Reporting Managers, Department Heads, and Team Leads
  lines.push(`-- 7. Reporting Lines & Leadership`);
  for (const p of PEOPLE) {
    const empId = `emp-${p.key}`;
    if (p.managerKey) {
      lines.push(
        `UPDATE employee SET manager_employee_id = ${q(`emp-${p.managerKey}`)} WHERE id = ${q(empId)};`,
      );
      lines.push(`INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES (${q(`eh-${p.key}`)}, ${q(empId)}, (SELECT job_title_id FROM employee WHERE id = ${q(empId)}), (SELECT employment_type_id FROM employee WHERE id = ${q(empId)}), (SELECT department_id FROM employee WHERE id = ${q(empId)}), ${q(`emp-${p.managerKey}`)}, ${q(p.joined)}, NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');`);
    }
    if (p.headsDept) {
      lines.push(
        `UPDATE department SET head_employee_id = ${q(empId)} WHERE code = ${q(p.deptCode)};`,
      );
    }
    if (p.leadsTeam) {
      lines.push(
        `UPDATE team SET lead_employee_id = ${q(empId)} WHERE id = ${q(`team-${p.leadsTeam.toLowerCase()}`)};`,
      );
    }
  }
  lines.push(``);

  // Edge Cases for Leave Requests
  lines.push(`-- 8. Realistic Real-Life Edge Cases for Leave Requests`);

  type TestCase = {
    id: string;
    who: string;
    approver: string;
    startDate: string;
    endDate: string;
    daysCounted: number;
    halfDayStart?: 'am' | 'pm' | 'full';
    halfDayEnd?: 'am' | 'pm' | 'full';
    reason: string;
    status: 'approved' | 'pending_approval' | 'rejected' | 'withdrawn' | 'cancelled';
    note?: string;
    days: { date: string; portion: 'full' | 'am' | 'pm'; isCounted: number; skip?: string }[];
  };

  const edgeCases: TestCase[] = [
    // 1. Approved Past Leave: Meera (3 days in Aug 2026, approved by Suresh)
    {
      id: 'req-meera-aug',
      who: 'meera',
      approver: 'suresh',
      startDate: '2026-08-10',
      endDate: '2026-08-12',
      daysCounted: 3,
      reason: 'Family visit to Tiruchirappalli',
      status: 'approved',
      note: 'Approved. Work handed over to Arun.',
      days: [
        { date: '2026-08-10', portion: 'full', isCounted: 1 },
        { date: '2026-08-11', portion: 'full', isCounted: 1 },
        { date: '2026-08-12', portion: 'full', isCounted: 1 },
      ],
    },

    // 2. Pending Approval by Manager: Arun (2 days in Oct 2026, pending Suresh)
    {
      id: 'req-arun-oct',
      who: 'arun',
      approver: 'suresh',
      startDate: '2026-10-14',
      endDate: '2026-10-15',
      daysCounted: 2,
      reason: 'Attending relative wedding in Madurai',
      status: 'pending_approval',
      days: [
        { date: '2026-10-14', portion: 'full', isCounted: 1 },
        { date: '2026-10-15', portion: 'full', isCounted: 1 },
      ],
    },

    // 3. Rejected Leave with Feedback Note: Priya (5 days in Nov 2026 rejected due to publication freeze)
    {
      id: 'req-priya-nov',
      who: 'priya',
      approver: 'suresh',
      startDate: '2026-11-09',
      endDate: '2026-11-13',
      daysCounted: 5,
      reason: 'Annual vacation trip to Ooty',
      status: 'rejected',
      note: 'Major journal publishing release cycle that week. Please reschedule after Nov 20.',
      days: [
        { date: '2026-11-09', portion: 'full', isCounted: 1 },
        { date: '2026-11-10', portion: 'full', isCounted: 1 },
        { date: '2026-11-11', portion: 'full', isCounted: 1 },
        { date: '2026-11-12', portion: 'full', isCounted: 1 },
        { date: '2026-11-13', portion: 'full', isCounted: 1 },
      ],
    },

    // 4. Half-Day Leave Morning (AM): Vignesh S (0.5 days, pending Suresh)
    {
      id: 'req-vignesh-am',
      who: 'vignesh',
      approver: 'suresh',
      startDate: '2026-10-06',
      endDate: '2026-10-06',
      daysCounted: 0.5,
      halfDayStart: 'am',
      halfDayEnd: 'am',
      reason: 'Bank work at Navalur branch in the morning',
      status: 'pending_approval',
      days: [{ date: '2026-10-06', portion: 'am', isCounted: 1 }],
    },

    // 5. Half-Day Leave Afternoon (PM): Chitra Devi (0.5 days, approved by Dinesh)
    {
      id: 'req-chitra-pm',
      who: 'chitra',
      approver: 'dinesh',
      startDate: '2026-09-18',
      endDate: '2026-09-18',
      daysCounted: 0.5,
      halfDayStart: 'pm',
      halfDayEnd: 'pm',
      reason: 'Medical appointment at Chettinad Health City',
      status: 'approved',
      note: 'Approved. Please complete batch indexing before noon.',
      days: [{ date: '2026-09-18', portion: 'pm', isCounted: 1 }],
    },

    // 6. Leave by HR Officer (Anjusha R): routes to Managing Director Rajesh Menon
    {
      id: 'req-anjusha-md',
      who: 'anjusha',
      approver: 'rajesh',
      startDate: '2026-10-26',
      endDate: '2026-10-27',
      daysCounted: 2,
      reason: 'Personal family commitment in Thrissur',
      status: 'pending_approval',
      days: [
        { date: '2026-10-26', portion: 'full', isCounted: 1 },
        { date: '2026-10-27', portion: 'full', isCounted: 1 },
      ],
    },

    // 7. Leave by Manager (Suresh Kumar): routes to HR Officer Anjusha R
    {
      id: 'req-suresh-hr',
      who: 'suresh',
      approver: 'anjusha',
      startDate: '2026-10-19',
      endDate: '2026-10-19',
      daysCounted: 1,
      reason: 'Personal work at Tambaram Registrar office',
      status: 'pending_approval',
      days: [{ date: '2026-10-19', portion: 'full', isCounted: 1 }],
    },

    // 8. Weekend-Spanning Leave: Friday to Monday (Balaji V) -> 4 calendar days, Sat/Sun skipped!
    {
      id: 'req-balaji-weekend',
      who: 'balaji',
      approver: 'dinesh',
      startDate: '2026-10-09',
      endDate: '2026-10-12',
      daysCounted: 2,
      reason: 'Long weekend family trip to Kodaikanal',
      status: 'pending_approval',
      days: [
        { date: '2026-10-09', portion: 'full', isCounted: 1 },
        { date: '2026-10-10', portion: 'full', isCounted: 0, skip: 'weekend' },
        { date: '2026-10-11', portion: 'full', isCounted: 0, skip: 'weekend' },
        { date: '2026-10-12', portion: 'full', isCounted: 1 },
      ],
    },

    // 9. Holiday Overlap Leave: Oct 1 to Oct 5 (Keerthana S) -> Oct 2 Gandhi Jayanti + weekend skipped!
    {
      id: 'req-keerthana-hol',
      who: 'keerthana',
      approver: 'lakshmi',
      startDate: '2026-10-01',
      endDate: '2026-10-05',
      daysCounted: 2,
      reason: 'Pooja holidays family visit',
      status: 'pending_approval',
      days: [
        { date: '2026-10-01', portion: 'full', isCounted: 1 },
        { date: '2026-10-02', portion: 'full', isCounted: 0, skip: 'holiday' },
        { date: '2026-10-03', portion: 'full', isCounted: 0, skip: 'weekend' },
        { date: '2026-10-04', portion: 'full', isCounted: 0, skip: 'weekend' },
        { date: '2026-10-05', portion: 'full', isCounted: 1 },
      ],
    },

    // 10. Probationary Employee Leave: Harish Babu (1 day, testing probation restrictions)
    {
      id: 'req-harish-prob',
      who: 'harish',
      approver: 'suresh',
      startDate: '2026-10-23',
      endDate: '2026-10-23',
      daysCounted: 1,
      reason: 'College convocation ceremony in Anna University',
      status: 'pending_approval',
      days: [{ date: '2026-10-23', portion: 'full', isCounted: 1 }],
    },

    // 11. Cancelled Leave Post-Approval: Bhuvana M (Approved then cancelled, credit restored)
    {
      id: 'req-bhuvana-canc',
      who: 'bhuvana',
      approver: 'ashwin',
      startDate: '2026-09-08',
      endDate: '2026-09-09',
      daysCounted: 2,
      reason: 'Cancelled personal travel plans',
      status: 'cancelled',
      note: 'Cancellation acknowledged and approved.',
      days: [
        { date: '2026-09-08', portion: 'full', isCounted: 1 },
        { date: '2026-09-09', portion: 'full', isCounted: 1 },
      ],
    },

    // 12. Long-Duration Leave (10 days): Ilango T (pending Lakshmi)
    {
      id: 'req-ilango-long',
      who: 'ilango',
      approver: 'lakshmi',
      startDate: '2026-11-16',
      endDate: '2026-11-27',
      daysCounted: 10,
      reason: 'Brother wedding ceremony and pilgrimage tour',
      status: 'pending_approval',
      days: [
        { date: '2026-11-16', portion: 'full', isCounted: 1 },
        { date: '2026-11-17', portion: 'full', isCounted: 1 },
        { date: '2026-11-18', portion: 'full', isCounted: 1 },
        { date: '2026-11-19', portion: 'full', isCounted: 1 },
        { date: '2026-11-20', portion: 'full', isCounted: 1 },
        { date: '2026-11-21', portion: 'full', isCounted: 0, skip: 'weekend' },
        { date: '2026-11-22', portion: 'full', isCounted: 0, skip: 'weekend' },
        { date: '2026-11-23', portion: 'full', isCounted: 1 },
        { date: '2026-11-24', portion: 'full', isCounted: 1 },
        { date: '2026-11-25', portion: 'full', isCounted: 1 },
        { date: '2026-11-26', portion: 'full', isCounted: 1 },
        { date: '2026-11-27', portion: 'full', isCounted: 1 },
      ],
    },

    // 13. Withdrawn Leave: Eashwar T (withdrawn by employee)
    {
      id: 'req-eashwar-with',
      who: 'eashwar',
      approver: 'ashwin',
      startDate: '2026-10-16',
      endDate: '2026-10-16',
      daysCounted: 1,
      reason: 'Emergency postponed, withdrawing request',
      status: 'withdrawn',
      days: [{ date: '2026-10-16', portion: 'full', isCounted: 1 }],
    },

    // 14. LOP / Unpaid Leave Scenario: Saravanan M (Loss of Pay)
    {
      id: 'req-saravanan-lop',
      who: 'saravanan',
      approver: 'suresh',
      startDate: '2026-10-28',
      endDate: '2026-10-30',
      daysCounted: 3,
      reason: 'Urgent family work (Requesting Loss of Pay / LOP)',
      status: 'pending_approval',
      days: [
        { date: '2026-10-28', portion: 'full', isCounted: 1 },
        { date: '2026-10-29', portion: 'full', isCounted: 1 },
        { date: '2026-10-30', portion: 'full', isCounted: 1 },
      ],
    },
  ];

  for (const ec of edgeCases) {
    const empId = `emp-${ec.who}`;
    const approverEmpId = `emp-${ec.approver}`;
    const approverUserId = `usr-${ec.approver}`;
    const totalHalfDays = ec.daysCounted * 2;
    const leaveTypeId = ec.id === 'req-saravanan-lop' ? 'lt-lop' : 'lt-al';
    const submittedAt = '2026-09-20T09:30:00.000Z';
    const decidedAt =
      ec.status === 'approved' || ec.status === 'rejected' ? '2026-09-21T14:00:00.000Z' : null;

    lines.push(`INSERT INTO leave_request (id, employee_id, leave_type_id, policy_version_id, start_date, end_date, half_day_start, half_day_end, total_half_days, reason, status, submitted_at, decided_at, submitted_by, version, created_at, created_by, updated_at, updated_by)
VALUES (${q(ec.id)}, ${q(empId)}, ${q(leaveTypeId)}, 'lpv-al-1', ${q(ec.startDate)}, ${q(ec.endDate)}, ${q(ec.halfDayStart ?? 'full')}, ${q(ec.halfDayEnd ?? 'full')}, ${totalHalfDays}, ${q(ec.reason)}, ${q(ec.status)}, ${q(submittedAt)}, ${q(decidedAt)}, ${q(empId)}, 1, ${q(submittedAt)}, ${q(empId)}, ${q(submittedAt)}, ${q(empId)});`);

    for (let d = 0; d < ec.days.length; d++) {
      const day = ec.days[d];
      lines.push(`INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES (${q(`${ec.id}-d${d + 1}`)}, ${q(ec.id)}, ${q(day.date)}, ${q(day.portion)}, ${day.isCounted}, ${q(day.skip ?? null)});`);
    }

    const stepStatus =
      ec.status === 'approved'
        ? 'approved'
        : ec.status === 'rejected'
          ? 'rejected'
          : ec.status === 'withdrawn'
            ? 'withdrawn'
            : 'pending';
    lines.push(`INSERT INTO approval_step_instance (id, leave_request_id, step_no, approver_employee_id, approver_user_id, status, decided_at, decision_note)
VALUES (${q(`${ec.id}-step1`)}, ${q(ec.id)}, 1, ${q(approverEmpId)}, ${q(approverUserId)}, ${q(stepStatus)}, ${q(decidedAt)}, ${q(ec.note ?? null)});`);

    // Balance Ledger entries
    if (leaveTypeId === 'lt-al') {
      if (ec.status === 'approved') {
        lines.push(`INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, source_id, reason, created_by, created_at)
VALUES (${q(`bal-${ec.id}-ded`)}, ${q(empId)}, 'lt-al', 'lp-2026', 'DEDUCTION', -${totalHalfDays}, ${q(ec.startDate)}, 'leave_request', ${q(ec.id)}, 'Approved leave deduction', 'sys', ${q(submittedAt)});`);
      } else if (ec.status === 'pending_approval') {
        lines.push(`INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, source_id, reason, created_by, created_at)
VALUES (${q(`bal-${ec.id}-hold`)}, ${q(empId)}, 'lt-al', 'lp-2026', 'PENDING_HOLD', -${totalHalfDays}, ${q(ec.startDate)}, 'leave_request', ${q(ec.id)}, 'Pending approval hold', 'sys', ${q(submittedAt)});`);
      }
    }
  }
  lines.push(``);

  // App settings for quick demo accounts on sign-in screen
  const accountsOrder = [
    'admin@sns.test',
    'anjusha@sns.test',
    'suresh@sns.test',
    'rajesh@sns.test',
    'dinesh@sns.test',
    'lakshmi@sns.test',
    'ashwin@sns.test',
    'ramesh@sns.test',
    'sanjay@sns.test',
    ...PEOPLE.filter(
      (p) =>
        ![
          'admin',
          'anjusha',
          'suresh',
          'rajesh',
          'dinesh',
          'lakshmi',
          'ashwin',
          'ramesh',
          'sanjay',
        ].includes(p.key),
    ).map((p) => `${p.key}@sns.test`),
  ];

  lines.push(`-- 9. Application Settings (Demo Accounts & Version lock)`);
  lines.push(
    `DELETE FROM app_setting WHERE key IN ('demo.accounts', 'demo.version', 'demo.navalur_seed');`,
  );
  lines.push(`INSERT INTO app_setting (key, value_json, updated_by, updated_at)
VALUES
  ('demo.version', '"3"', 'sys', '2026-01-01T00:00:00.000Z'),
  ('demo.navalur_seed', '"1"', 'sys', '2026-01-01T00:00:00.000Z'),
  ('demo.accounts', ${q(JSON.stringify(accountsOrder))}, 'sys', '2026-01-01T00:00:00.000Z');\n`);

  lines.push(`-- 10. Re-enable append-only triggers`);
  lines.push(`${PG_APPEND_ONLY_TRIGGERS.trim()}`);
  lines.push(``);
  lines.push(`COMMIT;`);

  return lines.join('\n');
}

async function verifyWithPglite(sqlContent: string) {
  console.warn('Testing SQL against real PostgreSQL (PGlite WASM)...');
  const pg = new PGlite();

  // Run the existing migrations first so schema exists
  const rootDir = path.resolve(import.meta.dirname, '..');
  const migrationsDir = path.join(rootDir, 'packages/database/src/sql');
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    const stripped = sql.replace(/CREATE TRIGGER[\s\S]*?^END;/gm, '');
    const pgSql = `${toPostgresSql(stripped)}\n${PG_APPEND_ONLY_TRIGGERS}`;
    await pg.exec(pgSql);
  }

  function splitSql(sql: string): string[] {
    const parts: string[] = [];
    let buf = '';
    let inDollar = false;
    for (let i = 0; i < sql.length; i++) {
      if (sql.startsWith('$$', i)) {
        inDollar = !inDollar;
        buf += '$$';
        i++;
        continue;
      }
      if (!inDollar && sql[i] === ';') {
        if (buf.trim()) parts.push(buf.trim());
        buf = '';
        continue;
      }
      buf += sql[i];
    }
    if (buf.trim()) parts.push(buf.trim());
    return parts;
  }

  const stripped = sqlContent
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^--.*$/gm, '')
    .trim();
  const stmts = splitSql(stripped).filter(Boolean);

  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    try {
      await pg.exec(s + ';');
    } catch (err: unknown) {
      console.error(`Failed at statement ${i + 1}:`);
      console.error(s);
      console.error('Error message:', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // Run verification queries
  const deptCount = await pg.query<{ count: string }>(
    "SELECT COUNT(*) as count FROM department WHERE code != 'ADM'",
  );
  const teamCount = await pg.query<{ count: string }>('SELECT COUNT(*) as count FROM team');
  const empCount = await pg.query<{ count: string }>('SELECT COUNT(*) as count FROM employee');
  const leaveReqCount = await pg.query<{ count: string }>(
    'SELECT COUNT(*) as count FROM leave_request',
  );
  const userAccCount = await pg.query<{ count: string }>(
    'SELECT COUNT(*) as count FROM user_account',
  );

  console.warn('Verification Results:');
  console.warn(`- Active Business Departments: ${deptCount.rows[0].count} (Expected: 5)`);
  console.warn(`- Teams: ${teamCount.rows[0].count} (Expected: 5)`);
  console.warn(`- Employees: ${empCount.rows[0].count} (Expected: 51 total = 50 staff + 1 Admin)`);
  console.warn(`- User Accounts: ${userAccCount.rows[0].count} (Expected: 51)`);
  console.warn(`- Edge Case Leave Requests: ${leaveReqCount.rows[0].count} (Expected: 14)`);

  // Verify key logins
  const adminAcc = await pg.query<{ email: string; password_hash: string }>(
    "SELECT email, password_hash FROM user_account WHERE email = 'admin@sns.test'",
  );
  const hrAcc = await pg.query<{ email: string; password_hash: string }>(
    "SELECT email, password_hash FROM user_account WHERE email = 'anjusha@sns.test'",
  );
  const mgrAcc = await pg.query<{ email: string; password_hash: string }>(
    "SELECT email, password_hash FROM user_account WHERE email = 'suresh@sns.test'",
  );

  const adminOk = await verifyPassword(adminAcc.rows[0].password_hash, ADMIN_PASSWORD);
  const hrOk = await verifyPassword(hrAcc.rows[0].password_hash, DEMO_PASSWORD);
  const mgrOk = await verifyPassword(mgrAcc.rows[0].password_hash, DEMO_PASSWORD);

  console.warn(`- Admin login (Vijay Antony, ChangeMe_admin_1): ${adminOk ? 'PASSED' : 'FAILED'}`);
  console.warn(`- HR login (Anjusha R, ChangeMe_demo_1): ${hrOk ? 'PASSED' : 'FAILED'}`);
  console.warn(`- Manager login (Suresh Kumar, ChangeMe_demo_1): ${mgrOk ? 'PASSED' : 'FAILED'}`);

  // Verify members per team
  const teamMembers = await pg.query<{ team_name: string; member_count: string }>(`
    SELECT t.name as team_name, COUNT(e.id) as member_count
    FROM team t
    LEFT JOIN employee e ON e.team_id = t.id
    GROUP BY t.id, t.name
    ORDER BY t.name
  `);
  console.warn('- Member count per team:');
  for (const tm of teamMembers.rows) {
    console.warn(`  * ${tm.team_name}: ${tm.member_count} members`);
  }

  await pg.close();
}

async function main() {
  const sql = await buildSql();
  await verifyWithPglite(sql);

  const rootDir = path.resolve(import.meta.dirname, '..');
  const outFile = path.join(rootDir, 'scripts/reset-simon-and-sons-navalur.sql');
  fs.writeFileSync(outFile, sql, 'utf8');
  console.warn(`\nSuccessfully wrote verified SQL script to: ${outFile}`);

  const tsFile = path.join(rootDir, 'apps/server/src/navalur-seed-sql.ts');
  fs.writeFileSync(
    tsFile,
    `// Auto-generated by scripts/generate-navalur-seed.ts. Do not edit directly.\nexport const NAVALUR_SEED_SQL = ${JSON.stringify(sql)};\n`,
    'utf8',
  );
  console.warn(`Successfully wrote bundled SQL module to: ${tsFile}`);
}

main().catch((err) => {
  console.error('Error generating seed:', err);
  process.exit(1);
});
