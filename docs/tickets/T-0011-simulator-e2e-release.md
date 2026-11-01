# T-0011 — Simulator end-to-end acceptance and measured performance

---
id: T-0011
title: Simulator end-to-end acceptance and measured performance
status: blocked
priority: P0
area: release-quality
owner: unassigned
branch: none
github_issue: 3
depends_on: [T-0005, T-0006, T-0007]
requirements: [QA-003, QA-007]
---

## Context / desired behavior

Component tests and partial simulator endpoints exist; the epic's complete connect→measure→export→write/verify flow has not passed as a single automated test.

**Desired outcome:** Simulator end-to-end acceptance and measured performance. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [ ] Build deterministic simulator E2E fixture and repeatable launch/cleanup.
- [ ] Exercise connect, typed metadata or explicit safe signal, acquisition, chart, recording, CSV export and disconnect.
- [ ] Exercise calibrated value preview/write/readback plus rejection and mismatch scenarios.
- [ ] Measure rate, jitter, drops and CPU/memory at stated simulator and hardware configurations.
- [ ] Publish release acceptance report with reproducible commands and known limitations.

## Non-goals

- No unsupported throughput guarantee or certification.
- Hardware CI is not a substitute for bench tests.

## Owned paths and interface boundaries

- integration-tests/, frontend/test/e2e/ or repo tests/, docs/test-strategy.md and release evidence.
- Use public APIs without bypassing backend business logic; coordinate with feature owners.

## Acceptance criteria

- [ ] One automated scenario proves real simulator-sourced samples through chart/CSV and calibration readback.
- [ ] Negative disconnect, invalid address and mismatch cases are included.
- [ ] Benchmark reports measured setup and statistical results, not a bare 1 kHz claim.
- [ ] Release checklist maps every P0 requirement to test evidence.

## Verification plan

- [ ] E2E run URL/fixtures and CSV golden output.
- [ ] Bench environment, channel count, sample frequency, duration, p50/p95 jitter and loss.
- [ ] Current PR head passes required CI and negative-path tests; distinguish simulator from HIL evidence.

## Dependencies / handoff

- Dependencies: T-0005, T-0006, T-0007.
- Linked GitHub issue: [#3](https://github.com/JannisRln/xcp-studio/issues/3).
- Changes to shared interfaces require contract-first coordination and an ADR if architecture changes.
- Agent must claim ownership in this ticket and update INDEX.md before overlapping code edits.

## Evidence and completion

- Implementation PR / commit: pending.
- CI workflow/head SHA: pending.
- Test/fixture evidence: pending.
- Known limitations and follow-ups: pending.
