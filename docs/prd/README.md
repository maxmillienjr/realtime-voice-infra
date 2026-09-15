# Product Requirement Docs

## Where things stand

_Last updated 2026-09-15, verified against `main @ 66369ac`. If this section is more than a
few weeks stale, trust the code over it and update it._

**The server half runs, and the gates prove it.** On 2026-09-15 `yarn install --immutable`
completed (with Yarn's standing Angular peer-range warnings), `yarn lint` reported zero
warnings, `yarn build` and `yarn typecheck` passed, and `yarn test` ran 30 tests in 7 files
across four workspaces, all green. `ci.yml` is green on `main` for both matrix legs, Node 20
and 22 (2026-09-03). The weekly load run on 2026-09-14 drove 100 concurrent sessions at 50
frames per second for 60 seconds through a GitHub runner: 291,817 AES-GCM-encrypted frames
sent, 291,817 acked, p50 1.37 ms, p95 3.76 ms, p99 5.77 ms. Session keys, HKDF, the
deterministic IV with hard-fail rollover, and single-use JWTs are implemented and tested.
`yarn lint:docs`, added with this index, passes.

**The browser half has never completed a frame round trip.** `app.component.ts:130-133`
emits `[seq 4B][pcm]` with no IV and no tag, "pending a WebCrypto client-side crypto helper";
`/session/init` returns `jwt` and `session_id` and no key (`http.ts:41`), so there is nothing
for the client to encrypt with. Driven against an in-process server on 2026-09-15, a
client-shaped stream drew `DECRYPT_FAILED`, `SEQUENCE_GAP`, `DECRYPT_FAILED`, `SEQUENCE_GAP`,
`DECRYPT_FAILED` and a disconnect at frame 5. The README quickstart therefore cannot show an
ack. No workflow runs the client — `e2e.yml` has been `workflow_dispatch` only since
2026-05-04 and there is no Playwright config, spec or dependency — so nothing in CI can
notice. **[P1-A](P1-A-client-side-frame-encryption.md) is the first real piece of work**, and
it forces a decision the original spec left open: whether the client receives the session
key in the init response over TLS, or derives it by ECDH over the `client_pubkey_b64` hook
that is already accepted and ignored (P4-B). That decision is the owner's, and the PRD is
`draft` until it is made.

**Backpressure has never fired outside a unit test.** `session-router.ts:182-190` releases
each frame's bytes in a microtask immediately after counting them, so `pendingBytes` never
exceeds one frame against a 256 KB threshold. A 1000-frame, 672 KB in-process burst produced
1000 acks and 0 pauses; the 2026-09-14 load run reports `pauses=0 resumes=0`. The tracker is
correct and unreachable. P1-B owns giving the server something to be slow at.

**Two documented guarantees are falsified at runtime, not merely unbacked.**
`.context/crypto.md:38-39` says in-session replay is detected by the monotonic sequence; the
router resyncs `expectedSequence` to any received value, so after frames 0–9 a replayed frame
3 is flagged and replayed frames 4 and 5 are decrypted and acked under reused IVs (P4-A).
`SHUTDOWN_GRACE_MS` bounds an `io.close()` that disconnects every client at once, with no
drain step for the grace period to cover: with five clients streaming, the server exited
17 ms after SIGTERM, losing the frame in flight (P3-B).

**`docs/STATUS.md` is the authority on any capability sentence, including the ones above.**
Thirty-one rows, each with a status, a file and a line — fourteen `implemented`, four
`stubbed`, six `planned`, four `broken`, three `unverified`, none `removed`. The rule that
keeps it true is in `.context/conventions.md`: a change that moves a row moves it there in the
same pull request. `yarn lint:docs` fails CI when a PRD's status disagrees with its index row,
when a STATUS citation no longer resolves, or when a STATUS owner names a PRD the index does
not know.

**Two things outside the backlog.** The scheduled dependency audit went red on 2026-09-14 on
GHSA-2883-xcg3-v3hh (`js-yaml < 4.3.2` against a `^4.3.1` resolution); that is a resolution
bump, not a PRD, and it is the gate doing its job (ADR 0008). And the Node major is split
four ways — 20 in `.nvmrc`, 20 and 22 in CI, 24 in the audit job, 26 in the Dockerfile — which
is P0-B's first criterion; the lint check that would prevent a recurrence is held back until
the surfaces agree.

**Where the build spec went.** The original build PRD lived at `753af3b:PRD.md` (701 lines,
deleted 2026-04-13 in `a60fa55`). This index supersedes it. Its unmet acceptance criteria and
its explicitly deferred items — client-side WebCrypto, the ECDH upgrade, OpenTelemetry, the
`voice.tts` path, Playwright, load-test latency and pause assertions — are where Tiers 1
through 6 come from; nothing below was invented without a trace back to either that document
or a gap `docs/STATUS.md` records.

## How this works

- **This index is the source of truth for the backlog.** Every planned change lives here,
  whether or not it has a GitHub issue.
- **GitHub issues are the tracking layer, not the content layer.** An issue is opened only
  when work on a PRD actually starts; its body is a link plus acceptance criteria. This
  keeps the tracker a picture of momentum rather than a pile of stale intentions.
- **Tiers map to milestones.** They are thematic, not time-boxed.
- **Sub-issues decompose a PRD into tasks** — never a tier into PRDs. Tier→PRD is a
  taxonomy and lives here; PRD→task is a work breakdown and lives in GitHub.
- **Changes arrive as pull requests.** `git log -p docs/prd/<file>` is the record of how the
  thinking changed, which is the whole reason these are files and not issue bodies.
- **Only PRDs with a file have been drafted.** A row with a plain id is a backlog entry and
  nothing more; `/prd <id>` drafts it for review.

Status values: `draft` → `accepted` → `in-progress` → `shipped` → `superseded`.
Sizes: `S` ≈ 1–2 days, `M` ≈ 3–5 days, `L` ≈ 1–2 weeks.

## Tier 0 — Truth alignment

The repository documents a pipeline it half implements, and the half it does not implement is
the half a reader would try first. Two prose files still demand a "k6 run artifact" from a
workflow that has run a Node script since April; a context file cites a test by a name it
never had; the README's diagram shows an event nothing emits and an encryption step the
client skips; four surfaces name four different Node majors. None of these is a code defect,
and fixing them in a PRD that also fixes code would hide which was which. This tier makes
every present-tense sentence true of HEAD and turns the rest into pointers at the PRDs
below. `docs/STATUS.md` already carries the matrix; keeping it true becomes a standing rule
in `.context/conventions.md` rather than a piece of work.

| ID                                         | Title                                                                           | Size | Status |
| ------------------------------------------ | ------------------------------------------------------------------------------- | ---- | ------ |
| [P0-A](P0-A-reconcile-claims-with-head.md) | Reconcile documented claims with the code at HEAD                               | M    | draft  |
| P0-B                                       | One toolchain: a single Node major, a formatting gate, and no dead provisioning | S    | draft  |

## Tier 1 — Close the pipeline

The README's thesis is three pillars — AudioWorklet capture, backpressure-aware streaming,
session-scoped encryption — and at HEAD only the server side of the third one is exercised
by anything. The client encrypts nothing, so no frame it sends is ever acked; the server's
pause path is unreachable, so the backpressure protocol has never run; and no workflow
executes the browser, so neither fact can surface in CI. This tier makes one microphone frame
travel the path the diagram draws — worklet, ring, encode, encrypt, socket, decrypt, ack — and
puts a browser in CI to prove it did. P1-A is first because P1-C cannot pass without it and
P4-B and P3-A build on it.

| ID                                           | Title                                                                                      | Size | Status |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ | ---- | ------ |
| [P1-A](P1-A-client-side-frame-encryption.md) | Client-side frame encryption with WebCrypto, and a way for the client to hold the key      | L    | draft  |
| P1-B                                         | Backpressure that can fire: a bounded ingest queue with a consumer seam                    | M    | draft  |
| P1-C                                         | Playwright e2e — fake microphone → worklet → socket → server → ack — and re-enable e2e.yml | M    | draft  |
| P1-D                                         | Sample-rate truth: read back `AudioContext.sampleRate`, resample or refuse                 | S    | draft  |

## Tier 2 — Proof under load

The load runner is the one piece of this repository that exercises the production decrypt
path at scale, and it judges only ack ratio and auth. The architecture file names a p95 budget
that nothing enforces; the build spec named a pause-before-RSS criterion that the runner
cannot check because pause never fires and RSS is never read. This tier turns the weekly run
into a gate with explicit budgets in the SRE sense — a latency SLO with a named percentile,
a frame-drop budget, a memory ceiling — and then attacks it with a slow consumer and a lossy
network, which is where a transport layer actually earns the word "backpressure-aware."

| ID   | Title                                                                                        | Size | Status |
| ---- | -------------------------------------------------------------------------------------------- | ---- | ------ |
| P2-A | Load runner as a gate: p95 ack budget, drop budget, and pause observed under a slow consumer | M    | draft  |
| P2-B | Slow-consumer and lossy-network chaos runs against the pause/resume and gap-resync paths     | M    | draft  |

## Tier 3 — Resilience

`.context/architecture.md` names session resumption as future work, and the code confirms
why it is not merely unimplemented but currently impossible: the JWT is single-use, the
session row is deleted on disconnect, and the TTL is never refreshed. Shutdown is the other
lifecycle edge, and the grace period it advertises drains nothing. This tier gives a session
a life that outlasts one socket and a server a way to stop without cutting frames in flight —
the two properties a rolling deploy or a flaky mobile network will test first.

| ID   | Title                                                                         | Size | Status |
| ---- | ----------------------------------------------------------------------------- | ---- | ------ |
| P3-A | Session resumption: reconnect with sequence continuity inside a grace window  | L    | draft  |
| P3-B | Graceful shutdown that drains within `SHUTDOWN_GRACE_MS`, with a SIGTERM test | S    | draft  |

## Tier 4 — Crypto hardening

The scheme is sound on paper and mostly sound in code: a deterministic IV in the NIST SP
800-38D sense, one HKDF-derived key per session, hard failure at the 2^32 bound. The gap a
probe found is in the enforcement, not the primitives — the router's gap-resync rule lets a
replayed stream through after one warning, which makes the "never reuse an IV" invariant
depend on a check that does not hold. This tier closes that, then addresses the two items the
build spec explicitly deferred (ECDH key agreement so the key never crosses the wire; rekey
before the bound) and writes down what AES-GCM's lack of key commitment does and does not
mean for a one-key-per-session design.

| ID   | Title                                                                                           | Size | Status |
| ---- | ----------------------------------------------------------------------------------------------- | ---- | ------ |
| P4-A | Replay-safe sequence handling: never rewind `expectedSequence`                                  | S    | draft  |
| P4-B | ECDH session key agreement over the existing `client_pubkey_b64` hook                           | M    | draft  |
| P4-C | In-session rekey before the 2^32 bound, IV-uniqueness property tests, and a key-commitment note | M    | draft  |

## Tier 5 — Observability

`metrics.ts` says what it is: an in-process shim "so the session router can be instrumented
today and the OTel bridge added later without call-site changes." The call sites exist, the
bridge does not, and the `OTEL_EXPORTER_OTLP_ENDPOINT` knob and the Jaeger compose profile
suggest otherwise to anyone who reads `.env.example` before `metrics.ts`. This tier adds the
bridge behind the seam that was left for it, with the frame, jitter, drop and queue-depth
instruments named per the OpenTelemetry semantic conventions, so that the load runner's
numbers and the server's numbers can be read on one timeline.

| ID   | Title                                                                                              | Size | Status |
| ---- | -------------------------------------------------------------------------------------------------- | ---- | ------ |
| P5-A | OpenTelemetry metrics and spans behind the existing `Counter` seam, exported to the compose Jaeger | M    | draft  |

## Tier 6 — Codec and adapter realism, and the transport question

The README's non-goals say stubs prove interfaces and no vendor engine is bundled, and this
tier keeps that promise while making the interfaces do work: the decrypted PCM the router
throws away today reaches the stub chain and comes back as `voice.tts`; one real STT adapter
sits behind the same interface, opt-in by environment variable, with no key in the repo; the
pass-through codec becomes libopus so the 40–120 byte frame budget in
`.context/architecture.md` is a measurement rather than a target. The last item revisits
ADR 0001 the only way an ADR should be revisited — with a spike and numbers.

| ID   | Title                                                                                        | Size | Status |
| ---- | -------------------------------------------------------------------------------------------- | ---- | ------ |
| P6-A | Wire the stub adapter chain: decrypted PCM → STT → Agent → TTS → `voice.tts`                 | M    | draft  |
| P6-B | One real STT adapter behind `STTAdapter`, opt-in by environment, no vendor key in the repo   | M    | draft  |
| P6-C | Real Opus via a libopus WASM build behind `OpusEncoder` / `OpusDecoder`                      | M    | draft  |
| P6-D | Transport spike and decision record: WebTransport and WebRTC data channels against Socket.io | S    | draft  |

## Sequencing

The dependency spine, not a schedule:

```
P1-A ──┬──▶ P1-C
       ├──▶ P4-B ──▶ P4-C
       └──▶ P3-A

P1-B ──┬──▶ P2-A ──▶ P2-B
       └──▶ P6-A ──▶ P6-B
```

P1-C waits on P1-A because a happy-path test that waits for `voice.ack` cannot pass while the
client sends plaintext. P4-B and P3-A build on the key-transport decision P1-A forces. P2-A's
pause criterion and P6-A's adapter wiring both need the consumer seam P1-B introduces; a
latency-only gate is an `S` slice of P2-A that could be pulled forward without it.

`P0-A`, `P0-B`, `P1-D`, `P3-B`, `P4-A`, `P5-A`, `P6-C` and `P6-D` have no hard predecessors
and can be picked up whenever they are the most valuable next thing. P4-A in particular is a
few lines and closes a `broken` row.
