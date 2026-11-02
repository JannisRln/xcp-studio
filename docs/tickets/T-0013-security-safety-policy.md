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

The API already binds to loopback. Merged PR #29 enforces strict loopback Host headers, approved local browser Origin/Fetch Metadata for HTTP and WebSocket, plus 16-KiB WebSocket message/frame limits. It is **not authentication** and does not enable remote access or hardware writes. The current PR adds bounded request rates, concurrent request/ELF budgets, timeouts, legacy WS connection admission and an explicit fail-closed policy for future hardware integration. Full hardware write transactions and diagnostic bundles remain out of scope.

**Desired outcome:** Local API security and guarded hardware safety policy. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [x] Document browser cross-origin/CSRF, WebSocket origin and DNS-rebinding risks on the loopback API; full threat-model scope remains open.
- [x] Enforce loopback Host/approved Origin, reject cross-site browser fetches, and cap legacy/shared WS messages/frames to 16 KiB; request-rate and total connection caps remain unimplemented.
- [x] Define read-only hardware default and requirements for explicit operator confirmation; implementation denies all ECU memory writes, including simulator writes through this policy, until a separately reviewed write transaction exists.
- [x] Document allowlist-based diagnostic export/redaction rules and replace legacy session/ELF error-detail disclosure with fixed safe messages. No bundle exporter exists yet; its fixture tests remain pending.
- [x] Document unknown-after-send outcomes and prohibit automatic rollback assumptions.

## Non-goals

- Do not enable remote bind or calibration write by merely changing a configuration flag.
- No claim of ISO 26262 certification.

## Owned paths and interface boundaries

- docs/security-safety.md (new), crates/xcp-server API middleware/validation, calibration guard interfaces.
- Coordinate XCP session with T-0004 and UI prompts/transaction with T-0007.

## Acceptance criteria

- [x] Default server is loopback-only and untrusted origin attempts are documented/handled.
- [x] Incoming WS messages, HTTP body sizes, request rate/inflight counts and ELF parser concurrency have explicit bounded checks; live HTTP load/fault tests remain pending.
- [x] Physical memory writes have no production HTTP entry point; policy denies even verified-target writes and unit tests exercise the denial. Hardware integration and HIL remain separate.
- [ ] Diagnostic bundle fixture tests exclude secrets and private paths (no diagnostic bundle/export implementation exists).

## Verification plan

- [ ] Full threat model, live malformed-upload and connection-flood stress tests (unit-level negative quota/origin tests added).
- [x] Default-deny policy unit tests and documented limitations; no physical HIL verification.
- [ ] Current PR head passes required CI and negative-path tests; distinguish simulator from HIL evidence (CI pending).

## Dependencies / handoff

- Dependencies: none.
- Linked GitHub issue: [#10](https://github.com/JannisRln/xcp-studio/issues/10).
- Changes to shared interfaces require contract-first coordination and an ADR if architecture changes.
- Agent must claim ownership in this ticket and update INDEX.md before overlapping code edits.

## Evidence and completion

- Implementation PR: [#29](https://github.com/JannisRln/xcp-studio/pull/29), local HTTP/WS Host, Origin and fetch-site guard, 16 KiB message cap; merged.
- CI: [run #119](https://github.com/JannisRln/xcp-studio/actions/runs/41292669328) with Rust/frontend/docs successful before merge.
- Tests: Rust unit tests for authorized local dev Origins, denied external origins/DNS rebinding hosts, cross-site browser fetches and invalid Host ports.
- Merged hardening PR: [#42](https://github.com/JannisRln/xcp-studio/pull/42) (merged on 2026-11-01). Initial full CI: [run #162](https://github.com/JannisRln/xcp-studio/actions/runs/41311315002), green on code head `d69b3923077706d5c9bbd4dcc958426ee2a2eaec` (Windows Rust fmt/Clippy/tests, frontend and docs). A ticket evidence-only commit requires CI re-validation on its new head.
- Historical implementation branch: `feature/T-0013-local-api-resource-guards`. Adds `security.rs` budgets (16 KiB JSON, 32 MiB ELF, 32 inflight requests, 2 ELF parsers, 256 requests/s), 8 legacy WS streams and send/config timeouts, stricter WS validation, startup-checked `hardware_policy.rs` that rejects all memory writes, safe legacy error responses, and negative unit tests. No session actor, API DTO or frontend files modified.
- Verified: [PR-head CI 41311506965](https://github.com/JannisRln/xcp-studio/actions/runs/41311506965) and [latest main CI 41324320683](https://github.com/JannisRln/xcp-studio/actions/runs/41324320683) passed; **direct network stress and diagnostic export integration remain pending**. Physical hardware never exercised.
- Known limitations: local origin policy is **not authentication**; no remote authentication/authorization/TLS; global rate limiting is not per-client fairness; HTTP cancellation does not cancel an already-running XCP operation; no hardware write enablement, authenticated device selection, calibration API or diagnostic bundle exporter. The existing v1 XCP error mapping needs contract-owner review before physical use. T-0013 returns to **ready** for remaining acceptance/implementation, not DONE.

## Post-merge integration reconciliation — 2026-11-01

- [PR #42](https://github.com/JannisRln/xcp-studio/pull/42) merged at main commit `1ddf16bcca1aafe42f9610fe2e195f111535da02`. Bounded HTTP/ELF/WS admission and deny-by-default memory write policy are integrated.
- Historical owner/branch are released; further **READY** work includes live rate-limit/slow-upload/socket tests, redacted support-bundle fixtures and independently reviewed hardware-read identity safety. Do not enable physical/simulated write routes or remote backend access.
- Loopback host/origin checks are not authentication, and the current policy denies ECU memory writes for every target classification.
