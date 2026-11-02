---
id: T-0008
title: A2L parsing, physical conversion and metadata reconciliation
status: in-progress
priority: P1
area: a2l
owner: ChatGPT-A2L-core
branch: feature/T-0008-a2l-core
github_issue: 11
depends_on: [T-0003]
requirements: [A2L-001, A2L-002, A2L-003, A2L-004, A2L-005, ECU-007]
---

# T-0008 — A2L parsing, physical conversion and metadata reconciliation

## Context / desired behavior

No A2L parser or typed metadata reconciliation has been delivered.

**Desired outcome:** A2L parsing, physical conversion and metadata reconciliation. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [x] Evaluate maintained Rust A2L parser and record license/coverage decision (see [decision](../a2l-core-phase.md)).
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

- **Core-only independent phase claimed** on branch feature/T-0008-a2l-core. Full ticket remains blocked on canonical T-0003 metadata integration and T-0012 interface coordination. No DTO, session, UI, or calibration-write changes in this phase.

- Dependencies: T-0003.
- Linked GitHub issue: [#11](https://github.com/JannisRln/xcp-studio/issues/11).
- Changes to shared interfaces require contract-first coordination and an ADR if architecture changes.
- Agent must claim ownership in this ticket and update INDEX.md before overlapping code edits.

## Evidence and completion

- Implementation PR / commit: [draft PR #48](https://github.com/JannisRln/xcp-studio/pull/48), branch feature/T-0008-a2l-core.
- CI workflow/head SHA: pending.
- Test/fixture evidence: crates/xcp-core/tests/a2l_core.rs and tests/fixtures/t0008-golden.a2l; execution evidence via PR CI.
- Known limitations and follow-ups: read-only core; only scalar numeric conversions and metadata diagnostics. UI, vendor-specific typed XCP IF_DATA, maps/tables, runtime address validation and contract integration deferred; see [core decision](../a2l-core-phase.md).
