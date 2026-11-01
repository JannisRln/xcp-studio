---
id: T-0016
title: Structured transport/acquisition diagnostics and support bundles
status: in-progress
priority: P1
area: diagnostics
owner: chatgpt-t0016-core
branch: feature/T-0016-diagnostics-core
github_issue: 13
depends_on: [T-0004, T-0005]
requirements: [DIAG-003, DIAG-004]
---

# T-0016 — Structured transport/acquisition diagnostics and support bundles

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

## Isolated core phase (2026-11-01)

This independently reviewable phase is authorized by the T-0016 work request despite unfinished T-0004/T-0005 integration. It does not imply the acceptance criteria are complete.

- Rust: `crates/xcp-server/src/diagnostics/mod.rs` contains an in-process fixed-capacity ring, structured timestamped and correlated events, severity and subsystem classifications, numeric-only context and counters, and an operator-approved size-limited JSON exporter. It does not install logging hooks or expose a new REST/WS route.
- Browser: `frontend/src/features/diagnostics/` provides severity/subsystem filters, current health/session fault separation and a clearly labeled **browser-only**, manual redacted export. Existing string logs have no trusted timestamps or correlation IDs; values are intentionally shown as unavailable.
- Privacy: event messages and detail fields are enum-controlled, opaque IDs are strict scope-prefixed hex-only values; raw exception text, secrets, local paths, signal names, ECU address and memory bytes are never inserted into the export. Inputs failing validation are discarded.
- Remaining integration: session/connect/reconnect and XCP error instrumentation (T-0004), acquisition lifecycle, gap and subscriber metrics (T-0005), WebSocket producer hooks and public backend diagnostics endpoint/schema (T-0012 review), end-to-end panel timeline tests. Backend `export_approved` is **not** yet reachable through the browser.
- Existing API DTOs, session actor and acquisition scheduling remain unchanged; no promises of hardware diagnosis or durable logs.

## Evidence and completion

- Implementation PR / commit: see feature branch and associated T-0016 PR (link entered after PR creation).
- CI workflow/head SHA: pending.
- Test/fixture evidence: Rust in-module fault/redaction/eviction/export tests; browser `diagnosticsModel.test.ts` (test runner/CI verification pending).
- Known limitations and follow-ups: integrations and end-to-end coverage deferred until dependency/contract review; no backend support download or wire schema.
