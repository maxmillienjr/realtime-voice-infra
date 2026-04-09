# realtime-voice-infra — Product Requirements Document

**Version:** 1.0.0
**Date:** 2026-04-09
**Status:** Final

---

## 1. Executive Summary

`realtime-voice-infra` is a reference transport architecture for voice-AI agents: a production-grade, end-to-end audio pipeline that captures microphone input via the browser's AudioWorklet API, encodes it to Opus, streams it over a backpressure-aware Socket.io channel, and delivers decrypted PCM frames to stub downstream adapters (STT, agent, TTS). It exists because voice-AI engineering teams routinely under-invest in the transport layer — treating it as solved plumbing — until they hit buffer overruns under load, silent IV collisions in encrypted sessions, or AudioContext sample-rate mismatches that corrupt every downstream transcript. This repository documents the patterns that prevent those failures, packaged as a runnable, well-tested monorepo that a team can fork and adapt rather than rediscover from first principles.

---

## 2. Non-Goals

- **Not a full voice agent.** No speech-to-text engine, no LLM, and no text-to-speech engine are bundled. Stub adapters prove the interface shape only.
- **Not a media server replacement.** This is not competing with LiveKit, Daily, Agora, or any SFU/MCU. It handles point-to-point agent sessions, not multi-party conferencing.
- **Not a WebRTC implementation.** Socket.io is chosen deliberately for its simplicity, predictable backpressure model, and operational familiarity. The README explains this tradeoff honestly.
- **Not a production deployment guide.** The `docker-compose.yml` is for local development. TLS termination, horizontal scaling, and cloud networking are out of scope.

---

## 3. Repository Structure

The repository is a Yarn workspaces monorepo. All packages use strict TypeScript.

```
realtime-voice-infra/
├── apps/
│   ├── stream-server/          # Node.js 20 + Socket.io 4 transport backend
│   └── voice-client/           # Angular 21 SPA — AudioWorklet capture demo
├── packages/
│   ├── audio-codec/            # PCM ↔ Opus encoder/decoder (WASM-backed via libopus)
│   ├── session-core/           # Session lifecycle, JWT auth, AES-256-GCM encryption
│   └── shared-types/           # Zod schemas for all wire-protocol messages
├── .context/                   # Project-level context docs for AI agents
│   ├── architecture.md
│   ├── backpressure.md
│   └── crypto.md
├── .agents/                    # Specialized AI agent definitions
│   ├── audio-reviewer.md
│   └── test-author.md
├── mcp-config/                 # MCP server configuration stubs
│   └── mcp-config.json
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── e2e.yml
│       ├── load.yml
│       └── release.yml
├── CLAUDE.md                   # Claude Code project instructions
├── AGENTS.md                   # Agent capability manifest
├── docker-compose.yml          # Redis, stream-server, adminer
├── package.json                # Workspace root
└── README.md
```

### Package Dependency Graph

```
voice-client  ──► audio-codec
voice-client  ──► session-core
voice-client  ──► shared-types
stream-server ──► audio-codec
stream-server ──► session-core
stream-server ──► shared-types
audio-codec   ──► (no internal deps)
session-core  ──► shared-types
```

### Technology Decisions

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 20 LTS | LTS stability; native `crypto.subtle` for HKDF |
| Transport | Socket.io 4 | Reliable framing, rooms, built-in reconnect, backpressure via `socket.emit` return value |
| Frontend | Angular 21 standalone + signals | Demonstrates production Angular patterns; signals replace Zone.js for perf-sensitive audio UI |
| Codec wrapper | WASM libopus | Portable, audited, consistent behavior across platforms |
| Schema validation | Zod 3 | Runtime + compile-time type safety; no separate JSON Schema maintenance |
| Session state | Redis 7 | Ephemeral session keys survive stream-server restarts within a grace period |
| Crypto | AES-256-GCM via WebCrypto / Node crypto.subtle | Native, constant-time, audited |

---

