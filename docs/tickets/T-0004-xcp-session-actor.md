---
id: T-0004
title: Serialized XCP session and robust typed read/write
status: ready
priority: P0
area: xcp-core
owner: unassigned
branch: none
github_issue: 7
depends_on: []
requirements: [XCP-001, XCP-002, XCP-003, XCP-004, XCP-005, XCP-006, XCP-007, XCP-009]
---

# T-0004 — Serialized XCP session and robust typed read/write

## Context / desired behavior

Existing XCP master supports a scoped CTO subset and server Mutex session, but no explicit actor/cancellation model or safe concurrent scheduling.

**Desired outcome:** Serialized XCP session and robust typed read/write. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [ ] Implement explicit session lifecycle and serial command ownership for MTA-dependent operations.
- [ ] Validate typed read/write with target endian, address ranges and negotiated capabilities.
- [ ] Handle disconnect, no-response, CAN filtering and negative XCP responses with structured errors.
- [ ] Add concurrency, fault-injection, timeout and cancellation tests using simulator transport.
- [ ] Publish stable service interface for acquisition, calibration and HTTP handlers.

## Non-goals

- No hardware-specific implementation in session core.
- No production calibration UI in this ticket.

## Owned paths and interface boundaries

- crates/xcp-core/src/xcp.rs and session-specific new modules; crates/xcp-server/src/services/session* after interface freeze.
- Do not change acquisition modules owned by T-0005 or shared API DTOs owned by T-0012.

## Acceptance criteria

- [ ] Concurrent reads cannot interleave SET_MTA/UPLOAD operations.
- [ ] Write/readback and negative response behave deterministically at memory boundaries.
- [ ] Disconnect and timeouts transition to explicit error states and do not hang requests.
- [ ] Simulator and transport mock coverage passes on Windows CI.

## Verification plan

- [ ] Concurrency stress tests and protocol trace fixtures.
- [ ] A documented session-state transition matrix and remaining unsupported XCP commands.
- [ ] Current PR head passes required CI and negative-path tests; distinguish simulator from HIL evidence.

## Dependencies / handoff

- Dependencies: none.
- Linked GitHub issue: [#7](https://github.com/JannisRln/xcp-studio/issues/7).
- Changes to shared interfaces require contract-first coordination and an ADR if architecture changes.
- Agent must claim ownership in this ticket and update INDEX.md before overlapping code edits.

## Evidence and completion

- Implementation PR / commit: pending.
- CI workflow/head SHA: pending.
- Test/fixture evidence: pending.
- Known limitations and follow-ups: pending.
