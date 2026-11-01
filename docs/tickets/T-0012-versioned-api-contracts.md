---
id: T-0012
title: Versioned REST and WebSocket contracts with cross-language tests
status: in-progress
priority: P0
area: api
owner: assistant-api-agent
branch: feat/T-0012-versioned-api-contracts
github_issue: 8
depends_on: []
requirements: [API-001, API-002, API-003, API-004, DIAG-001]
---

# T-0012 — Versioned REST and WebSocket contracts with cross-language tests

## Context / desired behavior

The baseline endpoints are unversioned. This PR adds an additive **v1 HTTP slice** for health, current simulator session and raw memory reads, with typed errors and shared Rust/TypeScript fixtures. Versioned acquisition/stream contracts and separate acquisition ownership remain T-0005 follow-up work.

**Desired outcome:** Versioned REST and WebSocket contracts with cross-language tests. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [x] Define and test versioned **HTTP** success/error DTOs and shared fixtures; full WS design remains a documented target.
- [ ] Define timestamp, integer precision, address provenance, quality/gap and error codes.
- [x] Implement server-side runtime validation and TS boundary parsing for the new versioned health/session/read endpoints.
- [x] Provide additive health/session/read routes with shared fixtures; legacy XCP endpoints retained for existing callers.
- [ ] Separate control requests from subscribing to a pre-existing acquisition.

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

- Implementation PR: will be linked after creation; this is a partial API contract slice.
- CI workflow/head SHA: pending.
- Test/fixture evidence: pending.
- Known limitations: v1 does not yet define a shared acquisition subscription or all error categories; per-client legacy WS polling remains. Complete under T-0005 and the remaining scope of T-0012.