## 4. AudioWorklet Capture Pipeline

### 4.1 getUserMedia Constraints

```typescript
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    sampleRate: 16000,
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
});
```

**Note:** `sampleRate` is a hint, not a guarantee. The actual `AudioContext.sampleRate` must be read back and used for all downstream calculations. If the device returns 48 kHz, the worklet resamples internally to 16 kHz before framing.

### 4.2 AudioContext Initialization

```typescript
const context = new AudioContext({ sampleRate: 16000 });
await context.audioWorklet.addModule('/worklets/capture-processor.js');
const source = context.createMediaStreamSource(stream);
const workletNode = new AudioWorkletNode(context, 'capture-processor', {
  processorOptions: { frameSizeMs: 20 },
  outputChannelCount: [1],
});
source.connect(workletNode);
```

### 4.3 AudioWorkletProcessor (capture-processor.js)

Runs in the isolated Audio Worklet thread. Key invariants:

- **Frame size:** 20 ms × 16,000 Hz = **320 samples** per frame. This is the Opus recommended minimum.
- **Ring buffer:** A `SharedArrayBuffer` of capacity `4 × 320 × 4` bytes (4 frames, Float32) with two `Int32Array` cursors (read head, write head) for lock-free producer/consumer communication.
- **process() contract:** The Web Audio API delivers 128-sample blocks. The processor accumulates blocks until a full 320-sample frame is available, then writes it to the ring buffer and advances the write cursor atomically via `Atomics.store`.

```
Audio Worklet Thread          |  Main Thread
                              |
getUserMedia → AudioContext   |
  → AudioWorkletProcessor     |
      accumulate 128-sample   |
      Web Audio blocks        |
      → write 320 samples     |
        to SharedArrayBuffer  |
        (Atomics.store)       |  poll / requestAnimationFrame
                              |  → Atomics.load read cursor
                              |  → read 320 samples
                              |  → audio-codec: PCM → Opus
                              |  → session-core: encrypt frame
                              |  → socket.emit('voice.frame', buffer)
```

### 4.4 SharedArrayBuffer Requirements (COOP/COEP)

`SharedArrayBuffer` requires the page to be cross-origin isolated. The stream-server (and any reverse proxy in front of voice-client) **must** serve these headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The Angular dev server configuration and the `docker-compose.yml` Nginx block for voice-client both set these headers. A missing header causes `new SharedArrayBuffer(...)` to throw — the client detects this and surfaces an error in the connection status signal.

### 4.5 Main Thread Frame Consumer

The main thread uses `requestAnimationFrame` (not `setInterval`) to poll the ring buffer, ensuring the read loop is throttled to display-frame rate rather than running in a busy loop:

```typescript
private consumeFrames = () => {
  while (this.ringBuffer.framesAvailable > 0) {
    const pcm = this.ringBuffer.read(); // Float32Array[320]
    const opus = this.codec.encode(pcm);
    const encrypted = this.session.encryptFrame(opus, this.sequence++);
    if (!this.paused) {
      this.socket.emit('voice.frame', encrypted);
    }
  }
  requestAnimationFrame(this.consumeFrames);
};
```

### 4.6 Angular 21 UI Signals

| Signal | Type | Source |
|---|---|---|
| `connectionStatus` | `'disconnected' \| 'connecting' \| 'connected' \| 'error'` | Socket.io lifecycle events |
| `frameCounter` | `number` | Incremented on each `voice.ack` |
| `backpressureActive` | `boolean` | Set on `voice.pause`, cleared on `voice.resume` |
| `waveformData` | `Float32Array` | Sampled from ring buffer for canvas render |

All signals are `signal<T>()` primitives; the waveform component uses `effect()` to imperatively draw to a `<canvas>` without triggering Angular change detection.

---

## 5. Socket.io Transport Specification

### 5.1 Namespace and Rooms

