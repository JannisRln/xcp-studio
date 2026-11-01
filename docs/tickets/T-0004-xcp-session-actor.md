---
id: T-0004
title: Serialized XCP session and robust typed read/write
status: in-progress
priority: P0
area: xcp-core
owner: assistant-xcp-agent
branch: feat/T-0004-xcp-session-actor
github_issue: 7
depends_on: []
requirements: [XCP-001, XCP-002, XCP-003, XCP-004, XCP-005, XCP-006, XCP-007, XCP-009]
---

# T-0004 — Serialized XCP session and robust typed read/write

## Context / desired behavior

Existing XCP master supports a scoped CTO subset and the server still owns a Mutex-protected simulator session. This PR introduces a reusable Rust session actor with serialized MTA-sensitive commands, lifecycle and concurrency/fault tests. Migration of the active server to the actor remains follow-up implementation.

**Desired outcome:** Serialized XCP session and robust typed read/write. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [x] Implement a reusable actor session lifecycle and serial command ownership for MTA-dependent operations in xcp-core; server integration remains outstanding.
- [ ] Validate typed read/write with target endian, address ranges and negotiated capabilities.
- [ ] Handle disconnect, no-response, CAN filtering and negative XCP responses with structured errors.
- [x] Add concurrency and timeout fault-injection tests using simulator transport; cancellation/deadline tests remain outstanding.
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

- Implementation PR: pending PR creation; source includes xcp-core/src/session.rs and simulator integration tests.
- CI workflow/head SHA: pending.
- Test/fixture evidence: pending.
- Known limitations: active xcp-server handlers continue to use the existing Mutex until a separately reviewed integration step; no cooperative in-flight cancellation/deadlines/DAQ negotiation yet.
