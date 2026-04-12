# Architecture

End-to-end data flow for a single half-duplex voice session.

## Timing budget (per 20 ms frame)

| Stage | Budget |
|---|---|
| Web Audio block (128 samples) | ~8 ms each, 2.5 blocks per frame |
| Ring-buffer write (Atomics.store) | < 0.1 ms |
| Opus encode | < 1 ms |
| AES-256-GCM encrypt (12 B IV + 320 B PCM) | < 0.2 ms |
| Socket.io emit (websocket frame) | 1–5 ms |
| Server decrypt + ack | < 1 ms |
| Total client → ack | p95 target < 50 ms LAN, < 200 ms WAN |

## Frame sizes

- Capture: 320 samples × 4 bytes = 1280 B per frame, Float32 PCM.
- Opus payload (real codec, target): 40–120 B typical at 16 kHz, 20 ms.
- Wire envelope: `[seq 4B][iv 12B][ciphertext][tag 16B]`.

## Threads

- **Audio Worklet thread:** isolated, no GC pressure from the main thread,
  no JS heap allocations in the hot path. Uses SAB + Atomics for handoff.
- **Main thread:** rAF consumer, encode/encrypt/emit.
- **Server (single-threaded event loop):** decrypt → (optional adapter) →
  ack. Per-session state keyed on `sessionId`.

## Crash-safety and reconnection (out of scope today)

The ring buffer is bounded (4 frames); on overrun the worklet drops the
oldest slot rather than unbounding the producer. Session reconnect is
currently a full re-`/session/init` — persistent session resumption is a
future-work item.