- **Namespace:** `/voice`
- **Room:** `session:<session_id>` — each authenticated client joins exactly one room on connect.
- The HTTP handshake carries an `Authorization: Bearer <jwt>` header. The server validates the JWT in a Socket.io middleware before `connection` fires. Unauthenticated connections are rejected with code `4001`.

### 5.2 Event Catalog

#### Client → Server

| Event | Payload | Description |
|---|---|---|
| `voice.frame` | `Buffer` (binary) | Opus-encoded, AES-256-GCM encrypted audio frame. Contains: 12-byte IV prefix + ciphertext + 16-byte GCM auth tag. |
| `voice.control` | `{ type: 'start' \| 'stop' \| 'flush', session_id: string }` | Session lifecycle control. `flush` drains the server-side buffer without stopping. |

#### Server → Client

| Event | Payload | Description |
|---|---|---|
| `voice.ack` | `{ sequence: number, received_at: number }` | Per-frame acknowledgement. Client uses sequence gaps to detect loss. |
| `voice.error` | `{ code: string, message: string, sequence?: number }` | Structured error. Codes: `AUTH_FAILED`, `SEQUENCE_GAP`, `DECRYPT_FAILED`, `BUFFER_OVERFLOW`. |
| `voice.tts` | `Buffer` (binary) | Downstream TTS audio frame (from stub TTS adapter), same binary envelope as `voice.frame`. |
| `voice.pause` | `{ buffer_bytes: number, threshold_bytes: number }` | Backpressure signal. Client MUST stop emitting `voice.frame` immediately. |
| `voice.resume` | `{ buffer_bytes: number }` | Backpressure cleared. Client MAY resume emitting. |

### 5.3 Backpressure Protocol

**Why this matters:** The #1 cause of voice-infra OOM crashes under load is unbounded frame accumulation on the server when a downstream adapter (STT, agent) is slower than the ingest rate. Without backpressure, a 100-session load test can exhaust 512 MB in under 60 seconds.

**Mechanism:**

1. The stream-server maintains a per-session `pendingBytes` counter.
2. When `pendingBytes > BACKPRESSURE_THRESHOLD` (default: 256 KB, configurable via env), the server emits `voice.pause` to the client.
3. The client sets `backpressureActive = true` and stops calling `socket.emit('voice.frame', ...)`. Frames continue to be captured and buffered in the ring buffer (up to ring buffer capacity).
4. When `pendingBytes < BACKPRESSURE_RESUME_THRESHOLD` (default: 64 KB), the server emits `voice.resume`.
5. The client clears `backpressureActive` and resumes emission.

Both thresholds are configurable. The `voice.pause` payload includes the current and threshold bytes for observability.

### 5.4 Sequence Numbers

- Every `voice.frame` binary envelope includes a 4-byte big-endian sequence number at bytes 0–3, before the IV.
- Full frame binary layout: `[seq: 4 bytes][iv: 12 bytes][ciphertext: variable][tag: 16 bytes]`
- The server validates that `seq === session.expectedSequence`. On gap detection, the server emits `voice.error({ code: 'SEQUENCE_GAP', sequence: received })` and increments the `dropped_frames` OTel counter. It does not close the session — gaps are recoverable.
- Base64 encoding is never used. All binary frames are emitted as `Buffer`/`ArrayBuffer` directly, eliminating ~33% overhead.

---

## 6. Session-Scoped Encryption

### 6.1 Session Initialization Flow

```
Client                        Server (/session/init HTTP)
  |                                |
  |── POST /session/init ─────────►|
  |   { client_pubkey_b64 }        | (optional future: ECDH upgrade)
  |                                | 1. generate session_id (UUID v4)
  |                                | 2. generate session_key (32 random bytes)
  |                                | 3. store session_key in Redis (TTL: 1h)
  |                                | 4. sign JWT
  |◄── { jwt, session_id } ───────|
  |                                |
  |── Socket.io connect ──────────►|
  |   Authorization: Bearer <jwt>  | 5. verify JWT
  |                                | 6. load session_key from Redis
  |◄── connected ─────────────────|
```

