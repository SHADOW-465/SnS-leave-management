# How to actually ship this

**Question asked:** should Leave OS be rolled out as a desktop application?

**Short answer: no — and your instinct that something is off is correct.**

Leave OS is a small multi-user server. Fifty people need to reach it at the same time from
their own machines. A desktop application is single-user software that lives and dies with
one person's login session. Those are opposite shapes.

The right mental model is an **appliance**: install it once on one office computer, it
starts by itself and stays running, and everybody — including the person whose desk it sits
on — uses it through a browser.

---

## Why not Electron

The original plan called for an Electron control panel, and it was never built (there is no
Electron dependency in the repo today). That turned out to be lucky. Electron would cost:

- **~150 MB** added to the installer for a window whose entire job is "show a URL and a Stop button".
- **Native module rebuilds.** This already bit the project once: `better-sqlite3` could not be
  compiled and the code fell back to Node's built-in `node:sqlite`. Electron reintroduces
  exactly that class of problem, because it needs every native module rebuilt against its own
  Node ABI.
- **A second user interface to build and maintain**, duplicating status, backup, and restore
  screens that belong in the admin area of the web app — where they are reachable from any
  machine, not only from the one the server happens to run on.
- **A single point of accidental failure.** If the app is a window, somebody eventually closes
  the window, and the whole company loses leave management until someone walks over to that desk.

The one genuine benefit — a familiar icon to double-click — is available far more cheaply.

---

## Recommended stack

Keep almost everything. The application layer is sound; only the _packaging_ was wrong.

| Layer                           | Keep / change           | Why                                                                                                                                     |
| ------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| React + Vite web app            | **Keep**                | Every user already has the perfect client: a browser. Nothing to install on 50 machines.                                                |
| Fastify API + static serving    | **Keep**                | One process, one port, one thing to run.                                                                                                |
| SQLite via `node:sqlite`        | **Keep**                | Built into Node 24 — **zero native dependencies**, which is what makes single-file packaging easy. Comfortable well past 250 employees. |
| Domain / Zod / RBAC layers      | **Keep**                | Storage-agnostic and well covered by tests.                                                                                             |
| Electron control panel          | **Drop**                | Never built. See above.                                                                                                                 |
| Vercel + Supabase Postgres      | **Drop for production** | See "About the hosted deployment" below.                                                                                                |
| **Windows Service + installer** | **Add**                 | This is the piece that turns it into an appliance.                                                                                      |

### The three steps, by effort

**1. Works right now — zero extra effort**

```bash
pnpm start
```

Or double-click `Start Leave OS.cmd`. It binds to the network, prints the address for
colleagues, and opens the app locally:

```
  Staff on this network open:   http://10.213.157.51:3000
  On this computer:             http://localhost:3000
```

Good enough for a pilot. Its one weakness is the one that matters: closing the window stops
it for everyone.

**2. The real answer — a Windows Service (about a day)**

Wrap the server with [WinSW](https://github.com/winsw/winsw) or NSSM and register it as a
Windows Service. This is what makes it an appliance rather than a program someone has to
remember to run:

- Starts automatically at boot, **before anyone logs in**
- Keeps running when the host user logs out or locks the screen
- Restarts by itself if it crashes
- Cannot be closed by accident

Package with **Inno Setup**, bundling a Node runtime so the office computer needs no
developer tooling — no Node, no pnpm, no Git, no build tools.

**3. Optional polish — a tray icon (a few hours)**

A small tray application showing a green/red dot, the LAN URL with a Copy button, and
Open / Restart. Nice, not necessary; the same information belongs in the web admin area,
where HR can reach it from their own desk.

---

## Two decisions you should make deliberately

### The URL must not change

If the host machine gets its address from DHCP, that address will change and everyone's
bookmark breaks. Fix it one of two ways:

- **DHCP reservation** on the router — pin the host's IP to its MAC address. Simplest.
- **A hostname** such as `leave.sns.local`, so people type a name rather than digits.

This needs whoever administers the office router (still recorded as unknown — decision D-17).

### HTTP or HTTPS on the LAN

Today the server speaks **plain HTTP only**. TLS settings exist in the config but no code
reads them. Over plain HTTP, session cookies cross the office network in clear text, so
anyone on the same Wi-Fi can capture an HR or administrator session and act as them.

Three honest options:

| Option                                                       | Cost                               | When it fits                                                                                                  |
| ------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Accept HTTP on a trusted wired/Wi-Fi network                 | none                               | A small trusted office. What most internal tools of this size actually do. Write it down as an accepted risk. |
| Private certificate authority, root installed on each client | ~1 hour per machine, plus renewals | You want real confidentiality and control the client machines.                                                |
| Tailscale or similar overlay network                         | small subscription                 | You also want secure access from outside the office.                                                          |

There is no wrong choice here, only an undecided one. Right now it is undecided, which is
the bad state.

---

## About the hosted (Vercel + Supabase) deployment

It now works — the bug that stopped leave being submitted or approved is fixed and covered
by tests. But it should stay what it was always labelled: a **temporary click-through
preview**, not the product.

Running a local-first SQLite application on serverless forced a second database dialect, a
hand-written SQL translation layer, a single-connection transaction gate, and a cron
endpoint standing in for background jobs. That translation layer is precisely where the
outage came from. Every one of those complications disappears the moment it runs on the
office computer as intended.

Keep it while people are still clicking around and giving feedback. Do not go live on it.

---

## Still outstanding before "fully functional"

Fixing the hosted deployment does not make the product complete. From the code review, these
remain and are tracked in `DEFERRED-WORK.md`:

1. **Leave balances reset to zero at the leave-year boundary.** Entitlement is tied to a
   period id; a new period is created on the first day of the new leave year and nothing
   grants entitlement for it. There is no carry-forward job and no expiry job. This breaks
   on a known date, for everyone at once. **Highest priority.**
2. **The accrual job ignores published rules** (it reads hard-coded defaults) and has no
   idempotency guard, so it can credit twice in a month.
3. **No scheduled backup**, despite it being documented. Backup exists only as a manual button.
4. **No TLS** — see above.

Items 1 and 2 are contained fixes. I would do those before any rollout.
