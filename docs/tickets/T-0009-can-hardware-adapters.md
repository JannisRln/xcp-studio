# T-0009 — Windows PCAN and Vector transport integration

---
id: T-0009
title: Windows PCAN and Vector transport integration
status: blocked
priority: P1
area: hardware
owner: unassigned
branch: none
github_issue: 12
depends_on: [T-0004, T-0013]
requirements: [CAN-001, CAN-002, CAN-003, CAN-004, CAN-005, QA-004]
---

## Context / desired behavior

The PCAN-Basic Rust transport exists but hardware profiles are not wired to the production session API; Vector XL/VN1640A support is absent.

**Desired outcome:** Windows PCAN and Vector transport integration. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [ ] Build transport registry and validated hardware profiles with channel/bitrate/CAN ID selection.
- [ ] Expose PCAN-Basic adapter through the backend session factory without linking vendor DLL in simulator CI.
- [ ] Add Vector XL driver adapter for VN1640A with documented SDK/driver prerequisites.
- [ ] Implement robust receive filtering, timeout, disconnected device and error-code handling.
- [ ] Run separate reproducible Windows hardware bench tests; store trace/evidence matrix.

## Non-goals

- No unverified write/unlock capability in hardware mode.
- Do not claim a physical ECU test based solely on simulator mocks.

## Owned paths and interface boundaries

- crates/xcp-core/src/pcan.rs, new vector or transport adapter modules, session transport registry and hardware docs.
- Coordinate session trait changes with T-0004 and write policy with T-0013.

## Acceptance criteria

- [ ] Simulator CI succeeds without vendor SDKs and verifies mock adapter errors.
- [ ] Physical PCAN and Vector connections can each read an approved ECU fixture through XCP.
- [ ] Incorrect channel, bitrate, driver version or CAN identifiers fail clearly.
- [ ] Hardware tests identify device/driver/ECU/OS versions and avoid accidental writes.

## Verification plan

- [ ] Published Windows HIL test matrix for each supported adapter.
- [ ] Mock fault coverage, driver installation guide and link to bench results.
- [ ] Current PR head passes required CI and negative-path tests; distinguish simulator from HIL evidence.

## Dependencies / handoff

- Dependencies: T-0004, T-0013.
- Linked GitHub issue: [#12](https://github.com/JannisRln/xcp-studio/issues/12).
- Changes to shared interfaces require contract-first coordination and an ADR if architecture changes.
- Agent must claim ownership in this ticket and update INDEX.md before overlapping code edits.

## Evidence and completion

- Implementation PR / commit: pending.
- CI workflow/head SHA: pending.
- Test/fixture evidence: pending.
- Known limitations and follow-ups: pending.
