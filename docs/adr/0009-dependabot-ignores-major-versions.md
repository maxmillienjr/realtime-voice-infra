# 0009 · Dependabot ignores major versions; majors are migrated by hand

**Status:** accepted
**Date:** 2026-07-14
**Recorded in:** commit `1e1dad2` (`chore(dependabot): stop reopening major-version
migrations`) and the comment in `.github/dependabot.yml`.

## Context

Angular, Zod and Vitest majors are framework migrations, not routine patching. Left to
Dependabot they sit open, fail CI on every rebase, and are reopened after every close. The
Angular packages also release in lockstep, so a partial bump breaks the peer graph.

## Decision

In `.github/dependabot.yml`:

- Ignore `version-update:semver-major` for every npm dependency.
- Group Angular and the Socket.io/engine.io/ws transport chain so they move together.
- Run monthly rather than weekly (moved 2026-09-03, `35f48cd`).

Majors are done deliberately: unignore the one package, migrate, re-ignore. Dependabot
_alerts_ still fire, so a CVE that requires a major stays visible even though no PR is opened
for it.

## Consequences

- The runtime base image is the one place a major has moved on its own: the Docker ecosystem
  entry is not covered by the npm ignore, and Dependabot moved `apps/stream-server/Dockerfile`
  from `node:20` to `node:26` on 2026-07-14 (`7be3c6a`), which then needed `04c9451` to
  reinstall corepack. The result is the Node-major drift recorded in `docs/STATUS.md` and
  owned by P0-B; whether the Docker ecosystem should ignore majors too is one of P0-B's open
  questions.
- A security fix that only ships in a new major arrives as an alert, not a PR, and needs a
  hand migration. ADR 0008's audit gate is what makes that alert impossible to miss in CI.