### 6.2 JWT Claims

```typescript
interface SessionJWT {
  iss: 'realtime-voice-infra';       // issuer
  sub: string;                        // session_id (UUID v4)
  iat: number;                        // issued-at (Unix seconds)
  exp: number;                        // expiry = iat + 300 (5 minutes)
  jti: string;                        // UUID v4, single-use nonce (stored in Redis until exp)
  scope: 'voice:stream';             // capability scope
}
```

JWTs are signed with HS256 using a server-side secret (`JWT_SECRET` env var, min 32 bytes). The `jti` claim is checked against Redis on each Socket.io connect to prevent replay. After successful connection, the JWT is no longer accepted (one-time use).

### 6.3 Key Derivation (HKDF)

The `session_key` (32 random bytes from `crypto.randomBytes(32)`) is the HKDF input keying material. A per-frame subkey is derived as:

```
frame_key = HKDF-SHA256(
  ikm  = session_key,
  salt = session_id (UTF-8 bytes),   // 36 bytes for UUID
  info = "voice-frame-v1",
  length = 32
)
```

**Architectural decision:** A single `frame_key` is derived per session (not per frame) because the per-frame IV construction (below) already provides nonce uniqueness. Per-frame HKDF calls would add ~0.1 ms/frame overhead with no security benefit given AES-GCM's nonce-based security model.

### 6.4 IV Construction

AES-256-GCM requires a 96-bit (12-byte) IV. IVs must never be reused under the same key.

```
iv[0..3]   = sequence number (big-endian uint32)
iv[4..11]  = first 8 bytes of SHA-256(session_id)
```

This construction guarantees IV uniqueness as long as sequence numbers are unique within a session. The 8-byte session fingerprint in `iv[4..11]` prevents cross-session IV collisions if the same sequence number appears in two sessions encrypted with different keys.

### 6.5 Sequence Rollover

The sequence number is a uint32, allowing 2³² − 1 ≈ 4.29 billion frames. At 20 ms/frame, rollover occurs after ~994 days of continuous streaming. For safety, if `sequence === 0xFFFFFFFF`, the server emits `voice.control({ type: 'stop' })` and forces session re-initialization. A unit test asserts this behavior. IV reuse at rollover is treated as a hard failure.

### 6.6 Frame Encryption (Client Side)

```typescript
async function encryptFrame(opus: Uint8Array, sequence: number): Promise<ArrayBuffer> {
  const iv = buildIV(sequence, sessionFingerprint);    // 12 bytes
  const seqBytes = uint32ToBytes(sequence);            // 4 bytes
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    frameKey,
    opus
  );
  // wire format: [seq 4B][iv 12B][ciphertext+tag variable]
  return concat(seqBytes, iv, ciphertext);
}
```

### 6.7 Frame Decryption (Server Side)

The server uses Node.js `crypto.createDecipheriv('aes-256-gcm', ...)`. If GCM authentication fails (tampered ciphertext or wrong key), the server emits `voice.error({ code: 'DECRYPT_FAILED' })` and drops the frame. It does not close the session on a single failure; three consecutive failures trigger session termination.

---

## 7. Cross-Cutting Concerns (stream-server)

### 7.1 Zod Validation

All `voice.control` payloads are validated against a Zod schema before processing. Invalid payloads emit `voice.error({ code: 'VALIDATION_FAILED', ... })` and are dropped. Binary `voice.frame` payloads are validated structurally (minimum length check for seq + iv + tag) before decryption is attempted.

```typescript
const VoiceControlSchema = z.object({
  type: z.enum(['start', 'stop', 'flush']),
  session_id: z.string().uuid(),
});
```

### 7.2 Structured Logging

All log entries are JSON (via `pino`). Every log entry carrying session or frame context includes:

```json
{
  "level": "info",
  "time": 1712600000000,
  "session_id": "uuid-v4",
  "frame_sequence": 1042,
  "msg": "frame received"
}
```

