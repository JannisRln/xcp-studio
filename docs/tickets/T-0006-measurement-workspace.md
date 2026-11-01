---
id: T-0006
title: Real measurement workspace, charts and CSV accuracy
status: in-progress
priority: P0
area: frontend-measurements
owner: assistant-live-view
branch: feat/T-0006-canvas-measurement-tools
github_issue: 9
depends_on: [T-0002, T-0005]
requirements: [MEAS-003, MEAS-008, MEAS-009, UI-005]
---

# T-0006 — Real measurement workspace, charts and CSV accuracy

## Context / desired behavior

**Product priority (2026-11-01): Live View takes precedence over recording.** The modular dashboard and browser chart/CSV baseline are merged. Merged [PR #27](https://github.com/JannisRln/xcp-studio/pull/27) consumes the v1 acquisition contract from merged PR #25. Merged [PR #28](https://github.com/JannisRln/xcp-studio/pull/28) adds chart zoom/pan, unit-aware axes, cursor and bounded spike-preserving decimation. T-0002 remains partially open, but the measurement component boundary already exists, making this client integration independently reviewable.

**Desired outcome:** Real measurement workspace, charts and CSV accuracy. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [x] Build reusable time-series chart with time axis, legend, zoom/pan, cursor, per-unit axes and extrema-preserving decimation.
- [ ] Provide a signal table with raw/physical values, quality, type, unit and timestamp; incremental Live View PR adds last-receipt freshness, observed rate and stale indicators, while physical conversion/ECU quality still remain open.
- [x] Implement frontend visualization pause, backend stop, reattach after page navigation/reload, and subscriber gap/drop counters. New Live View phase adds capped automatic reconnect/watchdog, monotonic sample freshness, UI rate and sequence-gap detection; chart gap annotation remains future work.
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

- Live View enhancement PR: in progress (default start page, connect/start controls, live metrics, reconnect and stream-staleness recovery).
- Implementation PRs: [#27](https://github.com/JannisRln/xcp-studio/pull/27) shared backend acquisition, pause/reattach and CSV; [#28](https://github.com/JannisRln/xcp-studio/pull/28) interactive chart and unit axes; both merged.
- CI: [#115](https://github.com/JannisRln/xcp-studio/actions/runs/41291904365) and [#117](https://github.com/JannisRln/xcp-studio/actions/runs/41292351637), all three jobs green before merge.
- Tests: acquisitionV1 contract parsing, invalid/out-of-range sample rejection, UI frame/csv metadata, 2,000-frame buffer, chart zoom/pan axes and extrema under 10k-point fixture. **No complete browser/server E2E yet.**
- Limitations: CSV is an optional bounded browser preview, not complete backend recording; missing client samples can occur after reconnect, no replay; chart now groups per unit with zoom/pan/cursor, but backend DAQ, per-signal quality conversion, replay and full browser E2E remain open. T-0006 remains in progress, T-0015 records durably.


## Canvas performance and measurement cursor phase

The Canvas measurement-scope PR replaces SVG polylines with a device-pixel-ratio-aware Canvas 2D renderer. A fixed-capacity (32,768-frame) `Float64Array` ring holds time and signal values, with pixel-bucket extrema preserving narrow peaks. It adds A/B cursors, delta time, inverse delta time, per-signal delta values, wheel zoom and Shift+drag panning. Acquisition remains independent from display rendering.

**Performance limits:** this is an incremental architecture step, not a 10 kHz / 60 FPS certification. The upstream `useAcquisition` still copies a bounded React preview on every received batch; a future follow-up should stream directly into a Worker-owned buffer with rAF-only chart notifications, and benchmark 10/50/100 signals on Windows. uPlot/React Grid Layout are candidates, but this phase uses dependency-free Canvas so the existing reproducible lockfile and CI remain intact. The browser E2E test must be adapted from SVG `polyline` inspection to Canvas pixel or buffer assertions before merging its branch.
