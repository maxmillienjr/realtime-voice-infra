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

## Gates

Run `yarn lint`, `yarn lint:docs`, `yarn build`, `yarn typecheck`, `yarn test` — `ci.yml`'s
order — before declaring any task complete. All five gate CI. `yarn build` is not optional:
workspaces resolve each other through `dist/`, so `typecheck` and `test` fail with `TS2307`
on a tree that has not been built. There is no `format:check` yet (P0-B owns it); run
`npx prettier --check` on every file you touch.

## What is actually true

- **`docs/STATUS.md` is the authority on any capability sentence in this file, the README,
  `.context/` or `.agents/`.** One row per documented capability, each with a status and a
  `file:line` that `yarn lint:docs` resolves. Read it before repeating a claim from prose. At
  HEAD the browser client sends unencrypted frames the server rejects, and the backpressure
  pause path has never fired outside a unit test; both are rows there, with owners.
- A capability claim in prose must be true of the code at HEAD. If it is aspirational it goes
  in `docs/prd/` or gets a STATUS row with a PRD id — never the present tense.
- Verified means run. Reading code promotes nothing to `implemented`.

## Planned work and decisions

- Planned work lives in `docs/prd/` and is indexed by `docs/prd/README.md`. Read the index —
  and its dated "Where things stand" section — before proposing new work; it may already be a
  PRD with a decided approach.
- Decisions live in `docs/adr/`. Do not contradict an accepted record without superseding it.
- `.agents/prd-author.md` carries the rules for writing or revising a PRD, including the
  evidence rules above.
- `.context/conventions.md` is the written form of these rules and of the repo's code
  conventions.

## Working on a PRD

`/prd <id>` is the entry point — it implements a PRD that exists, reviews one that is still
`draft`, or drafts one for review if the id is in the index but has no file yet. These rules
apply whether or not the command was used:

- **Finishing work on a PRD includes updating its `status`, its row in the index, the dated
  "Where things stand" section at the top of `docs/prd/README.md`, and any `docs/STATUS.md`
  row the change moved.** A stale status section is how the next session starts from the
  wrong place.
- **Report what you had to work out that the docs should have told you.** If the answer was
  not in `docs/prd/`, `docs/adr/`, `docs/STATUS.md`, `.context/`, or this file, that is a gap
  in the scaffolding — say so, and close it as part of the task.
