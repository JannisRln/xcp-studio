---
id: T-0005
title: Backend-owned acquisition engine, backpressure and DAQ
status: in-progress
priority: P0
area: acquisition
owner: assistant-acquisition-agent
branch: feat/T-0005-shared-acquisition-polling
github_issue: 8
depends_on: [T-0004, T-0012]
requirements: [XCP-008, MEAS-001, MEAS-002, MEAS-004, MEAS-005, MEAS-006, MEAS-007, MEAS-011, MEAS-012, DIAG-002]
---

# T-0005 — Backend-owned acquisition engine, backpressure and DAQ

## Context / desired behavior

The existing /api/xcp/stream remains a legacy per-client polling endpoint. This independent, contract-first phase adds an **additive** backend-owned shared polling acquisition with REST lifecycle and v1 WebSocket subscribers. T-0004 actor and T-0012 REST contract foundations are already merged; their remaining scope does not block this isolated implementation slice. ECU-side DAQ and recording remain follow-ups.

**Desired outcome:** Backend-owned acquisition engine, backpressure and DAQ. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [x] Add per-process acquisition IDs and validated start/stop/status HTTP lifecycle with explicit running/stopped/failed state.
- [x] Use one backend polling scheduler with bounded broadcast and up to 16 independent WebSocket subscribers per acquisition.
- [x] Include host epoch-ms, process-monotonic elapsed-ms, sequence IDs and subscriber lag events with drop counts.
- [ ] Support explicit, bounded polling fallback and capability-driven DAQ integration phase.
- [x] Ensure slow subscribers cannot block sampling, stop acquisition on explicit XCP disconnect, and accept a new acquisition after stop; full reconnect/recovery semantics remain pending.

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

- Implementation PR: shared polling acquisition slice, pending PR URL and CI validation.
- CI workflow/head SHA: pending.
- Test/fixture evidence: pending.
- Known limitations: **not ECU-side DAQ**, no backend recorder or replay of lost messages; the legacy /api/xcp/stream remains per-tab polling for compatibility. Subscriber count capped at 16, broadcast queue at 128 events. Single active acquisition per simulated ECU process; restart replaces the last status. Ticket stays in-progress until DAQ/capability tests are complete.
