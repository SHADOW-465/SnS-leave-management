# ADR 0002 — The desktop app supervises a separate server process

**Status:** Accepted (planning) · **Date:** 2026-08-25

## Context

An Electron control panel hosts the server on the office machine. The naive design runs the
Fastify server inside the Electron main process, or worse, alongside the renderer.

## Decision

The Electron **main process spawns and supervises a separate Node child process** that runs
Fastify and owns the database. Communication is over stdio IPC. No TCP port is used between
them.

Closing the control panel window minimises to the tray and does not stop the server.
"Stop server and exit" is a separate, warned action.

## Rationale

A renderer crash, a devtools mistake, or an errant window close must not take the leave
system away from fifty people mid-morning. Process isolation is what makes that guarantee
real rather than aspirational.

It also means the server can be restarted without restarting the UI, and the UI can be
reloaded without interrupting a single request.

stdio rather than a TCP port: nothing extra is listening, so nothing extra can be reached
from the network.

## Consequences

- Slightly more complexity: process lifecycle, health checks, log forwarding, crash policy.
- Graceful shutdown must be an explicit protocol — stop accepting, drain, checkpoint, close,
  exit — not a `SIGKILL`.
- The crash restart policy needs a hard cap (5 restarts in 10 minutes) so a persistent
  failure surfaces to a human rather than looping forever.
- The desktop package must never import the database layer. Enforced by the boundary rule.

## Alternatives rejected

- **Server in the Electron main process** — a main-process crash takes down everything, and
  Electron's lifecycle events start fighting the server's.
- **Windows Service instead of Electron** — better on paper for uptime, worse for the actual
  operator, who needs a visible panel with status and buttons. Revisit if the company later
  gets dedicated IT support.
