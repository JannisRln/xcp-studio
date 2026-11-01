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

Current endpoints are unversioned and the WebSocket has no acquisition/session ID, quality semantics, stable errors or shared contract fixtures.

**Desired outcome:** Versioned REST and WebSocket contracts with cross-language tests. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [ ] Agree on versioned REST/WS DTOs and publish success/invalid/error JSON fixtures.
- [ ] Define timestamp, integer precision, address provenance, quality/gap and error codes.
- [ ] Implement server-side runtime validation and TS boundary parsing for untrusted responses.
- [ ] Provide additive migration from unversioned endpoints and contract compatibility tests.
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

- Implementation PR / commit: pending.
- CI workflow/head SHA: pending.
- Test/fixture evidence: pending.
- Known limitations and follow-ups: pending.
