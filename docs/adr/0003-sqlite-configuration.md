# ADR 0003 — SQLite configuration and single-writer discipline

**Status:** Accepted (planning) · **Date:** 2026-08-25

## Context

SQLite is fixed by the brief. Its defaults are not appropriate for a system that must not
lose an approval, on a machine that may lose power.

## Decision

Set and **verify** at every startup:

```
PRAGMA foreign_keys = ON;      -- off by default in SQLite, per connection
PRAGMA journal_mode = WAL;     -- concurrent readers alongside one writer
PRAGMA synchronous = FULL;     -- fsync on every commit
PRAGMA busy_timeout = 5000;    -- 5s before returning SQLITE_BUSY
```

Startup fails loudly if any is not in effect after being set.

**Exactly one process opens the database file** — the server child process. Enforced by an
advisory lock file plus the Electron single-instance lock. The database file lives on local
disk and never on a network share.

## Rationale

`foreign_keys` is off by default and per-connection, which is the single most common way a
SQLite application silently accumulates orphaned rows.

`synchronous = FULL` costs roughly one fsync per commit. At ~50 employees this is
irrelevant to throughput and decisive for durability on a machine behind a consumer power
supply. `NORMAL` under WAL can lose recent transactions on power loss — an acceptable
trade for a cache, not for an approval.

A single writer sidesteps SQLite's multi-process locking entirely. Network shares break
SQLite's locking assumptions outright and are the leading cause of "the database is
corrupt" reports.

`busy_timeout` of 5s: long enough to absorb a slow backup, short enough that a genuine
deadlock surfaces rather than hanging the UI.

## Consequences

- Write throughput is bounded by fsync. Measured in M1; expected to be far above need.
- The backup job must use the SQLite **online backup API**, never a file copy — with WAL,
  copying the `.db` file alone produces a corrupt or stale artefact, and it fails silently.
- A WAL checkpoint is part of graceful shutdown.
- After an unclean stop, an integrity check runs before accepting traffic.

## Alternatives rejected

- **`synchronous = NORMAL`** — faster, and can lose committed transactions on power loss.
- **A database file on a shared drive** so "backups are automatic" — the most tempting and
  most destructive option available. Explicitly forbidden in the operator documentation.
- **`node:sqlite`** (Node 24 built-in) — **adopted in v1** because `better-sqlite3` has no
  prebuild for Node 24 on Windows and this machine has no Visual Studio C++ workload.
  PRAGMAs, WAL, append-only triggers, and `VACUUM INTO` backups are unchanged. Revisit
  `better-sqlite3` only if Node's SQLite API loses a required capability.
  packaged reliably inside Electron. Would require an adapter change, not a redesign.
