---
id: T-0003
title: Typed ELF/DWARF metadata and location provenance
status: review
priority: P0
area: ecu-metadata
owner: chatgpt-ecu-metadata
branch: feature/T-0003-typed-dwarf-metadata
github_issue: 6
depends_on: []
requirements: [ECU-001, ECU-002, ECU-003, ECU-004, ECU-005, ECU-006, ECU-008, ECU-010]
---

# T-0003 — Typed ELF/DWARF metadata and location provenance

## Context / desired behavior

ELF symbol inspection and a DWARF compilation-unit summary exist; the typed variable tree and safe runtime location model are incomplete.

**Desired outcome:** Typed ELF/DWARF metadata and location provenance. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [x] Introduce typed variable descriptors for primitives, enums, typedefs, arrays, structs/unions, members and pointers.
- [x] Represent compile-unit origin, target endian/width/alignment, link-time location and runtime resolution state.
- [x] Bound DWARF expression interpretation; report unsupported, optimized-out or ambiguous locations explicitly.
- [x] Build synthetic ELF/DWARF fixtures with and without debug data and invalid inputs.
- [ ] Expose stable metadata DTOs only after contract agreement with T-0012.

## Non-goals

- Actual pointer dereference is T-0014.
- A2L conversion metadata is T-0008.

## Owned paths and interface boundaries

- crates/xcp-core/src/elf.rs and new crates/xcp-core/src/metadata/ modules; test fixtures in tests/ or crate-local fixtures.
- Coordinate any server response shape change with T-0012.

## Acceptance criteria

- [ ] Fixture variable type, size and member offsets match compiled sources (integration assertions added, CI pending).
- [ ] Invalid/stripped ELF and unsupported expressions are explicit errors/states.
- [ ] Unresolved runtime address is never passed to read/write API.
- [ ] Architecture/target endian and signedness are preserved in typed descriptors.

## Verification plan

- [ ] Unit/fixture tests plus negative cases; show actual parsed fixture paths.
- [ ] Document unsupported DWARF opcodes and remaining architecture gaps.
- [ ] Current PR head passes required CI and negative-path tests; distinguish simulator from HIL evidence.

## Dependencies / handoff

- Dependencies: none.
- Linked GitHub issue: [#6](https://github.com/JannisRln/xcp-studio/issues/6).
- Changes to shared interfaces require contract-first coordination and an ADR if architecture changes.
- Agent must claim ownership in this ticket and update INDEX.md before overlapping code edits.

## Evidence and completion

- Implementation PR / commit: this branch; PR pending assignment.
- CI workflow/head SHA: pending (do not claim acceptance before CI).
- Unit tests: `metadata::tests` validate malformed input, member offsets, recursive aliases and array overflow. Integration tests: `tests/dwarf_metadata.rs` validate GCC-compiled DWARF 4 type/members/pointers/array and stripped ELF; CI results pending.
- Known limitations: read-only crate API, no public REST schema change, unresolved static/runtime mapping, no arbitrary expression execution, no cross-unit type resolution, and no ECU pointer dereference. Member locations requiring expressions are marked unknown.