Correlation ID (`session_id`) is injected via `AsyncLocalStorage` at Socket.io middleware level so it propagates through all async call chains without manual threading.

### 7.3 OpenTelemetry

Each session produces one OTel span (`voice.session`) with the following metrics:

| Counter | Description |
|---|---|
| `voice.frames_received` | Total frames received in session |
| `voice.bytes_received` | Total bytes received in session |
| `voice.pause_events` | Number of backpressure pause events |
| `voice.dropped_frames` | Frames dropped (decrypt failure or sequence gap) |
| `voice.session_duration_ms` | Session wall time |

Spans are exported via OTLP to `OTEL_EXPORTER_OTLP_ENDPOINT` (default: `http://localhost:4318`). The `docker-compose.yml` includes an optional Jaeger service stub.

### 7.4 Graceful Shutdown

On `SIGTERM`, the stream-server:

1. Stops accepting new Socket.io connections (closes the HTTP upgrade handler).
2. Emits `voice.control({ type: 'stop' })` to all active sessions.
3. Waits up to `SHUTDOWN_GRACE_MS` (default: 10,000) for sessions to drain.
4. Force-closes remaining sessions and exits with code 0.

The grace period is configurable to allow Kubernetes rolling deployments with a `preStop` hook.

### 7.5 Health Endpoints

| Path | Method | Response |
|---|---|---|
| `GET /healthz` | GET | `200 OK` — process alive |
| `GET /readyz` | GET | `200 { active_sessions: N }` or `503` if Redis unreachable |

`/readyz` returns 503 if the Redis connection is down, causing Kubernetes to withhold traffic during Redis failover.

---

## 8. Stub Downstream Adapters

All stub adapters live in `apps/stream-server/src/adapters/`. They are clearly labeled with `// STUB IMPLEMENTATION` headers and not imported by default — integration requires explicit wiring in `session-router.ts`.

### 8.1 STT Adapter Interface

```typescript
// packages/shared-types/src/adapters.ts
export interface STTAdapter {
  /** Feed a decrypted PCM frame (Float32, 16 kHz, mono) */
  pushFrame(sessionId: string, pcm: Float32Array): void;
  /** Subscribe to partial transcripts */
  onTranscript(sessionId: string, handler: (text: string, isFinal: boolean) => void): void;
  endSession(sessionId: string): Promise<void>;
}
```

**Stub — EchoSTT:** Returns `"[frame N received]"` as a partial transcript on every 10th frame. Demonstrates the callback interface without audio processing.

**To adapt for Deepgram:** Stream decrypted PCM to `@deepgram/sdk` `LiveClient`, map `transcript` events to the `onTranscript` callback.

### 8.2 TTS Adapter Interface

```typescript
export interface TTSAdapter {
  /** Synthesize text to PCM frames */
  synthesize(sessionId: string, text: string): AsyncIterable<Float32Array>;
}
```

**Stub — SilenceTTS:** Emits 50 frames of silence (1 second at 20 ms/frame) for any input. The stream-server encodes these frames and emits them as `voice.tts` events.

**To adapt for ElevenLabs:** Wrap the ElevenLabs streaming synthesis endpoint; yield decoded PCM chunks as `Float32Array[320]` frames.

### 8.3 Agent Adapter Interface

```typescript
export interface AgentAdapter {
  /** Process a final transcript and return a response */
  respond(sessionId: string, transcript: string): Promise<string>;
}
```

**Stub — EchoAgent:** Returns `"Echo: " + transcript`. Confirms the full STT → Agent → TTS pipeline without LLM latency.

**To adapt for OpenAI:** Call `chat.completions.create` with the transcript as the user message; return `choices[0].message.content`.

---

## 9. CI/CD Pipeline

### 9.1 `ci.yml` — Lint, Typecheck, Unit Test, Build

Triggers: `push` to any branch, `pull_request` to `main`.

