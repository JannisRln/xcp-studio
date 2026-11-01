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

The API already binds to loopback. Merged PR #29 enforces strict loopback Host headers, approved local browser Origin/Fetch Metadata for HTTP and WebSocket, plus 16-KiB WebSocket message/frame limits. It is **not authentication** and does not enable remote access or hardware writes. Remaining per-session rate/connection limits and write gating are tracked in this ticket.

**Desired outcome:** Local API security and guarded hardware safety policy. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [x] Document browser cross-origin/CSRF, WebSocket origin and DNS-rebinding risks on the loopback API; full threat-model scope remains open.
- [x] Enforce loopback Host/approved Origin, reject cross-site browser fetches, and cap legacy/shared WS messages/frames to 16 KiB; request-rate and total connection caps remain unimplemented.
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

- Implementation PR: [#29](https://github.com/JannisRln/xcp-studio/pull/29), local HTTP/WS Host, Origin and fetch-site guard, 16 KiB message cap; merged.
- CI: [run #119](https://github.com/JannisRln/xcp-studio/actions/runs/41292669328) with Rust/frontend/docs successful before merge.
- Tests: Rust unit tests for authorized local dev Origins, denied external origins/DNS rebinding hosts, cross-site browser fetches and invalid Host ports.
- Known limitations: local origin policy is **not authentication**; no remote authentication/authorization/TLS, no per-client request rate limits, no validated hardware write enablement, no log redaction; T-0013 remains in-progress.
