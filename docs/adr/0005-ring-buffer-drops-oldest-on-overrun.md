# 0005 · The capture ring buffer is bounded and drops the oldest frame

**Status:** accepted
**Date:** 2026-04-12
**Recorded in:** commit `0d1cdef` (`feat(voice-client)`), the header comment of
`apps/voice-client/public/worklets/capture-processor.js`, and `.context/architecture.md`
("Crash-safety and reconnection").

## Context

The producer is an `AudioWorkletProcessor` on the audio rendering thread. It is called with
128-sample blocks on a hard real-time cadence and must not allocate, block, or wait on the
main thread. The consumer is the main thread, polling on `requestAnimationFrame`. The two
share memory through a `SharedArrayBuffer`, which is why the page must be cross-origin
isolated (COOP/COEP).

## Decision

A lock-free single-producer/single-consumer ring of four 320-sample `Float32` frames, with
two `Int32` cursors advanced by `Atomics`. When the writer catches the reader (four frames
unread), the worklet advances the read cursor by one — dropping the oldest frame — and
writes. In the words of the source: "backpressure is the main thread's job, not the
worklet's."

## Consequences

- The client buffers at most 80 ms of audio. The worklet never blocks and never grows, which
  is the property the audio thread needs.
- Whenever the main thread stops consuming — a server `voice.pause`, a throttled or
  backgrounded tab, a slow encoder — audio older than 80 ms is discarded silently. The
  sentence in `.context/backpressure.md` that the client "continues capturing into its ring
  buffer" during a pause is true for 80 ms. The 25 seconds of headroom that file computes from
  the server threshold exists on the server side only. Deciding what the client should do
  with audio during a pause — buffer more, drop and say so, or signal the user — is part of
  P1-B.
- The contract is checkable in Node with a two-line `AudioWorkletProcessor` shim: on
  2026-09-15, seven writes into the four-slot ring read back frames 4, 5, 6 and 7. No
  committed test exercises it yet (`docs/STATUS.md`).

## References

- W3C Web Audio API, AudioWorklet (128-frame render quantum)
- ECMAScript `SharedArrayBuffer` and `Atomics`
