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

| Script                       | Does                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `99_inspect_live_schema.sql` | Read only. Lists every schema, the tables outside Supabase's own schemas with row counts, the rows of `schema_migration`, and which migrations this app version expects but the database lacks.                                                                                                                                                                                                       |
| `03_schema_upgrade.sql`      | One transaction, idempotent. Applies the migrations after the deployed baseline (today 0013 `browser_device`, 0014 archive non-Annual-Leave types) and records them in `schema_migration` the way the app's migrator does, so the app does not run them again. Stops, changing nothing, if the database is not Leave OS or is older than the baseline.                                                |
| `00_preview_counts.sql`      | Read only. Row counts per table, marked delete or keep, plus the migration status. A table or column that is not there is reported as MISSING instead of failing.                                                                                                                                                                                                                                     |
| `01_partA_wipe_sample.sql`   | One transaction. Deletes people, accounts, sessions, devices, requests, balances, ledger, attendance, notifications and audit. Keeps schema, company, location, holidays, leave types and policy, approval workflows, employment types, roles and permissions, job and backup history. Drops and recreates the append-only triggers inside the same transaction. Refuses to run once `02` has loaded. |
| `02_partB_employees.sql`     | One transaction, idempotent. Ensures system roles, permissions and organisation basics exist, upserts people by employee code, creates sign-ins and roles only where missing. Writes a marker that makes `01` refuse afterwards.                                                                                                                                                                      |

## Which schema is the database at, and in what order to run things

The app migrates itself: `openDatabaseFromEnv` calls `migrate` on every start, on Postgres too,
and records each applied id in `public.schema_migration`. So deploying a newer version brings the
schema level by itself. `03` exists so the SQL can be run before, or without, a deploy.

Recommended order against a database built by an older deploy:

1. `99` (read only) to see the state.
2. `03`. Safe before or after the deploy; a no-op if the app already migrated.
3. Deploy the version that has hosted hardening (setup token). Do this **before** `01`: between
   `01` and `02` there is no account, and only the new version keeps setup closed without `SETUP_TOKEN`.
4. `00`, `01`, `02`, `00`. Then sign in.

If `99` or `03` shows the database is older than the baseline, or has objects nobody can account
for, the fallback is to drop only the app's tables (never the `auth`, `storage`, `realtime`,
`extensions`, `graphql`, `vault` or `supabase_*` schemas) and let the deployed app create the schema
on its first start. That was not needed here and no script for it is generated.

### Why upgrade, not drop and rebuild

Considered because every row in the live database was sample data. Rejected: only two migrations
were missing (one empty table, one archive), `01` already clears sample rows inside a transaction,
and a rebuild would mean dropping tables on a Supabase project (or the `public` schema and its
default grants to `anon`, `authenticated` and `service_role`) for no gain. Schema creation is the
app's migrator, which translates the SQLite migrations to Postgres at run time; a hand-written
rebuild script would be a second copy that can drift from it.

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

The same scenarios run twice: once on the schema the live database has (migrations 0001-0012, the schema of main 94e69a1; those files are byte-identical on this branch) and once on the branch schema. On the old schema the run goes 99, 00, 03, 03 again, the app's migrator, 00, 01, 02, then sign-in. A second leave type is archived by 0014 and kept. `03` is checked to leave the same columns, indexes and `schema_migration` ids as the app's own migrator.

Not verified: a run against Supabase itself, and the Supabase SQL editor's handling of the
`DO $$` blocks. Run `00` first and read it.
