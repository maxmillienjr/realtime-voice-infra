# 0001 · Socket.io over WebRTC for half-duplex agent sessions

**Status:** accepted
**Date:** 2026-04-12
**Recorded in:** `README.md` ("Why Socket.io and not WebRTC"), written in commit `ca2998d`;
restated as a non-goal in the original build spec at `753af3b:PRD.md` §2.

## Context

The system carries one browser microphone to one server, which decrypts each frame,
acknowledges it, and — once adapters are wired — hands PCM to speech-to-text. Audio flows in
one direction at a time. The server, not the network, decides when the client must slow
down, because the bottleneck the design guards against is a downstream adapter that consumes
frames more slowly than they arrive.

The two candidate transports were WebRTC (ICE, DTLS, SRTP, RTCP feedback, a media stack
designed for conferencing) and Socket.io over a single WebSocket upgrade.

## Decision

Use Socket.io, on the `/voice` namespace, with audio frames as binary events. The README
gives four reasons and they are the record:

- **Latency of setup.** ICE plus DTLS adds 200–500 ms before the first frame; Socket.io
  connects in one HTTP upgrade round trip.
- **Complexity.** No STUN/TURN, no SDP, no codec negotiation. None of it is needed for a
  half-duplex agent session.
- **Backpressure.** The server observes its own per-session queue and drives the client with
  an application-level `voice.pause` / `voice.resume` protocol. RTCP was designed for
  conferencing feedback, not for server-side buffer management.
- **Operations.** Plain HTTP tooling inspects the connection; there is no
  `chrome://webrtc-internals`.

The README also names the cases where the decision is wrong: full-duplex sub-100 ms audio,
peer-to-peer, or multi-party. For those it points at LiveKit and Daily.

## Consequences

- Sessions are point-to-point and half-duplex by design. Anything conferencing-shaped is out
  of scope, and the README's non-goals say so.
- Confidentiality and integrity are not provided by the transport (no SRTP/DTLS), so they are
  provided at the application layer — which is why `packages/session-core` exists and why
  ADRs 0002 and 0003 were needed.
- Backpressure is a protocol the server must implement and the client must honour, not a
  property inherited from the transport. Whether the server-side half actually fires is a
  question the code answers, not this record; see `docs/STATUS.md` and P1-B.
- The choice is revisited only by measurement. P6-D owns a spike comparing WebTransport and
  WebRTC data channels against this transport on the metrics that motivated the decision.
