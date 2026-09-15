---
id: PX-Y
title: short imperative title
tier: 0
status: draft # draft | accepted | in-progress | shipped | superseded
size: S # S (~1-2 days) | M (~3-5 days) | L (~1-2 weeks)
depends_on: []
blocks: []
issue: null
superseded_by: null
---

# PX-Y · Title

## Problem

What is broken or missing today. State it with file:line evidence where the claim is about
this repo, and with the observed behaviour where the claim is about what runs. No adjectives.
A reader can check every sentence in this section in under a minute.

## Why it matters

One paragraph tying this to an external standard, a named practice, or a measured failure
mode. This is the section that answers "so what."

## Scope

What this PRD delivers.

- Bullet per deliverable.

### Non-goals

What this PRD deliberately does not do, and which PRD picks it up instead.

## Design

The approach. Include the interface sketch, the wire format, the file layout, or the
workflow shape. Prefer a concrete signature over a description of a signature.

## Acceptance criteria

Checkable assertions. Each one should be something CI or a reviewer can verify. Where the
system has two halves — browser and server, runner and server, stub and real adapter — say
which half the criterion was checked on.

- [ ] ...

## Risks and open questions

Things that could make this wrong, and what would resolve them.

## References

Links to specs, papers, or docs that the design leans on.
