---
id: T-0006
title: Real measurement workspace, charts and CSV accuracy
status: in-progress
priority: P0
area: frontend-measurements
owner: assistant-measurement-agent
branch: feat/T-0006-shared-acquisition-ui
github_issue: 9
depends_on: [T-0002, T-0005]
requirements: [MEAS-003, MEAS-008, MEAS-009, UI-005]
---

# T-0006 — Real measurement workspace, charts and CSV accuracy

## Context / desired behavior

The modular dashboard and browser chart/CSV baseline are merged. This narrowly scoped UI/contract PR consumes the **frozen v1 acquisition contract in PR #25**; merge it only after PR #25 is green and merged. T-0002 remains partially open, but the measurement component boundary already exists, making this client integration independently reviewable.

**Desired outcome:** Real measurement workspace, charts and CSV accuracy. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [ ] Build reusable time-series chart with correct time axis, legend, zoom/pan, cursor and per-unit scale policy.
- [ ] Provide a signal table with raw/physical values, quality, type, unit and timestamp.
- [x] Implement frontend visualization pause, backend stop, reattach after page navigation/reload, and subscriber gap/drop counters. Full gap rendering on the plotted time axis remains future work.
- [x] Export actual received backend samples with acquisition ID, sequence, wall/monotonic milliseconds and subscriber drop count; physical unit/quality conversion remains future work.
- [x] Bound browser visualization/CSV preview to 2,000 frames while the shared backend acquisition survives browser unmount; high-rate decimation and durable recording remain pending.

## Non-goals

- No fake charts presented as ECU output.
- Backend recorder is T-0015; do not rely on browser buffer for long recordings.

## Owned paths and interface boundaries

- frontend/src/features/measurements/, frontend/src/components/chart* and measurement-specific CSS/tests.
- Consume DTOs from T-0012; do not redefine WS schema or session lifecycle.

## Acceptance criteria

- [ ] Simulator values flow from one backend acquisition into chart/table and CSV with matching timestamps.
- [ ] Gaps, invalid samples and disconnected states are visible; no synthetic values leak into real view.
- [ ] View pause does not stop backend capture; explicit stop does.
- [ ] Keyboard interactions, unit labels and 10k+ sample render performance pass tests.

## Verification plan

- [ ] Component tests, CSV golden fixture and browser E2E connect→plot→export.
- [ ] Document chart sampling/decimation and any unsupported interactions.
- [ ] Current PR head passes required CI and negative-path tests; distinguish simulator from HIL evidence.

## Dependencies / handoff

- Dependencies: T-0002, T-0005.
- Linked GitHub issue: [#9](https://github.com/JannisRln/xcp-studio/issues/9).
- Changes to shared interfaces require contract-first coordination and an ADR if architecture changes.
- Agent must claim ownership in this ticket and update INDEX.md before overlapping code edits.

## Evidence and completion

- Implementation PR: shared acquisition frontend consumer; depends on backend PR #25.
- CI workflow/head SHA: pending.
- Test/fixture evidence: pending.
- Limitations: CSV is a bounded browser preview, not complete backend recording; missing client samples can occur after reconnect, no replay; chart still has one value axis and lacks per-unit scaling/zoom. T-0006 remains in progress, T-0015 records durably.