```
jobs:
  lint      → eslint + prettier --check across all workspaces
  typecheck → tsc --noEmit for all packages
  test      → vitest run (unit tests only, no external services)
  build     → yarn workspaces foreach run build
```

Matrix: Node.js 20 and 22. All jobs must pass before merge.

### 9.2 `e2e.yml` — Playwright End-to-End

Triggers: `push` to `main`, `pull_request` to `main`.

```
services: redis (docker)
steps:
  1. yarn install
  2. build all packages
  3. start stream-server (background)
  4. start voice-client dev server (background, with COOP/COEP headers)
  5. playwright test
     - navigate to voice-client
     - inject fake MediaStream (synthetic 440 Hz tone, 16 kHz PCM)
     - click "Start Streaming"
     - assert frameCounter signal > 10 within 5 seconds
     - assert no voice.error events received
     - click "Stop Streaming"
     - assert connectionStatus returns to 'connected'
```

### 9.3 `load.yml` — k6 Backpressure Load Test

Triggers: `workflow_dispatch`, weekly schedule.

```
steps:
  1. start stack via docker compose
  2. k6 run scripts/load/backpressure.js \
       --vus 100 \
       --duration 60s \
       --env STREAM_SERVER_URL=http://localhost:3000
  3. assert: p95 frame ACK latency < 200 ms
  4. assert: voice.pause events observed before RSS > 512 MB
  5. assert: no voice.error BUFFER_OVERFLOW events
  6. upload k6 summary as artifact
```

The k6 script uses the `k6/experimental/websocket` module to simulate 100 concurrent Socket.io sessions, each emitting synthetic Opus frames at 50 frames/second (20 ms cadence).

### 9.4 `release.yml` — Semantic Release + GHCR Push

Triggers: `push` to `main` with conventional commits.

```
steps:
  1. semantic-release (analyzes commits, bumps version, generates CHANGELOG)
  2. docker build stream-server → ghcr.io/<owner>/realtime-voice-infra/stream-server:<tag>
  3. docker push to GHCR
  4. create GitHub Release with CHANGELOG extract
```

---

## 10. Agentic Context System

### 10.1 CLAUDE.md

Root-level instructions for Claude Code:

- Monorepo layout overview
- How to run tests: `yarn test`, `yarn test:e2e`
- How to run the stack: `docker compose up`
- Key invariants: never commit real audio fixtures, never disable COOP/COEP headers, never base64-encode binary frames
- Pointer to `.agents/` for specialized reviewers

### 10.2 AGENTS.md

Capability manifest listing available subagents, their trigger conditions, and what they review.

### 10.3 `.context/` Directory

| File | Purpose |
|---|---|
| `architecture.md` | End-to-end data flow narrative, annotated with frame sizes and timing budgets |
| `backpressure.md` | Backpressure protocol detail; explains the OOM failure mode and the threshold math |
| `crypto.md` | IV construction, HKDF derivation, sequence rollover policy, threat model |

### 10.4 `.agents/audio-reviewer.md`

**Purpose:** PR review agent for audio and security correctness.

**Reviews for:**
- Buffer size changes: any modification to `frameSizeMs` or ring buffer capacity must justify the impact on latency and codec alignment.
- Backpressure regressions: checks that `BACKPRESSURE_THRESHOLD` is not removed or increased without a corresponding load test result.
- IV reuse risk: flags any change to IV construction logic, sequence number handling, or key derivation; requires a crypto round-trip unit test.
- COOP/COEP regressions: ensures `SharedArrayBuffer` header requirements are preserved in all server and dev-server configurations.

### 10.5 `.agents/test-author.md`

**Purpose:** Generates unit and integration tests for new adapter implementations and protocol changes.

**Scope:**
- Given an adapter interface implementation, generates vitest unit tests with synthetic PCM fixtures.
- Given a new Socket.io event, generates integration test stubs using `socket.io-client`.
- Ensures crypto round-trip tests (encrypt → decrypt) accompany any `session-core` changes.

