# 0004 · Frames travel as raw binary, never base64

**Status:** accepted
**Date:** 2026-04-12
**Recorded in:** the `CLAUDE.md` invariant "Never base64-encode binary frames", commit
`6c82e03` ("Frame envelope: ... No base64."), and the original build spec at
`753af3b:PRD.md` §5.4, which gives the reason.

## Context

Socket.io carries binary attachments natively. Putting a frame inside a JSON string means
base64, which is roughly 33% more bytes on the wire and an encode plus a decode on every one
of fifty frames per second.

## Decision

`voice.frame` is a raw `Buffer` (or `ArrayBuffer` from the browser) with a fixed byte layout:

```
[seq 4B big-endian][iv 12B][ciphertext ...][GCM tag 16B]
```

No frame is ever base64-encoded, on either direction of the wire.

## Consequences

- The envelope is parsed by offset, not by schema: the server's structural check is a
  minimum-length test for `seq + iv + tag` before decryption is attempted, and the Zod
  schemas in `packages/shared-types` describe the JSON control events only.
- An `ArrayBuffer` from a browser client is normalised to a `Buffer` at the router boundary.
- Anything that inspects frames in flight (a load runner, a debugging proxy, a future
  `voice.tts` path) speaks this byte layout, and a change to it is a wire-protocol change.
