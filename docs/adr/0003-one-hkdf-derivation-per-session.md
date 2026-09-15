# 0003 · One HKDF derivation per session, not per frame

**Status:** accepted
**Date:** 2026-04-12
**Recorded in:** commit `6c82e03`, `.context/crypto.md` ("Key hierarchy"), the `CLAUDE.md`
invariant "HKDF is per-session, not per-frame", and the doc comment on `deriveFrameKey` in
`packages/session-core/src/hkdf.ts`.

## Context

`/session/init` generates a 32-byte random `session_key` and stores it against the session
id. The frame cipher needs a key. Deriving a fresh subkey per frame would give each frame its
own key as well as its own nonce; deriving once per session gives one key protected by the
nonce discipline in ADR 0002.

## Decision

Derive exactly one `frame_key` per session:

```
frame_key = HKDF-SHA256(ikm = session_key,
                        salt = session_id as UTF-8,
                        info = "voice-frame-v1",
                        L = 32)
```

Per-frame HKDF was rejected on the grounds recorded in `.context/crypto.md`: the per-frame IV
construction already provides nonce uniqueness, so a per-frame derivation adds a hash per
frame with no security benefit.

## Consequences

- Both endpoints must run the same derivation over the same `session_id` and `info` string,
  so any client-side encryptor needs the `session_key` (or an equivalently agreed secret) —
  and today `/session/init` returns no key to the client. That gap is P1-A's problem statement,
  and P4-B's if the answer is key agreement rather than key transport.
- The `2^32 - 1` frame bound in ADR 0002 applies per derived key, so it applies per session.
  A rekey (P4-C) must change `salt` or `info` — for example a versioned `info` — to obtain an
  independent key from the same `session_key`.
- The salt is public (the session id is in the JWT `sub` claim). RFC 5869 permits a
  non-secret salt; the secrecy of `frame_key` rests entirely on `session_key`.

## References

- RFC 5869, HMAC-based Extract-and-Expand Key Derivation Function (HKDF)