---

## 11. Testing Strategy

### 11.1 Unit Tests (`packages/audio-codec`)

- Encode a known 320-sample sine wave to Opus; verify output length is within expected Opus frame size range.
- Decode the encoded frame back to PCM; verify RMSE against original is below a threshold (lossy codec tolerance: < 0.05).
- Verify that encoding 160-sample (10 ms) or 480-sample (30 ms) frames works correctly (Opus supports multiple frame sizes).
- Fixtures: synthetically generated PCM (440 Hz tone) — no real audio samples.

### 11.2 Unit Tests (`packages/session-core`)

- Crypto round-trip: encrypt a known Opus frame, decrypt it, assert byte-for-byte equality.
- IV uniqueness: generate 1,000 consecutive IVs for a session; assert all are distinct.
- IV reuse on rollover: assert that `sequence === 0xFFFFFFFF` triggers a session termination error rather than wrapping to 0.
- JWT sign and verify: assert that an expired JWT is rejected; assert that a replayed `jti` is rejected.
- HKDF determinism: same inputs produce same `frame_key` across calls.

### 11.3 Integration Tests (`apps/stream-server`)

- Start stream-server in-process using `vitest`'s Node environment.
- Connect with `socket.io-client` using a valid JWT from `/session/init`.
- Push 100 synthetic Opus frames; assert 100 `voice.ack` events received in order.
- Push frames faster than the stub adapter can consume; assert `voice.pause` fires before 100 queued frames.
- Push a frame with a corrupt GCM auth tag; assert `voice.error({ code: 'DECRYPT_FAILED' })`.
- Push frames with a sequence gap (skip seq 50); assert `voice.error({ code: 'SEQUENCE_GAP' })`.

### 11.4 E2E Tests (`apps/voice-client`)

- Playwright test using a fake `MediaStream` (injected via `page.addInitScript`) with a 440 Hz synthetic tone at 16 kHz.
- Full happy-path flow: connect → start → receive 10+ ACKs → stop.
- Backpressure UI: programmatically trigger `voice.pause` from the server; assert `backpressureActive` signal is reflected in the UI indicator.
- COOP/COEP absence: serve voice-client without isolation headers; assert the client surfaces a `SharedArrayBuffer not available` error in the UI.

### 11.5 Load Tests (`scripts/load/`)

- k6 script: 100 virtual users, each authenticating, connecting, and streaming at 50 frames/second for 60 seconds.
- Pass criteria:
  - `voice.pause` events observed in k6 metrics before `stream_server` RSS exceeds 512 MB.
  - No `voice.error({ code: 'BUFFER_OVERFLOW' })` events.
  - p95 ACK round-trip < 200 ms.

---

## 12. README Specification

The README must contain the following sections, in order:

### Hero

```
# realtime-voice-infra

Production-grade transport layer for voice agents: AudioWorklet capture,
backpressure-aware Socket.io streaming, and session-scoped encryption.
```

Followed by CI badge, license badge, and a one-paragraph pitch matching the Executive Summary.

### Architecture Diagram

Mermaid `flowchart LR` diagram showing:

```
Browser (AudioWorklet) → [Ring Buffer] → Main Thread → [audio-codec: Opus] → [session-core: AES-GCM] → Socket.io /voice → stream-server → [STT Stub] → [Agent Stub] → [TTS Stub] → Socket.io voice.tts → Browser
```

With Redis shown as the session state store for stream-server.

### Why Socket.io and Not WebRTC

An honest engineering tradeoff section covering:

