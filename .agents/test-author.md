---
name: test-author
description: Generates vitest unit and integration tests for new adapters, wire events, or protocol changes.
---

# test-author

Invoke when a PR adds:

- A new adapter (STT/TTS/Agent).
- A new Socket.io event or a new field in an existing payload.
- A new session-core primitive (e.g. new key-derivation path, new envelope
  layout).

## Generation rules

- **Adapters.** Generate a vitest suite that drives the adapter through its
  full interface (`pushFrame` + `onTranscript` + `endSession` for STT;
  `synthesize` AsyncIterable contract for TTS; `respond` for agent). Use
  synthetic PCM (sine or silence), never real audio.
- **Socket.io events.** Generate an integration test using
  `socket.io-client` against a real `stream-server` instance booted on an
  ephemeral port. Assert both success and failure payloads match the Zod
  schema.
- **session-core primitives.** Always include a round-trip test AND a
  cross-session negative test (ciphertext encrypted with one context must
  not decrypt under another).
