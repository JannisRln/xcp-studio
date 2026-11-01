---
id: T-0014
title: Bounded runtime pointer-chain resolver
status: blocked
priority: P0
area: ecu-runtime
owner: unassigned
branch: none
github_issue: 6
depends_on: [T-0003, T-0004]
requirements: [ECU-009]
---

# T-0014 — Bounded runtime pointer-chain resolver

## Context / desired behavior

The prototype symbol explorer exposes link-time ELF addresses but does not reliably dereference dynamic ECU pointer locations.

**Desired outcome:** Bounded runtime pointer-chain resolver. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [ ] Use canonical typed metadata to determine target pointer width and endianness.
- [ ] Resolve runtime location expressions and bounded pointer-chain reads through serialized XCP session.
- [ ] Detect NULL, overflow, out-of-region, cycles, unsupported expressions and stale identity.
- [ ] Preserve source expression, resolution steps, timestamps and explicit failure reasons.
- [ ] Integrate resolved address states into read eligibility and chart signal mapping.

## Non-goals

- Do not guess pointer values from host architecture or arbitrary memory.
- No writes through unresolved pointer paths.

## Owned paths and interface boundaries

- crates/xcp-core/src/metadata/resolver* or ecu/resolver*, integration fixtures; narrow API extension via T-0012.
- Requires canonical variable descriptor from T-0003 and safe session reads from T-0004.

## Acceptance criteria

- [ ] Nested struct/member pointer fixtures resolve expected runtime addresses.
- [ ] NULL, cycle and out-of-bounds failure prevents downstream XCP read/write.
- [ ] Pointer length/endian differences and depth caps are deterministic.
- [ ] Refreshed pointer targets carry version/timestamp so stale addresses cannot silently persist.

## Verification plan

- [ ] Golden pointer chain tests across fixture endianness/width.
- [ ] Bounded chain-depth and invalid memory fault tests.
- [ ] Current PR head passes required CI and negative-path tests; distinguish simulator from HIL evidence.

## Dependencies / handoff

- Dependencies: T-0003, T-0004.
- Linked GitHub issue: [#6](https://github.com/JannisRln/xcp-studio/issues/6).
- Changes to shared interfaces require contract-first coordination and an ADR if architecture changes.
- Agent must claim ownership in this ticket and update INDEX.md before overlapping code edits.

## Evidence and completion

- Implementation PR / commit: pending.
- CI workflow/head SHA: pending.
- Test/fixture evidence: pending.
- Known limitations and follow-ups: pending.
