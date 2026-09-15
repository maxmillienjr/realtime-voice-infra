---
id: P1-A
title: Client-side frame encryption with WebCrypto, and a way for the client to hold the key
tier: 1
status: draft
size: L
depends_on: []
blocks: [P1-C, P4-B, P3-A]
issue: null
superseded_by: null
---

# P1-A · Client-side frame encryption with WebCrypto, and a way for the client to hold the key

## Problem

The browser client does not encrypt frames, and cannot.

- `app.component.ts:130-133` reads: "encryption happens here in production — pending a
  WebCrypto client-side crypto helper that mirrors session-core. For now emit unencrypted
  against a dev server configured accordingly." `app.component.ts:140-145` builds the frame
  as `[seq 4B][payload]`. No "dev server configured accordingly" exists: `config.ts:30-55`
  has no switch that disables decryption, and `session-router.ts:151-152` calls
  `decryptFrame` on every frame.
- The server's response to that stream was observed on 2026-09-15 against an in-process
  server: `DECRYPT_FAILED` (frame 0; `expectedSequence` stays 0), `SEQUENCE_GAP` (frame 1,
  resync to 2), `DECRYPT_FAILED` (frame 2), `SEQUENCE_GAP` (frame 3), `DECRYPT_FAILED`
  (frame 4), disconnect — `MAX_DECRYPT_FAILURES` at `session-router.ts:33` is 3 and the
  counter only resets on success (`session-router.ts:168`). About 100 ms of audio.
- The client has no key to encrypt with. `/session/init` returns `{ jwt, session_id }`
  (`http.ts:41`); the 32-byte `session_key` is generated at `http.ts:38` and stored at
  `http.ts:39`, and never leaves the server. The original build spec (`753af3b:PRD.md` §6.1)
  showed the same response shape and left key distribution to an "optional future: ECDH
  upgrade" via `client_pubkey_b64`, which `wire.ts:44` accepts and nothing reads.
- The only client that encrypts is the load runner, and it obtains keys by reading the
  server's Redis directly (`load-backpressure.ts:75-79`), a choice ADR 0006 records as
  deliberate to avoid a CI-only endpoint. A green load run is therefore evidence about the
  server and `session-core`, and no evidence about the browser.
- `session-core` cannot be imported by the browser bundle as it stands. `hkdf.ts:1`,
  `iv.ts:1`, `crypto.ts:1` and `packages/session-core/src/jwt.ts:2` import `node:crypto`.
  `apps/voice-client/package.json:20` declares the dependency; nothing in
  `apps/voice-client/src` imports it.
- Consequently no frame from the README quickstart is ever acknowledged, and STATUS row 6 is
  `planned` for the headline feature of the repository.

## Why it matters

"Session-scoped encryption" is one of the three pillars in the first line of the README, and at
HEAD it is a server that can decrypt and no client that encrypts. What application-layer
encryption buys over the `wss://` transport is worth stating precisely, because it is the
reason to do this rather than delete the claim: TLS protects the hop to the first terminating
proxy, while an AEAD frame under a per-session key (RFC 5116 §2; AES-256-GCM per NIST SP
800-38D) stays opaque to every intermediary — a reverse proxy, a Socket.io adapter, a Redis
fan-out — until the process that holds the derived key opens it, and binds each frame to its
session and sequence through the nonce construction in ADR 0002. The W3C Web Cryptography API
provides exactly the three primitives `session-core` uses (`SubtleCrypto.digest` for the
fingerprint, `deriveKey` with HKDF for the frame key, `encrypt` with AES-GCM for the frame),
so the browser can produce byte-identical envelopes without a dependency. The practice this
PRD restores is that the code path tests exercise is the code path production takes: today
the tested encryptor is a Node script and the shipped one is a comment.

## Scope

- A browser-safe entry point in `packages/session-core` that implements the fingerprint,
  HKDF derivation, IV construction and AES-256-GCM frame encryption over WebCrypto, producing
  the same `[seq 4B][iv 12B][ciphertext][tag 16B]` envelope `decryptFrame` expects.
- A key-transport decision and its implementation: `/session/init` returns the session key to
  the client in the response body, base64, over TLS, alongside the JWT it already returns.
- The client encrypts in `consumeFrames`, emits in sequence order despite WebCrypto being
  asynchronous, and treats `DECRYPT_FAILED` from the server as fatal rather than as a counter.
- The load runner takes its key from the init response and stops reading Redis. The
  Redis-read paragraph of ADR 0006 is superseded by a new ADR recording the key-transport
  decision.
