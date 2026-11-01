# T-0016 — Structured transport/acquisition diagnostics and support bundles

---
id: T-0016
title: Structured transport/acquisition diagnostics and support bundles
status: blocked
priority: P1
area: diagnostics
owner: unassigned
branch: none
github_issue: 13
depends_on: [T-0004, T-0005]
requirements: [DIAG-003, DIAG-004]
---

## Context / desired behavior

Current UI has a local activity log but lacks backend-structured transport/session/acquisition history and diagnostic export.

**Desired outcome:** Structured transport/acquisition diagnostics and support bundles. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [ ] Add structured tracing for session, XCP errors, acquisition state, recording events and correlation IDs.
- [ ] Show diagnostics timeline with filters, severity, transport error codes and live statistics.
- [ ] Export operator-approved redacted logs plus build/OS/adapter context.
- [ ] Keep logging bounded, avoid dumping raw ECU memory, and test privacy protections.
- [ ] Produce reproducible fault-injection fixture events and support instructions.

## Non-goals

- Do not collect unsolicited remote telemetry.
- Do not introduce new backend acquisition ownership.

## Owned paths and interface boundaries

- crates/xcp-server/src/diagnostics/ and frontend/src/features/diagnostics/, docs/runbook.md.
- Coordinate message identifiers with T-0012, acquisition counters with T-0005 and redaction with T-0013.

## Acceptance criteria

- [ ] Reconnect, timeout and signal loss produce correlated structured events.
- [ ] Diagnostics page distinguishes transport/API/acquisition failures and shows bounded history.
- [ ] Export redacts credentials and private path data in fixtures.
- [ ] Diagnostic performance does not block capture or grow memory without bound.

## Verification plan

- [ ] Fault injection log fixture and UI integration tests.
- [ ] Redaction/queue limit tests and support-bundle example.
- [ ] Current PR head passes required CI and negative-path tests; distinguish simulator from HIL evidence.

## Dependencies / handoff

- Dependencies: T-0004, T-0005.
- Linked GitHub issue: [#13](https://github.com/JannisRln/xcp-studio/issues/13).
- Changes to shared interfaces require contract-first coordination and an ADR if architecture changes.
- Agent must claim ownership in this ticket and update INDEX.md before overlapping code edits.

## Evidence and completion

- Implementation PR / commit: pending.
- CI workflow/head SHA: pending.
- Test/fixture evidence: pending.
- Known limitations and follow-ups: pending.
