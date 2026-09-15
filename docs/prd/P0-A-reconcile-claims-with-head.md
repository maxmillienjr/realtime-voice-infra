---
id: P0-A
title: Reconcile documented claims with the code at HEAD
tier: 0
status: draft
size: M
depends_on: []
blocks: []
issue: null
superseded_by: null
---

# P0-A · Reconcile documented claims with the code at HEAD

## Problem

The prose in this repository — `README.md`, `CLAUDE.md`, `AGENTS.md`, `.context/*.md`,
`.agents/*.md` and the two `.env.example` files — makes present-tense statements that the code
at `66369ac` does not back. Each of the following is checkable in under a minute; the status
matrix in `docs/STATUS.md` carries the runtime evidence.

1. `README.md:22-24` draws `audio-codec: Opus → session-core: AES-GCM → Socket.io` on the
   client path. `app.component.ts:130-133` emits unencrypted `[seq 4B][pcm]` and
   `codec.ts:23-31` is a PCM16 pass-through. `README.md:29` draws a `voice.tts` event that
   occurs nowhere else in the tree.
2. `README.md:9-14` says the repository documents patterns that prevent "AudioContext
   sample-rate mismatches". `app.component.ts:75` requests 16 kHz and nothing reads the
   resulting `sampleRate` back; the worklet has no resampler.
3. `AGENTS.md:14-15` and `.agents/audio-reviewer.md:24-26` require a "k6 run artifact" or
   "k6 load-test artifact demonstrating the new limits hold at 100 VUs / 60 s" before a
   threshold change merges. The k6 script was deleted on 2026-04-30 (`8af05b4`, ADR 0006).
   `load.yml:23-32` runs `load-backpressure.ts` and uploads `summary.json`. A reviewer
   following the prompt as written asks for an artifact that cannot exist.
4. `.context/backpressure.md:28` says "`BackpressureTracker.test.ts` proves the transition
   rules." The file is `apps/stream-server/src/backpressure.test.ts`.
   `.context/backpressure.md:15` names `BACKPRESSURE_RESUME_THRESHOLD`; `config.ts:48` reads
   `BACKPRESSURE_RESUME`.
5. `.context/crypto.md:38-39` says frame replay within a session "is detected by monotonic
   sequence." `session-router.ts:139-148` resyncs `expectedSequence` to any received value,
   including a lower one. Observed 2026-09-15: after frames 0–9, a replayed frame 3 drew
   `SEQUENCE_GAP` and replayed frames 4 and 5 were decrypted and acked. The fix is P4-A's;
   the sentence is this PRD's.
6. `README.md:82-96` and `.context/backpressure.md:10-16` describe a pause/resume protocol.
   `session-router.ts:182-190` releases every frame's bytes in a microtask, so
   `pendingBytes` never exceeds one frame. The 2026-09-14 load run at 100 VUs reports
   `pauses=0`. The protocol is described as operating; it has never fired outside
   `backpressure.test.ts`. The fix is P1-B's; the tense is this PRD's.
7. `CLAUDE.md:7` says `apps/stream-server` is "Node 20". `apps/stream-server/Dockerfile:1`
   is `node:26-alpine`; `security.yml:23` runs 24; `ci.yml:14` runs 20 and 22. The version
   change is P0-B's; the sentence in `CLAUDE.md` is this PRD's, and it is written once P0-B
   has picked the major.
8. `apps/voice-client/package.json:9` is
   `echo 'voice-client tests run via playwright in e2e workflow'`. `e2e.yml:3-4` is
   `workflow_dispatch` only (ADR 0007) and no Playwright file exists. `yarn test` prints a
   success for the client having run nothing.
9. `wire.ts:13` declares `BUFFER_OVERFLOW`, emitted nowhere. `wire.ts:3-6` requires
   `session_id` on `voice.control`; the server's own shutdown emit at
   `apps/stream-server/src/index.ts:38` omits it and fails `VoiceControlSchema`. `start` and
   `flush` pass validation and are ignored (`session-router.ts:90-93`).
10. `apps/stream-server/.env.example:17-18` documents `OTEL_EXPORTER_OTLP_ENDPOINT` "(see
    docker-compose observability profile)". Nothing reads the variable; there is no
    `@opentelemetry` dependency; `metrics.ts:1-26` is an in-process shim read by nothing.
    `apps/voice-client/.env.example:1` documents `STREAM_SERVER_URL`; the client hardcodes
    `http://localhost:3000` at `session.service.ts:6` and `app.component.ts:59`.
    `mcp-config/mcp-config.json:5` launches `./mcp-config/stubs/metrics-server.js`, which is
    not a tracked file.
11. `README.md:53` comments `docker compose up` with "Redis, stream-server". That is true of
    the default profile; `docker-compose.yml:37-40` also defines an `adminer` service, a SQL
    administration UI, in a repository with no SQL store. Removing it is P0-B's; saying what
    the compose file contains is this PRD's.
