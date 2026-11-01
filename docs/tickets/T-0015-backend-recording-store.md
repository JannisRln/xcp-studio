---
id: T-0015
title: Backend-owned durable recording and export
status: blocked
priority: P1
area: recording
owner: unassigned
branch: none
github_issue: 9
depends_on: [T-0005, T-0012]
requirements: [MEAS-010]
---

# T-0015 — Backend-owned durable recording and export

## Context / desired behavior

**Deferred behind Live View at the user's request (2026-11-01).** Real-time measurement charts, fresh signal values and robust reconnect are the first priority. Current CSV export uses bounded browser-side buffers and can lose earlier samples on long acquisitions. This is not a reason to delay live monitoring.

**Desired outcome:** Backend-owned durable recording and export. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [ ] Design versioned recording metadata and chunked sample storage with explicit units/quality/timebase.
- [ ] Implement bounded writer queue and configurable file size, flush and rotation policy.
- [ ] Provide recording lifecycle and backend CSV streaming/download without loading entire capture into RAM.
- [ ] Handle disk-full, interrupted acquisition, restart and failed export explicitly.
- [ ] Test export fidelity against source sample batches and missing values.

## Non-goals

- Do not claim browser buffer represents a complete recording.
- Avoid undisclosed unbounded on-disk retention.

## Owned paths and interface boundaries

- crates/xcp-core/src/recording/ or server/services/recording/, API export routes and fixtures.
- Coordinate sample schema with T-0005 and REST contract with T-0012.

## Acceptance criteria

- [ ] Recorded file exactly preserves expected timestamps, values and quality/missing fields.
- [ ] Large simulated stream exports with bounded memory and deterministic cleanup.
- [ ] Disk-full or stop flush errors are visible and recorded.
- [ ] Closed tab does not terminate backend recording unless user explicitly requests stop.

## Verification plan

- [ ] Long-running capture/load test and CSV golden fixtures.
- [ ] Storage format version/retention documentation and failure evidence.
- [ ] Current PR head passes required CI and negative-path tests; distinguish simulator from HIL evidence.

## Dependencies / handoff

- Dependencies: T-0005, T-0012.
- Linked GitHub issue: [#9](https://github.com/JannisRln/xcp-studio/issues/9).
- Changes to shared interfaces require contract-first coordination and an ADR if architecture changes.
- Agent must claim ownership in this ticket and update INDEX.md before overlapping code edits.

## Evidence and completion

- Implementation PR / commit: pending.
- CI workflow/head SHA: pending.
- Test/fixture evidence: pending.
- Known limitations and follow-ups: pending.
