---
id: T-0012
title: Versioned REST and WebSocket contracts with cross-language tests
status: blocked
priority: P0
area: api
owner: unassigned
branch: none
github_issue: 8
depends_on: []
requirements: [API-001, API-002, API-003, API-004, DIAG-001]
---

# T-0012 — Versioned REST and WebSocket contracts with cross-language tests

## Context / desired behavior

The baseline endpoints are unversioned. Merged PR #22 added an additive **v1 HTTP slice** for health, current simulator session and raw memory reads, with typed errors and shared Rust/TypeScript fixtures. Merged PR #25 added shared v1 acquisition lifecycle and WebSocket sample/gap fixtures, and PR #27 added their validated TypeScript consumer; full v1 transport/quality/error unification remains follow-up work.

**Desired outcome:** Versioned REST and WebSocket contracts with cross-language tests. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [x] Define and test versioned **HTTP** success/error DTOs and shared fixtures; full WS design remains a documented target.
- [x] Define timestamp, integer precision, address provenance, quality/gap and error codes (additive wire contract; producer/consumer review pending).
- [x] Implement server-side runtime validation and TS boundary parsing for the new versioned health/session/read endpoints.
- [x] Provide additive health/session/read routes with shared fixtures; legacy XCP endpoints retained for existing callers.
- [x] Separate acquisition creation/stop REST controls from WebSocket subscription to a pre-existing acquisition ID, implemented in PR #25.

## Non-goals

- Do not rewrite the entire session actor in the API PR.
- No remote access without authentication/origin policy.

## Owned paths and interface boundaries

- docs/api-contract.md, crates/xcp-server/src/api/, frontend/src/core/api* and shared contract fixtures.
- Own public DTO schema; service owners T-0004/T-0005 coordinate implementation against agreed versions.

## Acceptance criteria

- [ ] Rust responses and TS consumer parse identical checked-in contract fixtures.
- [ ] Malformed, missing, overflow and unknown enum inputs return stable documented errors.
- [ ] Old unversioned endpoint compatibility is retained or a tested migration is declared.
- [ ] WebSocket subscribers do not independently create ECU polling schedules in target contract.

## Verification plan

- [ ] Contract fixture location, frontend/Rust tests and backward compatibility matrix.
- [ ] API schema/version change notes and code review from affected feature owners.
- [ ] Current PR head passes required CI and negative-path tests; distinguish simulator from HIL evidence.

## Dependencies / handoff

- Dependencies: none.
- Linked GitHub issue: [#8](https://github.com/JannisRln/xcp-studio/issues/8).
- Changes to shared interfaces require contract-first coordination and an ADR if architecture changes.
- Agent must claim ownership in this ticket and update INDEX.md before overlapping code edits.

## Evidence and completion

- Implementation PRs: [#22](https://github.com/JannisRln/xcp-studio/pull/22) (v1 health/session/read), [#25](https://github.com/JannisRln/xcp-studio/pull/25) (shared v1 acquisition WS) and [#27](https://github.com/JannisRln/xcp-studio/pull/27) (validated TS consumer), all merged.
- CI: green PR #25 [run #113](https://github.com/JannisRln/xcp-studio/actions/runs/41291388091) and PR #27 [run #115](https://github.com/JannisRln/xcp-studio/actions/runs/41291904365), plus original PR #22 green checks.
- Tests: contracts/v1 JSON fixtures validated by Rust server tests and TypeScript Vitest tests; malformed/error payloads, subscriber gap and lifecycle validation covered.
- Known limitations: shared v1 acquisition WS subscription exists; legacy unversioned per-client polling remains for compatibility. Rich raw/physical quality, exact 64-bit timing, recording and full error-family versioning remain unfinished. Complete under T-0005 and the remaining scope of T-0012.


## Historical draft contract work — PR #37 (superseded by merged PR #46)

- Branch: `feature/T-0012-quality-wire-contracts`; [draft PR #37](https://github.com/JannisRln/xcp-studio/pull/37); owner: api-contract-agent.
- Requirements: API-001/002/003/004, DIAG-001; also coordinated with MEAS-005/006/012.
- Implements optional v1 sample quality/type/address and clock provenance fields, subscriber-only gap scope, structured validation-detail errors and shared success/negative JSON fixtures. No new HTTP/WS route. Old v1/unversioned payloads remain valid.
- Tests: Rust unit fixture/invalid-enum/value width checks and frontend Vitest fixture/invalid-time/type/gap tests. **Local Rust toolchain unavailable; CI on current PR head must prove success before merge.**
- Backend T-0005 and frontend T-0006 owner review was requested via issue #8; independent sign-off was not recorded before the subsequent owner-directed merge of PR #46. Do not mark the versioned contract accepted or DONE until these sign-offs are recorded.
- Boundaries: simulator-only XCP polling; `quality: valid` means a finite successfully decoded read, not hardware clock or verified ECU address; no DAQ/replay/recorder/calibration or missing-value representation.
- Rollback of the integrated change would require reverting merged PR #46; no legacy endpoint migration was introduced.

## Post-merge contract review and acceptance gate — 2026-11-01

- [PR #46](https://github.com/JannisRln/xcp-studio/pull/46) is merged on `main` at `ee793a86119049f4400afc18193b4bd2135a1d44`; Windows pre-merge CI [41323689344](https://github.com/JannisRln/xcp-studio/actions/runs/41323689344) and post-merge main CI [41324320683](https://github.com/JannisRln/xcp-studio/actions/runs/41324320683) passed Rust, frontend, documentation, and live simulator E2E jobs.
- The additive optional fields represent **host-after-read** time (`timestamp_origin=host_utc_after_reads`), acquisition-relative monotonic time (`monotonic_clock=acquisition_elapsed`), `quality=valid` only for finite successful simulator decoding, `address_origin=manual` only for user-provided addresses, and `gap.scope=subscriber` for subscriber loss (not ECU DAQ loss). These are not hardware-grade timing/quality or runtime address verification.
- The reviewed GitHub PR has a COMMENTED review, but **no independent T-0005 backend and T-0006 frontend owner sign-off**. This acceptance dependency is explicitly recorded in issue #8.
- Status is **BLOCKED for contract-owner acceptance** (no active PR/claim), not DONE. Record both approvals, then review missing precision/quality/error cases and only update status in a follow-up PR. Keep v1 compatibility and T-0013 resource limits intact.
