# Architecture Decision Records (ADRs)

ADRs capture **accepted or proposed** design choices that affect multiple modules or agents. Changes to session ownership, API shape, error formats, data precision, persistence schema or hardware safety require an ADR or a reviewed amendment.

## Decision index

| ADR | Decision | Status | Related tickets |
| --- | --- | --- | --- |
| [0001 — Control plane and streaming](0001-control-and-streaming.md) | REST for commands; WebSocket for continuous events | Accepted principle; shared backend service remains target | T-0012, T-0005 |
| [0002 — Session and acquisition ownership](0002-session-and-acquisition-ownership.md) | Rust actor/session owns ECU I/O; backend acquisition owns sampling | Target; not fully implemented | T-0004, T-0005, T-0015 |

## ADR convention

New file name: 0003-short-decision.md (monotonic number). Include Context, Decision, Alternatives, Consequences, Migration, Status, Tests and Ticket references. Proposed design and implemented code must be distinguished. Amend an existing ADR with a clear supersession link rather than silently reversing a choice.

One integration owner reviews cross-cutting ADR changes before agents implement incompatible interfaces.
