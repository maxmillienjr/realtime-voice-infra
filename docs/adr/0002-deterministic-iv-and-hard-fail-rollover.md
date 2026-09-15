# 0002 · Deterministic 96-bit IV from the sequence; rollover is a hard failure

**Status:** accepted
**Date:** 2026-04-12
**Recorded in:** commit `6c82e03` (`feat(session-core)`), `.context/crypto.md` ("IV
construction", "Sequence rollover"), and the `CLAUDE.md` invariant "Never reuse an IV."

## Context

Frames are encrypted with AES-256-GCM under one key per session (ADR 0003). GCM's security
collapses if a nonce is ever repeated under the same key. A 96-bit random nonce per frame
would need a collision budget; a nonce carried in every frame costs 12 bytes at 50 frames per
second either way. Each frame already carries a 32-bit sequence number for ordering and gap
detection.

## Decision

The 12-byte IV is constructed, not generated:

```
iv[0..3]  = sequence, uint32 big-endian
iv[4..11] = first 8 bytes of SHA-256(session_id)
```

The sequence is a `uint32`. `0xFFFFFFFF` is never encrypted: `buildIV` throws
`SequenceExhaustedError`, and a server that receives it emits `voice.control { type: 'stop' }`
plus `SEQUENCE_EXHAUSTED` and disconnects. Wraparound to zero is treated as a hard failure,
not a corner case to handle.

## Consequences

- Nonce uniqueness within a session reduces to sequence uniqueness within a session. The
  server's sequence check is therefore part of the security boundary, not only a quality
  signal: a frame whose sequence the server has already accepted must not be decrypted
  again under the same key. What the router does with an out-of-order sequence is recorded
  in `docs/STATUS.md` and owned by P4-A.
- One session can carry at most `2^32 - 1` frames: about 994 days at 50 frames per second.
  The bound is per key, so an in-session rekey (P4-C) would reset it.
- The 8-byte session fingerprint keeps IVs distinct across sessions even for equal sequence
  numbers. Keys already differ per session, so this is defence in depth, and `.context/crypto.md`
  says so.
- The IV is redundant with the 4-byte sequence prefix that precedes it on the wire; the
  decryptor checks the two agree before touching the ciphertext (`iv/sequence mismatch`).

## References

- NIST SP 800-38D, §8.2.1 (deterministic IV construction: fixed field plus invocation field)
- RFC 5116, §5.1 (AEAD_AES_256_GCM, 12-octet nonce)
