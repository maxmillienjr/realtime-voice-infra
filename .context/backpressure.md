# Backpressure

## Failure mode

Without backpressure, a slow STT adapter causes unbounded growth of the
per-session frame queue on the server. With 100 concurrent sessions at 50
frames/s and ~200 B per encoded + encrypted frame, sustained backlog of even
a few seconds exhausts a 512 MB container.

## Protocol

- `pendingBytes` counter per session.
- `pendingBytes > BACKPRESSURE_THRESHOLD` (default 256 KB) ⇒ emit `voice.pause`.
- Client clears its emit loop, continues capturing into its ring buffer.
- `pendingBytes < BACKPRESSURE_RESUME_THRESHOLD` (default 64 KB) ⇒ emit `voice.resume`.
- Two thresholds create hysteresis and prevent pause/resume flapping.

## Why these numbers

At 200 B/frame and 50 fps, 256 KB ≈ 25 seconds of audio — comfortable head
room for a lagging STT endpoint to recover without dropping frames. The 64 KB
resume threshold (~6 seconds) ensures the pending queue is meaningfully
drained before the client resumes, not just transiently below threshold.

## Implementation

`apps/stream-server/src/backpressure.ts` — `BackpressureTracker` with
hysteresis. `BackpressureTracker.test.ts` proves the transition rules.
