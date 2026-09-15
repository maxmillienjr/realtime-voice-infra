# Architecture Decision Records

One file per decision, numbered sequentially, in the format popularized by Michael Nygard:
context, decision, consequences. A record is never edited after it reaches `accepted` —
if the decision changes, write a new record and mark the old one `superseded by NNNN`.

The bar for writing one: a reviewer would reasonably ask "why did you do it that way,"
and the answer is not obvious from the code.

Every record below documents a decision that was already written down somewhere in this
repository — the README, `CLAUDE.md`, `.context/`, a workflow comment, or a commit body —
before the record existed. The date is the date of that source, recovered from `git log`.
None of them is a decision invented for the record.

| ID                                                      | Title                                                                       | Status   |
| ------------------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| [0001](0001-socket-io-over-webrtc.md)                   | Socket.io over WebRTC for half-duplex agent sessions                        | accepted |
| [0002](0002-deterministic-iv-and-hard-fail-rollover.md) | Deterministic 96-bit IV from the sequence; rollover is a hard failure       | accepted |
| [0003](0003-one-hkdf-derivation-per-session.md)         | One HKDF derivation per session, not per frame                              | accepted |
| [0004](0004-raw-binary-frames-never-base64.md)          | Frames travel as raw binary, never base64                                   | accepted |
| [0005](0005-ring-buffer-drops-oldest-on-overrun.md)     | The capture ring buffer is bounded and drops the oldest frame               | accepted |
| [0006](0006-node-load-runner-replaces-k6.md)            | A Node load runner replaces the k6 script                                   | accepted |
| [0007](0007-e2e-workflow-disabled-not-deleted.md)       | The e2e workflow is disabled, not deleted, until tests exist                | accepted |
| [0008](0008-audit-gate-with-id-scoped-ignores.md)       | A dependency-audit gate on every PR and weekly, with ID-scoped ignores only | accepted |
| [0009](0009-dependabot-ignores-major-versions.md)       | Dependabot ignores major versions; majors are migrated by hand              | accepted |
