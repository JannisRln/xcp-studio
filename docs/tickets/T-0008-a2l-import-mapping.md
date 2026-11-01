# T-0008 — A2L parsing, physical conversion and metadata reconciliation

---
id: T-0008
title: A2L parsing, physical conversion and metadata reconciliation
status: blocked
priority: P1
area: a2l
owner: unassigned
branch: none
github_issue: 11
depends_on: [T-0003]
requirements: [A2L-001, A2L-002, A2L-003, A2L-004, A2L-005, ECU-007]
---

## Context / desired behavior

No A2L parser or typed metadata reconciliation has been delivered.

**Desired outcome:** A2L parsing, physical conversion and metadata reconciliation. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [ ] Evaluate maintained Rust A2L parser and record license/coverage decision.
- [ ] Import MEASUREMENT, CHARACTERISTIC, COMPU_METHOD, RECORD_LAYOUT and needed IF_DATA.
- [ ] Resolve raw/physical conversions with units, scaling, bounds and rounding.
- [ ] Compare A2L claims against ELF/DWARF metadata with provenance-preserving conflicts.
- [ ] Add fixtures and UI import/diagnostic flow.

## Non-goals

- Do not replace ELF/DWARF with unverified A2L addresses.
- Hardware unlock/page handling belongs to session/calibration work.

## Owned paths and interface boundaries

- crates/xcp-core/src/a2l/ or metadata/a2l/, frontend/src/features/symbols/a2l* and synthetic fixtures.
- Contract extension coordinated with T-0012 and ECU canonical model T-0003.

## Acceptance criteria

- [ ] Golden A2L fixtures load and conversion results match expected physical units.
- [ ] Type/address disagreement is reported explicitly, not resolved by guess.
- [ ] Malformed input and unsupported conversion fail with actionable diagnostics.
- [ ] No automatic XCP write is enabled by imported file alone.

## Verification plan

- [ ] Parser licensing note and valid/invalid fixture tests.
- [ ] Cross-source metadata match/mismatch case matrix.
- [ ] Current PR head passes required CI and negative-path tests; distinguish simulator from HIL evidence.

## Dependencies / handoff

- Dependencies: T-0003.
- Linked GitHub issue: [#11](https://github.com/JannisRln/xcp-studio/issues/11).
- Changes to shared interfaces require contract-first coordination and an ADR if architecture changes.
- Agent must claim ownership in this ticket and update INDEX.md before overlapping code edits.

## Evidence and completion

- Implementation PR / commit: pending.
- CI workflow/head SHA: pending.
- Test/fixture evidence: pending.
- Known limitations and follow-ups: pending.
