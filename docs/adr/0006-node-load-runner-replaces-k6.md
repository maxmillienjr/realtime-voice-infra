# 0006 · A Node load runner replaces the k6 script

**Status:** accepted
**Date:** 2026-04-30
**Recorded in:** commits `b9616f1` (`feat(stream-server): node-based load runner`) and
`8af05b4` (`ci(load): replace k6 with node runner; pin nodeLinker`), and the header comment
of `apps/stream-server/scripts/load-backpressure.ts`.

## Context

The original build spec called for a k6 script driving 100 virtual users at 50 frames per
second for 60 seconds. The script that shipped in `scripts/load/backpressure.js` was, in the
words of `b9616f1`, non-functional: it spoke raw WebSocket to a Socket.io endpoint, sent
unencrypted bytes the server's GCM router rejected, and tagged metrics that nothing emitted.
The deeper problem was that k6's runtime has no AES-GCM, so a corrected k6 script still could
not produce frames the real ingest path would accept.

## Decision

Replace k6 with a TypeScript runner executed by `tsx` inside the `stream-server` workspace:

- It uses `socket.io-client` and the workspace's own `session-core`, so every frame it sends is
  genuinely encrypted and takes the production decrypt path.
- It reads each session's key from the same Redis the server uses (port-mapped from compose)
  rather than adding a CI-only endpoint that would weaken `/session/init`'s contract in the
  published code.
- Pass/fail is `ack_ratio >= 0.95` and zero `DECRYPT_FAILED` / `AUTH_FAILED`. Pause and resume
  counts are reported, not judged — "backpressure firing is the whole point."
- It writes `summary.json` (ack ratio, pause/resume counts, error codes, p50/p95/p99 ack
  latency), which `load.yml` uploads as an artifact and prints on failure alongside the
  server logs.
- `.yarnrc.yml` pins `nodeLinker: node-modules`, because Yarn 4's default Plug'n'Play makes
  `tsx` and ad-hoc scripts brittle.

## Consequences

- The load path requires Redis; the runner cannot target a server on the in-memory store.
- The runner drives real encryption, so a green load run is evidence about the server and
  about `session-core`. It is not evidence about the browser client, which encrypts nothing
  today (`docs/STATUS.md`, P1-A).
- The pass criteria are weaker than the spec's: no latency budget, no pause-before-RSS
  assertion, no memory measurement. Adding them is P2-A. The 2026-09-14 weekly run reported
  `pauses=0` at 100 VUs — a fact the runner surfaces and does not judge.
- One Node process runs every virtual user on `setInterval` timers, so the achieved frame
  rate is slightly below the nominal one (291,817 frames across 100 users in 60 s is about
  48.6 frames per second each). The summary carries `frames_sent`, so the achieved rate is
  derivable.
- Prose that still says "k6" (`AGENTS.md`, `.agents/audio-reviewer.md`) is stale by this
  record and is corrected by P0-A.
