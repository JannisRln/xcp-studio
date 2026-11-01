---
id: T-0013
title: Local API security and guarded hardware safety policy
status: ready
priority: P0
area: safety
owner: unassigned
branch: none
github_issue: 10
depends_on: []
requirements: [SEC-001, SEC-002, SEC-003, SEC-005, CAL-006, CAL-007]
---

# T-0013 — Local API security and guarded hardware safety policy

## Context / desired behavior

The API binds to loopback, but a comprehensive remote exposure policy, WebSocket limits, resource caps and hardware write gating are not implemented.

**Desired outcome:** Local API security and guarded hardware safety policy. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [ ] Threat-model loopback/remote access, credentials, WebSocket origin, file uploads and ECU write operations.
- [ ] Enforce bounded upload/WS/frame/session/rate limits and clear rejection semantics.
- [ ] Define default read-only hardware policy, operator confirmation and safe write capability selection.
- [ ] Implement redaction rules for logs and bugreport bundles.
- [ ] Document loss-of-response and rollback limitations without implying ECU data unchanged.

## Non-goals

- Do not enable remote bind or calibration write by merely changing a configuration flag.
- No claim of ISO 26262 certification.

## Owned paths and interface boundaries

- docs/security-safety.md (new), crates/xcp-server API middleware/validation, calibration guard interfaces.
- Coordinate XCP session with T-0004 and UI prompts/transaction with T-0007.

## Acceptance criteria

- [ ] Default server is loopback-only and untrusted origin attempts are documented/handled.
- [ ] Oversized frames/uploads/rates reject with bounded resource use.
- [ ] Hardware writes are off by default; negative write-path tests prevent silent changes.
- [ ] Diagnostic bundle tests exclude secrets and private file paths.

## Verification plan

- [ ] Threat model/review checklist plus malformed input/stress tests.
- [ ] Proof of default read-only hardware policy and explicit risk note.
- [ ] Current PR head passes required CI and negative-path tests; distinguish simulator from HIL evidence.

## Dependencies / handoff

- Dependencies: none.
- Linked GitHub issue: [#10](https://github.com/JannisRln/xcp-studio/issues/10).
- Changes to shared interfaces require contract-first coordination and an ADR if architecture changes.
- Agent must claim ownership in this ticket and update INDEX.md before overlapping code edits.

## Evidence and completion

- Implementation PR / commit: pending.
- CI workflow/head SHA: pending.
- Test/fixture evidence: pending.
- Known limitations and follow-ups: pending.
