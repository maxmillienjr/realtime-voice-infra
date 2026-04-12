# Claude Code instructions for realtime-voice-infra

This is a Yarn workspaces monorepo. Packages use strict TypeScript.

## Layout

- `apps/stream-server` — Node 20 + Socket.io 4 transport backend.
- `apps/voice-client` — Angular 21 standalone-signals SPA.
- `packages/audio-codec` — PCM ↔ Opus wrapper (WASM integration pending).
- `packages/session-core` — JWT, HKDF, AES-256-GCM frame crypto.
- `packages/shared-types` — Zod wire-protocol schemas and constants.

## Day-to-day commands

```bash
yarn install
yarn test                 # vitest across all workspaces
yarn typecheck
yarn build
docker compose up         # Redis + stream-server
yarn workspace @realtime-voice-infra/voice-client start
```

## Invariants — do not violate

- **Never base64-encode binary frames.** Wire is raw Buffer: `[seq 4B][iv 12B][ct][tag 16B]`.
- **Never reuse an IV.** IV = `seq (4B BE) || first 8B of SHA-256(session_id)`.
  Sequence is a uint32; `0xFFFFFFFF` triggers session termination, never wraparound.
- **Never remove or weaken COOP/COEP headers.** SharedArrayBuffer depends on them.
- **Never commit real audio samples.** Fixtures must be synthetic (sine, silence, noise).
- **Never commit vendor API keys.** `.env.example` uses placeholders only.
- **HKDF is per-session, not per-frame.** Per-frame IV construction already
  provides nonce uniqueness; per-frame HKDF is pure overhead.

## Specialized reviewers

See `.agents/` for PR-review agents — `audio-reviewer.md` and
`test-author.md`. Route crypto or buffer-size changes through
`audio-reviewer`.

## Architecture details

See `.context/architecture.md`, `.context/backpressure.md`, `.context/crypto.md`.