- A cross-implementation test suite in Node: envelopes produced by the WebCrypto path
  (Node's `globalThis.crypto.subtle`) decrypt under the existing Node `decryptFrame`, and
  vice versa where applicable.
- `docs/STATUS.md` row 6 moves, `.context/crypto.md` gains a "key transport" paragraph, and
  the README diagram's `AES-GCM` node becomes solid.

### Non-goals

- Key agreement. Returning the key over TLS is key transport; deriving it so that it never
  crosses the wire is ECDH over `client_pubkey_b64`, which is P4-B and depends on this PRD's
  browser-side derivation code.
- In-session rekey and the 2^32 bound — P4-C.
- Real Opus. The payload stays 640 bytes of PCM16 — P6-C.
- A browser test. This PRD makes the happy path possible; P1-C puts a browser in CI to prove
  it. One acceptance criterion below cannot be ticked without P1-C or a recorded manual run,
  and says so.
- Sample-rate handling — P1-D. Frame size is fixed at 320 samples throughout.
- Replay-safe sequence handling on the server — P4-A. This PRD does not touch the router.

## Design

**Package layout.** `session-core` gains a second export with no `node:` imports:

```
packages/session-core/
  src/
    iv.ts              # buildIV(sequence, fingerprint): pure; no node:crypto after the split
    fingerprint.node.ts   sessionFingerprint(sessionId): Buffer            (createHash)
    fingerprint.web.ts    sessionFingerprintWeb(sessionId): Promise<Uint8Array>  (subtle.digest)
    hkdf.ts            # deriveFrameKey (node, unchanged)
    hkdf.web.ts        # deriveFrameKeyWeb(sessionKey, sessionId): Promise<CryptoKey>
    crypto.ts          # encryptFrame / decryptFrame (node, unchanged)
    crypto.web.ts      # encryptFrameWeb(ctx, sequence, plaintext): Promise<Uint8Array>
    web.ts             # barrel for the browser entry
  package.json exports:
    "."      → ./dist/index.js   (node)
    "./web"  → ./dist/web.js     (browser-safe)
```

`buildIV` loses its `node:crypto` import by taking the fingerprint as a parameter, which it
already does; only `sessionFingerprint` needs a web twin. The web derivation is:

```ts
export async function deriveFrameKeyWeb(
  sessionKey: Uint8Array,
  sessionId: string,
): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', sessionKey, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8(sessionId), info: utf8(HKDF_INFO) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
}

export async function encryptFrameWeb(
  ctx: { fingerprint: Uint8Array; frameKey: CryptoKey },
  sequence: number,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const iv = buildIV(sequence, ctx.fingerprint);
  const ctAndTag = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, ctx.frameKey, plaintext),
  );
  // WebCrypto appends the tag; Node's createCipheriv returns it separately. Same bytes.
  return concat(u32be(sequence), iv, ctAndTag);
}
```

**Key transport.** `SessionInitResponseSchema` (`wire.ts:48-51`) gains
`session_key_b64: z.string().base64().length(44)`. `http.ts:41` includes it. The JWT already
travels in this response over the same channel, so the key adds no new exposure class; the
new ADR says this and says that P4-B removes the key from the wire.

**Client loop.** `consumeFrames` stays a synchronous `requestAnimationFrame` loop that assigns
`sequence` synchronously and pushes `(sequence, pcm)` onto a promise chain:

```ts
private tail: Promise<void> = Promise.resolve();
private enqueue(seq: number, pcm: Float32Array): void {
  const opus = this.encoder.encode(pcm);
  this.tail = this.tail.then(async () => {
    const env = await encryptFrameWeb(this.crypto, seq, opus);
    this.socket?.emit('voice.frame', env);
  });
}
```

Chaining on `tail` guarantees emit order equals sequence order even when `subtle.encrypt`
resolves out of order, which the server's monotonic check requires. Backpressure gating moves
from the read loop to `enqueue` so a `voice.pause` stops encryption, not just emission.

**Load runner.** `initSession()` returns the key; `fetchSessionKey` and the `ioredis` import go.
`REDIS_URL` is no longer a runner input.

**Tests** (all in Node, both halves in one process):

- `crypto.web.test.ts`: for 1000 sequences and random 640-byte payloads, `encryptFrameWeb`
  output decrypts under Node `decryptFrame` byte-for-byte; a fingerprint from a different
  session id fails; `sessionFingerprintWeb` equals `sessionFingerprint` for 100 ids.
- `integration.test.ts` gains a case that drives the server with envelopes from the web path
  and receives `voice.ack`.
- A build-time assertion that `dist/web.js` and its imports contain no `node:` specifier.

## Acceptance criteria

- [ ] `packages/session-core` exports `./web`; the built `dist/web.js` and every module it
      imports contain zero `node:` import specifiers (asserted by a test that reads the built
      files).
- [ ] For 1000 consecutive sequences with random 640-byte payloads, `encryptFrameWeb` output
      decrypts byte-for-byte under the existing Node `decryptFrame` (server half, Node
      WebCrypto standing in for the browser's).
- [ ] `sessionFingerprintWeb(id)` equals `sessionFingerprint(id)` for 100 random UUIDs, and
      `deriveFrameKeyWeb` produces a key under which a Node-encrypted frame decrypts (or the
      symmetric check, since the web key is non-extractable).
- [ ] `POST /session/init` returns `session_key_b64` decoding to 32 bytes; `SessionInitResponseSchema`
      requires it; an integration test asserts both (server half).
- [ ] With an injected `subtle.encrypt` delay that resolves even sequences after odd ones, a
      Node simulation of the client loop emits frames in sequence order and the server
      returns no `SEQUENCE_GAP` (server half).
- [ ] The load runner obtains its key from `/session/init` only; `git grep ioredis --
apps/stream-server/scripts` returns nothing; a run at 10 VUs × 10 s against the compose
      stack reports `ack_ratio >= 0.95` and `errors={}`.
- [ ] In a browser with a fake microphone, the frame counter increments and no `voice.error`
      arrives for 10 seconds of synthetic tone (browser half). **Not tickable from Node.**
      Ticked by P1-C's test, or by a recorded manual run whose date and browser version are
      written into this file.
- [ ] `docs/STATUS.md` row 6 is `implemented` with the browser evidence above cited, or stays
      `planned` with the criterion above named as the blocker.
- [ ] A new ADR records the key-transport decision, marks the Redis-read paragraph of ADR 0006
      superseded, and names P4-B as the successor that removes the key from the wire.
- [ ] `.context/crypto.md` gains a "Key transport" section; `README.md`'s diagram shows
      `AES-GCM` on the client path as implemented.
- [ ] `yarn typecheck`, `yarn lint`, `yarn test`, `yarn lint:docs` pass; `npx prettier --check`
      passes on every touched file.

## Risks and open questions

- **The key-transport decision is the owner's, and it may go the other way.** If the answer is
  "the key never crosses the wire," P4-B moves ahead of this PRD, this PRD shrinks to the
  WebCrypto encryptor plus the client loop, and its `depends_on` gains P4-B. Resolve before
  `accepted`; the Design section is written for key transport and says so.
- **WebCrypto is asynchronous and the server is order-sensitive.** The promise chain is the
  mitigation; the criterion with an injected delay is the test. If per-frame `subtle.encrypt`
  latency exceeds the 20 ms frame period on a slow device the chain grows unboundedly — the
  client needs a depth limit that drops and reports, which is P1-B's client-side pause
  behaviour and is named there.
- **The timing budget is a guess for the browser.** `.context/architecture.md:12` budgets
  AES-GCM at under 0.2 ms per frame. That number is from Node's native binding; WebCrypto
  crosses a thread boundary per call. The cost is measured in P1-C's browser run, and if it
  is material the frame loop batches encryption off the rAF tick.
- **`AudioContext` may not honour 16 kHz.** If the context runs at 48 kHz, frames are the wrong
  duration and everything downstream is wrong before encryption is reached. That is P1-D and
  is independent, but a browser run for this PRD will hit it first on some hardware; the
  criterion above allows a recorded manual run precisely so the environment is written down.
- **The premise: is application-layer encryption worth having over `wss://`?** The "Why it
  matters" paragraph states what it buys — opacity to intermediaries and per-frame binding to
  session and sequence. If the owner decides that is not worth a key on the client, the honest
  alternative is P0-A removing the pillar from the README rather than this PRD building it.
  Decide before `accepted`.
- **Non-extractable web keys break symmetric testing.** `deriveKey` with `extractable: false`
  means the web frame key cannot be compared to the Node one byte-for-byte; the criterion is
  phrased as decrypt-under-the-other-side for that reason.

## References

- W3C Web Cryptography API — `SubtleCrypto.digest`, `importKey`, `deriveKey` (HKDF),
  `encrypt` (AES-GCM)
- RFC 5869 — HKDF
- RFC 5116 — An Interface and Algorithms for Authenticated Encryption (§2, §5.1)
- NIST SP 800-38D — GCM, §8.2.1 deterministic IV construction
- ADR 0002 (IV construction), ADR 0003 (per-session HKDF), ADR 0006 (the runner reads Redis)
- `docs/STATUS.md` rows 5, 6, 20
