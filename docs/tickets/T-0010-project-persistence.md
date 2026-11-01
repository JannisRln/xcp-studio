# T-0010 — Versioned project files and workspace restoration

---
id: T-0010
title: Versioned project files and workspace restoration
status: blocked
priority: P1
area: projects
owner: unassigned
branch: none
github_issue: 13
depends_on: [T-0002, T-0012]
requirements: [UI-006, PROJ-001, PROJ-002, PROJ-003, PROJ-004, PROJ-005]
---

## Context / desired behavior

Workspace signal and chart state is not persisted as a versioned project format.

**Desired outcome:** Versioned project files and workspace restoration. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [ ] Specify project schema version, migration rules and optional connection profiles without secrets.
- [ ] Persist ECU file identity/fingerprints, signal definitions, layouts, chart setup and acquisition presets.
- [ ] Implement atomic save/read with validation and deterministic corrupt-file errors.
- [ ] Reopen prior supported schema versions with explicit migration and preview.
- [ ] Show missing/stale ECU reference warnings without silently resolving to wrong addresses.

## Non-goals

- Long-running sample recording storage is T-0015.
- No cloud synchronization or remote collaboration service.

## Owned paths and interface boundaries

- crates/xcp-server/src/services/projects/, frontend/src/features/projects/ and versioned test fixtures.
- Shared DTO/schema definitions coordinated with T-0012.

## Acceptance criteria

- [ ] Roundtrip restores signal list, identities, layout and connection profile.
- [ ] Corrupt/newer-version projects fail without overwriting existing data.
- [ ] Changes in ELF/A2L identity block unsafe reads until manually reconciled.
- [ ] No passwords/driver secrets are persisted in cleartext project files.

## Verification plan

- [ ] Version migration fixture matrix, atomic-write fault tests and UI reopen test.
- [ ] Document schema version and compatibility policy.
- [ ] Current PR head passes required CI and negative-path tests; distinguish simulator from HIL evidence.

## Dependencies / handoff

- Dependencies: T-0002, T-0012.
- Linked GitHub issue: [#13](https://github.com/JannisRln/xcp-studio/issues/13).
- Changes to shared interfaces require contract-first coordination and an ADR if architecture changes.
- Agent must claim ownership in this ticket and update INDEX.md before overlapping code edits.

## Evidence and completion

- Implementation PR / commit: pending.
- CI workflow/head SHA: pending.
- Test/fixture evidence: pending.
- Known limitations and follow-ups: pending.
