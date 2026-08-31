# Simon & Sons Leave OS

Local-first employee and leave management for one Windows machine on the office LAN.

This is **v1 for developer testing**. Installation, LAN HTTPS, TLS trust, and accessibility
are **not verified** until those exact tests are run and recorded.

## 10-minute developer start (Windows)

1. Node 24+
2. `pnpm install`
3. `pnpm dev` — API at `http://127.0.0.1:3000`, UI at `http://localhost:5173`
4. Open the UI. Complete the first-run wizard (or `pnpm seed:demo`)
5. Sign in. Seeded demo people use `@example.invalid` and must change their password.

Default seed (if you run `pnpm seed:demo`):

- Admin: `admin@example.invalid` / `ChangeMe_admin_1`
- Other sample users: `ChangeMe_demo_1` (forced change on first sign-in)

**Placeholder leave rules are active until HR publishes real ones (DW-37).** Do not process
real leave on placeholders.

### Hosted preview (temporary)

The office product is SQLite. For a clickable verification link the API can run on Vercel
against a Supabase Postgres database. This is **not** the office product (DW-29, DW-41).

1. Create a Supabase project. Copy the **Session pooler** or direct URI (`sslmode=require`).
   Never put a Supabase anon key in the browser — the browser talks only to this API.
2. In the Vercel project, set `DATABASE_URL` to that URI (Production + Preview).
   Optional: `CRON_SECRET` for the daily job tick, `LEAVEOS_PUBLIC_URL` to the deployment URL.
3. Deploy. The first request migrates the schema and seeds the synthetic demo accounts.

Sign-in (synthetic only):

- Admin: `admin@example.invalid` / `ChangeMe_admin_1`
- Other sample users: `ChangeMe_demo_1`

Attachments and file backups do not persist on Vercel. Unset `DATABASE_URL` and drop the
preview project when verification is finished.

## Checks

```
pnpm check
```

Format, lint, typecheck, unit and integration tests. A passing check is not evidence that
installation, LAN access, or TLS trust work.

## Layout

See `docs/00-PLAN-INDEX.md` and `AGENTS.md`. Dependency rule: `domain` imports nothing else
in the repo; `web` imports `contracts` and `ui` only; `desktop` never opens the database.

## What is deliberately not in v1

See `docs/DEFERRED-WORK.md`. Statutory payroll, biometric devices, cloud hosting, and
automatic deletion are blocked or out of scope.
