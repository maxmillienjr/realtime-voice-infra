# Conventions

What is written here is true of the repository at HEAD and is checkable. Where a convention
is aspirational it names the PRD that makes it real.

## TypeScript

- Strict mode everywhere, via `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `isolatedModules`. Indexing a typed
  array therefore yields `T | undefined`, which is why the codec and worklet code write
  `pcm[i] ?? 0`.
- Zod schemas in `packages/shared-types` are the source of truth for the JSON wire events;
  types are inferred with `z.infer`. The binary frame envelope is not a schema — it is a byte
  layout parsed by offset (ADR 0004).
- Target ES2022, ESM throughout (`"type": "module"`); package imports use the `.js` extension.

## Packages

- Workspaces are `apps/*` and `packages/*`, published under `@realtime-voice-infra/*` with
  `"private": true`. Cross-package imports resolve through each package's `exports` to
  `dist/`, so **build before typecheck and before running anything that imports a workspace
  package** — `ci.yml` runs `yarn build` ahead of `yarn typecheck` for this reason, and
  `load.yml` learned it the hard way (`0bb16c8`).
- Tests are `*.test.ts` beside the source and are excluded from `tsc` builds by each package's
  `tsconfig.json`.
- `nodeLinker: node-modules` in `.yarnrc.yml` is deliberate (ADR 0006): Yarn's default PnP made
  `tsx` and ad-hoc scripts brittle.

## Commits

- Conventional Commits: `feat:`, `fix:`, `chore:`, `ci:`, `docs:`, `test:`, `security:`, with an
  optional scope in parentheses (`feat(stream-server):`).
- Imperative mood, lowercase first word after the prefix.
- The body says why. The bodies of `b9616f1`, `a1d93be` and `3a9479c` are the reason three
  ADRs could be written after the fact; a commit that only restates its diff leaves the next
  reader to guess.

## Formatting

- Prettier, configured in `.prettierrc` (single quotes, trailing commas, width 100). `yarn format`
  writes; there is no `format:check` and no CI step yet, and 20 tracked files fail
  `prettier --check` at HEAD — markdown, config and TypeScript sources alike, most of them
  cited by line in `docs/STATUS.md` (row 27). Until P0-B adds the gate, run
  `npx prettier --check` on every file you touch.

## Testing

| Tier        | Runner                      | Command                                     | Scope                                                                                         |
| ----------- | --------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Unit        | Vitest                      | `yarn test`                                 | Pure logic in `packages/*` and `apps/stream-server` — 30 tests in 7 files at HEAD             |
| Integration | Vitest + `socket.io-client` | `yarn test` (same run)                      | `apps/stream-server` booted in-process on an ephemeral port with the in-memory store          |
| Load        | `tsx` runner                | `load.yml` (weekly, or `workflow_dispatch`) | 100 VUs × 50 fps × 60 s against the compose stack; gates on ack ratio and auth/decrypt errors |
| E2E         | Playwright                  | —                                           | Nothing runs. `e2e.yml` is `workflow_dispatch` only (ADR 0007); P1-C owns it                  |

- **Nothing executes `apps/voice-client`.** Its `test` script is an `echo`. Every claim about
  the browser half is `unverified` in `docs/STATUS.md` until P1-C.
- **Integration tests do not need Redis.** They construct `InMemorySessionStore`. The load
  runner does need Redis, because it reads session keys from it (ADR 0006, until P1-A).
- **Synthetic audio only.** Fixtures are sine, silence or noise (`CLAUDE.md` invariant). The
  load runner's payload is a generated sine in Int16.
- **A load or latency number names its axes**: VUs, frames per second, duration, codec
  (pass-through until P6-C), adapter path (none until P1-B), and which client produced it
  (the runner or a browser).

## Documentation

- **Planned work goes in `docs/prd/`**, one file per PRD, indexed by `docs/prd/README.md`. A
  row without a file is a backlog entry; `/prd <id>` drafts it.
- **Decisions go in `docs/adr/`.** A record is not edited after it reaches `accepted` —
  supersede it with a new one instead. Every record there today documents a decision that was
  already written down in the README, `CLAUDE.md`, `.context/`, a workflow comment or a commit
  body before the record existed.
- `yarn lint:docs` checks the structure: frontmatter completeness, that every id resolves,
  that `depends_on` and `blocks` are mutual, that the index agrees with the files, that a
  `shipped` PRD's unmet criteria each name the PRD that now owns them, that the ADR index and
  the ADR files agree, and that every `path:line` citation in `docs/STATUS.md` resolves to a
  tracked file and lies within it. It runs in `ci.yml` on every push and pull request.
- **A capability claim in `README.md`, `CLAUDE.md`, `.context/` or `.agents/` must be true of
  the code at HEAD.** `.agents/` counts double: those files are prompts, and a review prompt
  that demands a k6 artifact from a workflow that has not run k6 since April blocks correct
  pull requests. If a sentence is aspirational, it belongs in `docs/prd/` or in the status
  matrix with a PRD id, not in the present tense.
- **`docs/STATUS.md` is that status matrix**, one row per documented capability with what is
  actually behind it and which PRD owns the rest. A change that moves a row — wiring the
  client encryptor, deleting a claim, making pause reachable — updates the row in the same
  pull request, including the line numbers it cites.
- **Verified means run.** A row is `implemented` only on the strength of a committed test, a
  CI run, or a hand verification whose date and method the row records. Reading the code
  promotes nothing.

## Invariants

The non-negotiables — never base64 a frame, never reuse an IV, never weaken COOP/COEP, never
commit real audio or a vendor key, HKDF once per session — live in `CLAUDE.md` and are backed
by ADRs 0002, 0003, 0004 and 0005. Route any change near them through
`.agents/audio-reviewer.md`.
