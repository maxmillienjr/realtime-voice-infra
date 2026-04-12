# Crypto

## Key hierarchy

```
session_key (32 random bytes)
    │   HKDF-SHA256
    │   salt = session_id (UTF-8)
    │   info = "voice-frame-v1"
    ▼
frame_key (32 bytes)  — AES-256-GCM key
```

One `frame_key` per session. Nonce uniqueness comes from the per-frame IV
construction; per-frame HKDF would add overhead with no security benefit.

## IV construction

```
iv[0..3]  = sequence (uint32 BE)
iv[4..11] = first 8 bytes of SHA-256(session_id)
```

The session fingerprint prevents cross-session IV collisions if the same
`session_key` were ever reused (it is not, but defence in depth). Sequence
uniqueness within a session guarantees nonce uniqueness.

## Sequence rollover

`sequence` is a uint32. At 50 fps, rollover occurs after ~994 days. At
`sequence === 0xFFFFFFFF` the server emits `voice.control({ type: 'stop' })`
and requires session re-init. We treat wraparound as a hard failure.

## Threat model

- **Passive eavesdropper:** defeated by AES-256-GCM confidentiality + tag.
- **Active tampering:** defeated by GCM auth tag.
- **Replay:** JWT `jti` is single-use (stored in Redis with TTL). Frame
  replay within a session is detected by monotonic sequence.
- **Out of scope:** compromised server, compromised client endpoint, side
  channels on the decryption path.
