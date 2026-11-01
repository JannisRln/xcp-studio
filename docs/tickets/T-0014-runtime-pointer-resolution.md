---
id: T-0014
title: Bounded runtime pointer-chain resolver
status: blocked
priority: P0
area: ecu-runtime
owner: chatgpt-t0014-core
branch: feature/T-0014-bounded-pointer-core
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

## Independent core phase (claimed; full ticket remains BLOCKED)

- **Scope and owner:** `chatgpt-t0014-core` claims only the read-only, simulator/mock memory resolver on `feature/T-0014-bounded-pointer-core`. The full T-0014 remains blocked pending session identity/mapping proof, contract coordination and integration review.
- **Implementation:** `crates/xcp-core/src/ecu/resolver.rs` uses existing read-only DWARF descriptors without changing `metadata.rs`, session actor, server DTOs, or frontend. It derives pointer byte width from the verified target layout and requires typed pointer sizes to match. Only explicit link-to-runtime mappings may supply a root. No DWARF runtime expression is evaluated, and no raw link-time address becomes a read address by default.
- **Bounds and failures:** 24 path steps, 8 dereferences, 16 approved regions; checked address arithmetic, region containment, known-sized fields, endianness, NULL/cycle detection, reader failures and ECU/image/session/mapping-generation mismatches. Identity is checked before/after reads. Result includes original source provenance, traversal trace, host observation time and caller-supplied observation version.
- **Mock tests:** `crates/xcp-core/tests/runtime_pointer_resolver.rs` uses synthetic 32-bit little-endian and 64-bit big-endian pointer-chain fixtures, plus negative cases. This is NOT XCP session integration, a device identity validator, an arbitrary DWARF location evaluator or a hardware test.
- **Required handoff:** Integrator must prove target identity + image relocation map independently, connect reads through the serialized session with deadlines, invalidate/cancel on reconnect or new mapping, and agree on DTO/eligibility changes with T-0012 before attempting integration. A resolved address is **never** itself permission to write or a durable read token. Unit tests cannot rule out pointer mutation between resolution and later use; re-resolve under session ownership.
- **Validation:** Local Rust toolchain unavailable in this execution environment. GitHub Windows PR CI is required; mark each test/check passed only with a final run on the current PR head. No simulator/physical hardware session, HIL, or frontend integration evidence is claimed.

## Evidence and completion

- Implementation PR / commit: open draft PR linked in handoff after creation; no merge yet.
- CI workflow/head SHA: pending.
- Test/fixture evidence: `crates/xcp-core/tests/runtime_pointer_resolver.rs` (mock-memory-only); CI pending.
- Known limitations and follow-ups: independently verified ECU identity/load mapping, session read serialization, stale pointer refresh, runtime expressions, live access eligibility, chart signal mapping and any public contract work remain blocked.
