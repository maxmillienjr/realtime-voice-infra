# 0008 · A dependency-audit gate on every PR and weekly, with ID-scoped ignores only

**Status:** accepted
**Date:** 2026-07-13, amended 2026-08-11
**Recorded in:** commit `3a9479c` (`ci: gate merges on a dependency audit, and run it
weekly`), commit `a5496e8` (`chore(security): ... retire the stale ignore`), and the comment
block in `.github/workflows/security.yml`.

## Context

Until July 2026 nothing in CI audited dependencies, and nineteen high or critical advisories
accumulated without a single red build. Most of them were published against dependencies
that had not changed, so a pull-request-only gate would not have caught them either. A
separate hazard: Yarn's ranged and parent/child `resolutions` bind only while their descriptor
matches, and one that stops matching is dropped silently with `yarn install` still exiting 0.

## Decision

`security.yml` runs `yarn npm audit --all --recursive --severity high` on every pull request,
on every push to `main`, and on a weekly schedule. Two rules accompany it:

- **Ignores, if any, are pinned to an advisory ID, never to a package glob.** The 2026-08-11
  amendment recorded why: an ignore that had been pinned to one `brace-expansion` advisory let
  the _next_ `brace-expansion` advisory fail the job instead of being swallowed — which is what
  happened, one patch short of the fix. The amendment also retired that ignore, because its
  premise (no patched release existed) had expired.
- **Transitive fixes are `resolutions` in `package.json`, raised by hand**, because Dependabot
  does not manage `resolutions` and its PRs cannot go green on their own when one is needed.

## Consequences

- The weekly job goes red when an advisory lands against an unchanged dependency. That is the
  job doing what it was added for. As of 2026-09-14 it is red on GHSA-2883-xcg3-v3hh
  (`js-yaml >= 4.0.0 < 4.3.2`) against a `^4.3.1` resolution — again one patch short of the
  floor. The fix is a resolution bump, and `docs/STATUS.md` carries the current state.
- Anyone raising a resolution has to check that it still binds: the audit is the only thing
  that distinguishes a dropped pin from a passing build.
- The job runs on Node 24 while the rest of CI runs on 20 and 22; the audit does not depend
  on the runtime major, but the drift is recorded in `docs/STATUS.md` and owned by P0-B.