12. `.context/architecture.md:12` budgets "AES-256-GCM encrypt (12 B IV + 320 B PCM)". A
    frame is 320 _samples_: 1280 B as Float32 (`.context/architecture.md:19`) and 640 B on
    the wire as PCM16 (`load-backpressure.ts:48`). Nothing in this pipeline encrypts 320
    bytes.

## Why it matters

Three of these files are not read by people. `.agents/audio-reviewer.md` and `AGENTS.md` are
prompts handed to a reviewing agent, and `CLAUDE.md` is loaded into every coding session.
A false convention in a review prompt does not merely mislead; it blocks a correct pull
request by demanding evidence that cannot be produced, or waves through an incorrect one by
naming a test that does not exist. The practice this PRD follows is the one Michael Nygard's
ADR format and the "docs as code" movement both rest on: a statement about the system is
either true of the current revision or it is dated and marked as a decision or a plan. The
status matrix gives every present-tense claim a place to be checked, and this PRD makes the
prose agree with it. Nothing here changes behaviour; a reader who disagrees with a
correction can point at the row and the line.

## Scope

- Rewrite or delete every present-tense sentence listed above so that it is true at HEAD, or
  turn it into a forward-looking sentence that names the owning PRD id.
- `README.md`: the architecture diagram shows what runs (client emits unencrypted PCM16
  frames today; `voice.tts` is removed or dashed and labelled P6-A); the pitch paragraph
  drops the sample-rate claim or points at P1-D; the backpressure section says the tracker
  exists and the production path does not yet drive it (P1-B); a short "Status" pointer to
  `docs/STATUS.md` and `docs/prd/README.md` is added under the badges.
- `AGENTS.md` and `.agents/audio-reviewer.md`: replace the k6 artifact requirement with the
  `load-summary` artifact from `load.yml` (`summary.json`) and the numbers it actually
  contains (`ack_ratio`, `pauses`, `p95_ack_ms`).
- `.context/backpressure.md`: correct the test filename and the environment variable name;
  add one paragraph stating that the release-in-microtask at `session-router.ts:182-190`
  means the thresholds are not reached today (P1-B).
- `.context/crypto.md`: restate the replay paragraph as what the router does (first replayed
  frame flagged, `expectedSequence` resynced to it), pointing at P4-A.
- `.context/architecture.md`: mark the timing budget row for Opus as a target while the codec
  is pass-through (P6-C); correct the frame size in the AES-GCM budget row; leave the
  resumption paragraph, which is already honest.
- `CLAUDE.md`: layout line for `stream-server` names the major P0-B picks; the `audio-codec`
  line already says "WASM integration pending" and stays.
- `apps/voice-client/package.json`: the `test` script says what is true (`echo 'no unit tests
yet; browser coverage is P1-C'`) or is removed so that `yarn test` skips the workspace.
- `packages/shared-types/src/wire.ts`: either remove `BUFFER_OVERFLOW` and the unused
  `start` / `flush` control types, or leave them and add a comment naming the PRD that will
  emit or handle them (P1-B for `BUFFER_OVERFLOW`). Make the shutdown emit at
  `apps/stream-server/src/index.ts:38` schema-valid or make `session_id` optional on
  server-originated control events; add a test that parses every server-emitted control
  payload with `VoiceControlSchema`.
- `.env.example` files and `mcp-config/`: delete the `OTEL_EXPORTER_OTLP_ENDPOINT` and
  `STREAM_SERVER_URL` entries, or mark each "read by nothing; P5-A / P1-C". Delete
  `mcp-config/` or add the stub it references.
- Commit as tests the three probes that pin behaviour this PRD documents and later PRDs
  change — the client-envelope rejection (row 6), the burst-without-pause (row 11), and the
  replay-rewind (row 10) — each named for the row it pins, so that P1-A, P1-B and P4-A each
  flip a test from asserting the defect to asserting the fix.
- Move every `docs/STATUS.md` row this PRD touches in the same pull request, and update its
  citations into the files whose line numbers this PRD changes.

### Non-goals

- Fixing any behaviour. The replay rewind is P4-A, the unreachable pause is P1-B, the
  shutdown drain is P3-B, client encryption is P1-A. This PRD changes tense, not code paths;
  the only code it touches is the shutdown payload's shape and the test script string.
- Choosing or moving the Node major, adding a Prettier gate, deleting the `adminer` and Jaeger
  provisioning. That is P0-B.
- Writing browser tests. That is P1-C.
- Rewriting the README's "Why Socket.io and not WebRTC" section. It is true, it is ADR 0001,
  and P6-D is where it gets re-examined.

## Design

The unit of work is a sentence, and the rule for each is:

- **True at HEAD** → keep, tightened to what the code does.
- **True of a plan** → future tense plus a PRD id in parentheses, e.g. "the router will hand
  decrypted PCM to the adapter chain (P6-A)".