- **Latency:** WebRTC ICE + DTLS adds 200–500 ms setup; Socket.io connects in one HTTP upgrade round-trip.
- **Complexity:** WebRTC requires STUN/TURN infrastructure, SDP negotiation, and codec negotiation that is irrelevant for half-duplex agent sessions.
- **Backpressure:** WebRTC's RTCP feedback loop was designed for video conferencing, not server-side buffer management. Socket.io gives direct control.
- **Operations:** Socket.io connections are inspectable with standard HTTP tools; WebRTC requires specialized debugging (chrome://webrtc-internals).
- **When to choose WebRTC instead:** Full-duplex, sub-100 ms latency, peer-to-peer, or multi-party — use LiveKit or Daily.

### Quickstart

```bash
yarn install
docker compose up          # Redis, stream-server, adminer
# In a second terminal:
yarn workspace voice-client start
# Open http://localhost:4200, grant mic permission
```

### AudioWorklet Pipeline Explainer

Prose description of the 128-sample → 320-sample accumulation, ring buffer write, main thread read, encode, encrypt, emit cycle. Include a Mermaid sequence diagram of one frame's lifecycle.

### Backpressure Explainer

Mermaid sequence diagram:

```
Client → Server: voice.frame (seq 1..N)
Server → Client: voice.pause (buffer_bytes: 262144)
Client: stops emitting
Server: adapter drains buffer
Server → Client: voice.resume (buffer_bytes: 32768)
Client: resumes emitting
```

With prose explanation of the OOM failure mode.

### How to Adapt This to Your Stack

Table mapping each stub adapter to a real vendor SDK:

| Stub | Real Integration | Notes |
|---|---|---|
| EchoSTT | Deepgram `LiveClient` | Stream decrypted PCM; map `transcript` events |
| SilenceTTS | ElevenLabs streaming | Yield PCM chunks as `Float32Array[320]` |
| EchoAgent | OpenAI `chat.completions` | Pass final transcript as user message |

### COOP/COEP Note

Explicit callout box (blockquote) warning that `SharedArrayBuffer` requires cross-origin isolation headers, with the exact header values and a pointer to the dev server and Nginx configurations that set them.

---

## 13. Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| AC-1 | `yarn install && yarn build` succeeds on a clean clone with no environment variables set | CI `ci.yml` build job |
| AC-2 | `docker compose up` brings Redis, stream-server, and voice-client online in under 60 seconds on a developer laptop | Manual + E2E setup step |
| AC-3 | Opening voice-client in Chrome, granting mic, and speaking produces frame ACKs visible in the Angular UI's frame counter | Playwright E2E happy-path test |
| AC-4 | k6 load test with 100 concurrent sessions causes `voice.pause` to engage before RSS exceeds 512 MB | `load.yml` workflow |
| AC-5 | A unit test that deliberately passes `sequence === 0xFFFFFFFF - 1` then `0xFFFFFFFF` fails unless session termination is triggered | `session-core` unit test suite |
| AC-6 | A unit test that attempts to reuse an IV (same sequence, same session) fails authentication on decrypt | `session-core` crypto round-trip test |
| AC-7 | All four CI workflows (`ci.yml`, `e2e.yml`, `load.yml`, `release.yml`) are green on first push to a clean fork | GitHub Actions |
| AC-8 | Serving voice-client without COOP/COEP headers causes the client to display a `SharedArrayBuffer not available` error rather than crashing silently | Playwright error-path test |

---

## 14. Sanitization Checklist

Before any commit to the public repository, verify:

- [ ] No references to "Quiet Horizons" in any file (code, comments, commit messages, docs).
- [ ] No references to real medical use cases, patient audio, or clinical contexts.
- [ ] No real voice samples in test fixtures — only synthetically generated PCM (sine tones, silence, noise) or files explicitly licensed as public domain.
- [ ] No references to real STT/TTS/LLM vendor API keys. All adapter configuration uses placeholder values (`YOUR_DEEPGRAM_API_KEY`, etc.).
- [ ] No internal hostnames, IP addresses, or cloud resource identifiers.
- [ ] No real session IDs or frame logs from production systems.
- [ ] All `.env.example` files use placeholder values only.
- [ ] `git log --all --full-history -- "**/*.env"` returns empty (no accidentally committed secrets).
- [ ] No internal Slack channels, Jira projects, or employee names in comments or docs.
