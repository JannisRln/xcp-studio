---
id: T-0005
title: Backend-owned acquisition engine, backpressure and DAQ
status: blocked
priority: P0
area: acquisition
owner: unassigned
branch: none
github_issue: 8
depends_on: [T-0004, T-0012]
requirements: [MEAS-001, MEAS-002, MEAS-004, MEAS-005, MEAS-006, MEAS-007, MEAS-011, MEAS-012, DIAG-002]
---

# T-0005 — Backend-owned acquisition engine, backpressure and DAQ

## Context / desired behavior

Current /api/xcp/stream starts per-client polling and supplies epoch-ms snapshots; it is not shared, recorded or DAQ-based.

**Desired outcome:** Backend-owned acquisition engine, backpressure and DAQ. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [ ] Create unique backend acquisition ID and validated state machine with start/stop/status operations.
- [ ] Implement one scheduler or DAQ stream per ECU session and bounded multi-subscriber fanout.
- [ ] Record monotonic elapsed time, host timestamp semantics, sequence numbers, gaps and drop metrics.
- [ ] Support explicit, bounded polling fallback and capability-driven DAQ integration phase.
- [ ] Handle slow subscribers, closed sockets, disconnect and restart safely.

## Non-goals

- Chart UI belongs to T-0006; persistent recording belongs to T-0015.
- Do not claim 1 kHz until a benchmark demonstrates it.

## Owned paths and interface boundaries

- crates/xcp-core/src/acquisition/, crates/xcp-server/src/services/acquisition/ and server WS subscription handler.
- Public WS contract must be frozen with T-0012; XCP command ownership stays T-0004.

## Acceptance criteria

- [ ] Two browser subscribers receive the same acquisition without doubling ECU request count.
- [ ] Bounded queues drop/report samples under slow-consumer load without unbounded memory growth.
- [ ] Timebase, sequence, quality and loss semantics are verified in tests.
- [ ] Stop/disconnect transitions close acquisition cleanly; fallback and unsupported DAQ states are explicit.

## Verification plan

- [ ] Multi-client integration trace, slow-client load test and metrics sample.
- [ ] Transport and ECU capabilities recorded with throughput/jitter/loss results.
- [ ] Current PR head passes required CI and negative-path tests; distinguish simulator from HIL evidence.

## Dependencies / handoff

- Dependencies: T-0004, T-0012.
- Linked GitHub issue: [#8](https://github.com/JannisRln/xcp-studio/issues/8).
- Changes to shared interfaces require contract-first coordination and an ADR if architecture changes.
- Agent must claim ownership in this ticket and update INDEX.md before overlapping code edits.

## Evidence and completion

- Implementation PR / commit: pending.
- CI workflow/head SHA: pending.
- Test/fixture evidence: pending.
- Known limitations and follow-ups: pending.
