---
id: T-0004
title: Serialized XCP session and robust typed read/write
status: review
priority: P0
area: xcp-core
owner: chatgpt-t0004-session-agent
branch: feature/T-0004-deadlines-recovery
github_issue: 7
depends_on: []
requirements: [XCP-001, XCP-002, XCP-003, XCP-004, XCP-005, XCP-006, XCP-007, XCP-009]
---

# T-0004 — Serialized XCP session and robust typed read/write

## Context / desired behavior

Existing XCP master supports a scoped CTO subset and the server previously used a Mutex-protected simulator session. This PR introduces a reusable Rust session actor with serialized MTA-sensitive commands, lifecycle and concurrency/fault tests. Merged PR #24 migrated active legacy and versioned backend routes to that actor and runs blocking commands off Tokio I/O threads.

**Desired outcome:** Serialized XCP session and robust typed read/write. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [x] Implement a reusable actor session lifecycle and serial command ownership for MTA-dependent operations in xcp-core and integrate legacy/v1 server handlers.
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

## Current hardening phase (branch: feature/T-0004-deadlines-recovery)

- Scope: bounded actor queue, end-to-end command deadlines (including queued time), deadline-aware classic CAN response receiving, and explicit fault/recovery handling.
- Recovery policy: no automatic reconnect or retry of writes. After NoResponse, malformed/late CTO, sequence error, or transport failure the worker rejects I/O until explicit CONNECT; pending receive frames are drained best-effort before reconnect.
- Added deterministic mock/Simulator tests in `crates/xcp-core/tests/session_faults.rs` for multi-frame concurrent reads/writes, queued request timeout, negative XCP responses, stale reply drain, transport disconnect, incompatible connect and explicit reconnect.
- Scope limits: no shared REST/WS DTO, frontend chart or acquisition-service changes; no PCAN/Vector hardware bench evidence; arbitrary blocking third-party transports still require their own bounded receive implementation.
- Command state transitions and protocol limitations: [XCP session transition matrix](../xcp-session-state.md).
- Review PR: [#40](https://github.com/JannisRln/xcp-studio/pull/40) (draft). Windows CI on current head is the verification gate; remaining acceptance is pending, not marked complete. See PR checks for results.
- Current review-phase scope deliberately excludes fully typed multi-endian I/O, address extensions, production HIL and cancellation of arbitrary blocked third-party driver calls.

## Evidence and completion

- Implementation PRs: [#23](https://github.com/JannisRln/xcp-studio/pull/23) (core actor, merged), [#24](https://github.com/JannisRln/xcp-studio/pull/24) (Axum route integration, merged).
- CI: PR #24 run [#102](https://github.com/JannisRln/xcp-studio/actions/runs/41289810763), Rust/frontend/docs successful before squash merge.
- Test evidence: xcp-core session concurrency/error tests; server actor-backed connect/read/snapshot/disconnect and parallel HTTP read tests. Windows cargo fmt/Clippy/tests succeeded.
- Known limitations: session actor integration complete, but no cooperative in-flight cancellation/deadlines, target capability negotiation, DAQ, or backend recording yet. Per-client WebSocket sampling persists, though each ECU command is serialized by the actor.
