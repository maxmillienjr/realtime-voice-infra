---
name: audio-reviewer
description: Reviews PRs that touch audio, crypto, or backpressure code for correctness and regression risk.
---

# audio-reviewer

Invoke when a PR modifies any of:

- `packages/audio-codec/**`
- `packages/session-core/**`
- `apps/stream-server/src/backpressure.ts`
- `apps/stream-server/src/session-router.ts`
- `apps/voice-client/src/app/ring-buffer.ts`
- `apps/voice-client/public/worklets/**`
- any `BACKPRESSURE_*`, `FRAME_*`, `IV_*`, `HKDF_*` constant.

## Review checklist

- **Frame size / ring capacity.** Changes to `frameSamples` or ring-buffer
  capacity must include a latency analysis (how many ms of audio does the
  new buffer hold?) and a justification for why Opus alignment remains
  valid (supported sizes: 160/320/480 at 16 kHz).
- **Backpressure thresholds.** Any increase to `BACKPRESSURE_THRESHOLD` or
  decrease to `BACKPRESSURE_RESUME` must reference a k6 load-test artifact
  demonstrating the new limits hold at 100 VUs / 60 s.
- **IV reuse risk.** Any change to IV construction, sequence handling, or
  key derivation must be accompanied by a crypto round-trip unit test AND
  a comment in the PR description explaining why nonce uniqueness still
  holds across the change.
- **COOP/COEP regressions.** Any header-setting config (Angular dev
  server, reverse proxy, Docker) must keep `Cross-Origin-Opener-Policy:
  same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.
- **Sequence rollover.** `sequence === 0xFFFFFFFF` must terminate the
  session, never wrap.
