# 0007 · The e2e workflow is disabled, not deleted, until tests exist

**Status:** accepted
**Date:** 2026-05-04
**Recorded in:** commit `a1d93be` (`ci(e2e): disable workflow until Playwright tests exist`).

## Context

`.github/workflows/e2e.yml` was added with the rest of CI on 2026-04-12 to run
`npx playwright test` against a booted `stream-server` and the Angular dev server. The
repository had, and has, no `playwright.config.ts`, no spec files, and no Playwright
dependency. With nothing to configure it, `npx playwright test` scanned the working directory,
picked up the Vitest files, and crashed loading two test frameworks into one process. The
workflow failed on every push for three weeks.

## Decision

Change the trigger from `push` / `pull_request` to `workflow_dispatch` only. Keep the job
definition — the Redis service container, the two background servers, the `wait-on` step and
the Playwright install — so that re-enabling is a trigger change once real tests land, not a
rewrite.

## Consequences

- No CI path executes `apps/voice-client`. Its `test` script echoes a pointer to this
  workflow, so `yarn test` reports success for the client having run nothing.
- Every browser-half capability in `docs/STATUS.md` is therefore `unverified` from inside CI:
  the worklet, the ring buffer, COOP/COEP behaviour, the SharedArrayBuffer error path.
- Re-enabling is P1-C, and it is gated behind P1-A: with the client sending unencrypted frames
  a happy-path test that waits for `voice.ack` cannot pass, so the order is fixed by the code
  rather than by preference.
