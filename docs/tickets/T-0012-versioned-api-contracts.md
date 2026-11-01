---
id: T-0012
title: Versioned REST and WebSocket contracts with cross-language tests
status: ready
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
- [ ] Define timestamp, integer precision, address provenance, quality/gap and error codes.
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