- **True of a decision** → replaced by a pointer at the ADR.
- **Not true and not planned** → deleted.

The reviewer-prompt changes are the load-bearing ones and are written first. Replacement text
for `.agents/audio-reviewer.md` item two:

> Any increase to `BACKPRESSURE_THRESHOLD` or decrease to `BACKPRESSURE_RESUME` must link a
> `load-summary` artifact from a `load.yml` run on the branch and quote its `ack_ratio`,
> `p95_ack_ms` and `pauses`. Until P1-B ships, `pauses` will be 0 regardless of the
> thresholds; say so in the PR rather than treating it as evidence.

The README diagram is redrawn from the code rather than from the spec. The client path at
HEAD is `Worklet → Ring (SAB) → Main thread → PCM16 → Socket.io /voice`, with `Opus` and
`AES-GCM` shown as dashed nodes labelled `P6-C` and `P1-A`. The server path is
`stream-server → decrypt → ack`, with the adapter chain dashed and labelled `P6-A`.

The three pinning tests live in `apps/stream-server/src/status-pins.test.ts`, one `describe`
per STATUS row, each with a comment naming the PRD that will invert it. They use the same
in-process server as `integration.test.ts`.

## Acceptance criteria

- [ ] `git grep -n k6 -- AGENTS.md .agents/audio-reviewer.md` returns nothing. The k6
      mentions in `.agents/prd-author.md`, `.context/conventions.md` and
      `scripts/lint-docs.mjs` are history rather than instructions and stay.
- [ ] `git grep -n 'BackpressureTracker.test.ts' -- .context` and
      `git grep -n BACKPRESSURE_RESUME_THRESHOLD -- .context apps packages` return nothing.
      Both names survive under `docs/` on purpose: that is where the record of the
      correction lives.
- [ ] `git grep -n 'voice.tts' -- README.md` returns nothing, or the only hit is a line that
      also contains `P6-A`.
- [ ] `README.md` contains no present-tense sentence stating that the client encrypts, encodes
      to Opus, or handles sample-rate mismatch; each appears once, in future tense, with its
      PRD id.
- [ ] `.agents/audio-reviewer.md` and `AGENTS.md` name `summary.json` from `load.yml` and none
      of `k6`, `k6 run`, `k6 summary`.
- [ ] `.context/crypto.md` describes the gap-resync behaviour observed in STATUS row 10 and
      names P4-A; `.context/backpressure.md` states that the pause path is not reached at HEAD
      and names P1-B.
- [ ] Every server-emitted `voice.control` payload parses under `VoiceControlSchema`, asserted
      by a test (server half).
- [ ] `apps/stream-server/src/status-pins.test.ts` exists with three passing tests that assert
      the behaviour in STATUS rows 6, 10 and 11 as they stand at HEAD (server half; the client
      envelope is reproduced byte-for-byte from `buildEnvelope`, not sent from a browser).
- [ ] `yarn test` no longer prints a success line for `voice-client` that names a workflow
      which does not run.
- [ ] Neither `.env.example` documents a variable nothing reads without naming the PRD that
      will read it; `mcp-config/mcp-config.json` references only tracked files or is gone.
- [ ] Every `docs/STATUS.md` row whose evidence cites a file this PRD edited has its citation
      re-pointed, and `yarn lint:docs` passes.
- [ ] `npx prettier --check` passes on every file this PRD touched.
- [ ] `CLAUDE.md`'s layout line for `stream-server` names the Node major that `.nvmrc` names,
      which is P0-B's output; if P0-B has not shipped, this criterion is unchecked and owned
      by P0-B.

## Risks and open questions

- **Over-correction into hedging.** The server half is real, and a README that hedges every
  sentence reads as if nothing works. The rule is: positive present tense where the row is
  `implemented`, one future-tense sentence with an id where it is not, and nothing else.
- **This PRD becomes a place to hide fixes.** The shutdown payload shape is included because it
  is a two-line schema disagreement with no behavioural effect (no client parses it). Anything
  that changes what a client observes is out of scope and belongs to the owning PRD, even if
  it is small — P4-A is a few lines, and it stays P4-A.
- **Citation churn.** `docs/STATUS.md` cites line numbers into the files this PRD rewrites.
  `yarn lint:docs` catches a citation past the end of a file, not one that now points at a
  different sentence. Re-pointing is manual and is a criterion above.
- **The pinning tests enshrine defects.** That is their purpose — they make a later PRD's fix
  visible as a test that flips — but a reader who finds `status-pins.test.ts` without its
  comments could take it for intended behaviour. Each test's name carries the row number and
  the fixing PRD.

## References

- Michael Nygard, "Documenting Architecture Decisions" (2011)
- Write the Docs, "Docs as Code"
- `docs/STATUS.md` rows 3, 4, 6, 10, 11, 13, 19, 21, 22, 23, 26 and 30
- ADR 0006 (the k6 replacement), ADR 0007 (the e2e trigger)
