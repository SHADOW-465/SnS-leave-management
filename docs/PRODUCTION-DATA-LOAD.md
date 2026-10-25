# Turning the hosted sample database into a production one

An operator procedure, not a product feature. It exists because the hosted Supabase database was
first filled with sample people (`@sns.test`), and the real roster has to replace them.

The generator holds no names. It reads a roster file you keep outside the repository and writes
the scripts, and the one-time administrator password, to a folder outside the repository. It
refuses an output folder inside the repo. It never opens a database.

```text
cd apps/server
node --import tsx ../../scripts/generate-production-sql.ts \
  --csv <employee_id,name file> --out-dir <folder outside the repo> \
  --admin <administrator employee id> --hr <HR employee id> --joined-on YYYY-MM-DD
```

| Script                     | Does                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00_preview_counts.sql`    | Read only. Row counts per table, marked delete or keep.                                                                                                                                                                                                                                                                                                                                               |
| `01_partA_wipe_sample.sql` | One transaction. Deletes people, accounts, sessions, devices, requests, balances, ledger, attendance, notifications and audit. Keeps schema, company, location, holidays, leave types and policy, approval workflows, employment types, roles and permissions, job and backup history. Drops and recreates the append-only triggers inside the same transaction. Refuses to run once `02` has loaded. |
| `02_partB_employees.sql`   | One transaction, idempotent. Ensures system roles, permissions and organisation basics exist, upserts people by employee code, creates sign-ins and roles only where missing. Writes a marker that makes `01` refuse afterwards.                                                                                                                                                                      |

## How the administrator first signs in

`02` creates the administrator's account with an argon2id hash of a random one-time password and
`must_change_password = 1`. The password is in the generated text file only. Sign in with the
employee ID, choose a new password when asked, then delete the file. Every other account has no
usable password; the administrator resets each from Users & access, which shows a temporary
password once and forces a change at first sign-in.

First-run setup stays closed: it opens only while there is no user account, and `02` creates one.
Run `02` straight after `01`. Between them setup is open, but it still needs `SETUP_TOKEN`.

## Placeholders (DW-147)

The roster has an id and a name. `02` fills the columns the database cannot leave empty:
`<code>@example.invalid` as work email, the `--joined-on` date, department General, the first
location. Correct them in the product. No balances are posted.

## Verified and not verified

Verified: `apps/server/src/ops/production-sql.test.ts` runs the scripts on PGlite after a
first-run sample setup and after the Navalur reset, then signs in, changes the password, assigns a
role, resets another person's password, and re-runs `02`.

Not verified: a run against Supabase itself, and the Supabase SQL editor's handling of the
`DO $$` blocks. Run `00` first and read it.
