# Employee import

The product exposes a template and nothing that commits it.

`GET /api/v1/import/template.csv` (permission `import.run`) returns:

```text
employee_code,first_name,last_name,work_email,joined_on,department_code,manager_code
SNS-2001,Meena,Pillai,meena@sns.test,2024-03-01,PRD,
```

There is no `POST` for that file. `packages/domain/src/import/normalise.ts` only trims cells, parses dates and numbers, and makes CSV cells safe. It does not insert employees. `POST /api/v1/employees/bulk-provision` creates sign-ins for people who already exist; it does not read a roster.

Creating one person through `POST /api/v1/employees` requires `employeeCode`, `firstName`, `lastName`, `workEmail`, `joinedOn`, `locationId`, `departmentId`, `jobTitleId`, and `employmentTypeId`. The database itself requires `employee_code`, `first_name`, `last_name`, `work_email` (unique), `joined_on`, `location_id`, and `department_id`. Job title, employment type, team, and manager may be null. Balances are not a column: they are the sum of the append-only ledger, and the create-employee use-case posts the opening grant.

## Roster file

A real roster of `employee_id,name` is not that format. Convert it with:

```text
node scripts/roster-to-import.mjs roster.csv import.csv
```

`employee_id` becomes `employee_code`. The name is split into `first_name` and `last_name`. `role` is `staff`, which the importer stores as the domain role `employee`. Email, join date, department, and manager are left blank.

## Loading a copy

```text
node scripts/import-roster.mjs --db <copy of app.db> --csv import.csv --credentials-out <file> --joined-on YYYY-MM-DD
```

The script upserts by employee code. New sign-ins must change their password on first use. Passwords are written only to `--credentials-out` and are never printed. A second run updates names and does not change the password.

It refuses a database outside the temp directory, anything under this repository's `data` directory, and anything whose path contains `SimonAndSons` (the installed Leave OS folder). `--allow-outside-temp` opens a copy you made yourself and still refuses those two locations. It does not speak Postgres and does not read `DATABASE_URL`.

Fields the roster does not have, and what the script does with them:

| Roster lacks                  | Required by the app                           | What the script does                                           |
| ----------------------------- | --------------------------------------------- | -------------------------------------------------------------- |
| Work email                    | Yes, unique                                   | `<code>@example.invalid`                                       |
| Join date                     | Yes                                           | `--joined-on`, otherwise the UTC date of the run               |
| Department                    | Yes (foreign key)                             | `--department-code`, default `GEN` (General, created at setup) |
| Location                      | Yes (foreign key)                             | The first location (Headquarters after setup)                  |
| Manager                       | No                                            | Left blank                                                     |
| Job title and employment type | No on the table; yes on the single-person API | Left blank                                                     |
| Role                          | A sign-in needs one                           | `staff` → `employee`                                           |
| Opening balances              | Not stored; the API posts a ledger grant      | Not posted. Balance stays zero until accrual or HR             |

Correct the placeholder email, join date, and department in the product after import. Do not point the script at the live office database or at Supabase.
