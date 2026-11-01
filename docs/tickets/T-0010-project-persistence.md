---
id: T-0010
title: Versioned project files and workspace restoration
status: blocked
priority: P0
area: projects
owner: unassigned
branch: none
github_issue: 13
depends_on: [T-0002, T-0012]
requirements: [UI-006, PROJ-001, PROJ-002, PROJ-003, PROJ-004, PROJ-005, PROJ-006, PROJ-007, PROJ-008, PROJ-009, PROJ-010]
---

# T-0010 — Versioned project files and workspace restoration

## Context / desired behavior

Workspace signal and chart state is not persisted as a versioned project format.

**Desired outcome:** Git-native, safely migratable, versioned engineering project files and workspace restoration. Projects must be first-class reviewable configuration artifacts, not an opaque convenience save. See proposed [ADR 0003](../adr/0003-git-native-projects.md). Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [ ] Specify project schema version, migration rules and optional connection profiles without secrets.
- [ ] Persist ECU file identity/fingerprints, signal definitions, layouts, chart setup and acquisition presets.
- [ ] Implement atomic save/read with validation and deterministic corrupt-file errors.
- [ ] Reopen prior supported schema versions with explicit migration and preview.
- [ ] Show missing/stale ECU reference warnings without silently resolving to wrong addresses.
- [ ] Define a canonical Git-friendly text representation with stable entity IDs, deterministic serialization and focused, semantically meaningful diffs.
- [ ] Prove independent edits to distinct signals/views/presets merge without rewriting unrelated entities; validate Git conflict markers and semantic reference/ID conflicts offline.
- [ ] Expose migration dry-run preview and checked-in old→current fixtures; never rewrite unsupported/newer project schemas or lose unknown fields silently.
- [ ] Distinguish tracked portable configuration from ignored binary recordings, machine-local state, credentials and unsafe persisted runtime ECU authority.
- [ ] Make multi-file saves crash-safe as a coherent workspace with verified backup/recovery behavior, not merely atomic per-file renames.

## Non-goals

- Long-running sample recording storage is T-0015.
- No cloud synchronization or remote collaboration service.

## Owned paths and interface boundaries

- crates/xcp-server/src/services/projects/, frontend/src/features/projects/ and versioned test fixtures.
- Shared DTO/schema definitions coordinated with T-0012.
- Existing unmerged PR #51 implements a bounded single-file v2 JSON core. Preserve its import/export and safe v1→v2 migration; agree on any new canonical directory format and new version with the owner before implementation. Documentation revisions must be reconciled additively with PR #51's ticket/index edits.

## Acceptance criteria

- [ ] Roundtrip restores signal list, identities, layout and connection profile.
- [ ] Corrupt/newer-version projects fail without overwriting existing data.
- [ ] Changes in ELF/A2L identity block unsafe reads until manually reconciled.
- [ ] No passwords/driver secrets are persisted in cleartext project files.
- [ ] Reopening and saving an unchanged project produces **zero Git diff**; changing one independent signal produces a focused diff.
- [ ] Two independent branches changing different entities merge, while concurrent semantic conflicts are reported without silent overrides.
- [ ] Supported schema migrations are deterministic/idempotent with preview and no source mutation before confirmation; newer/unknown schemas fail safely.
- [ ] Interrupted or failed multi-file save leaves last verified project recoverable, with a tested disk-full/partial-write case.
- [ ] Project validation runs offline in CI without connected ECU, and loading/migrating never authorizes memory reads or writes.

## Verification plan

- [ ] Version migration fixture matrix, atomic-write fault tests and UI reopen test.
- [ ] Document schema version and compatibility policy.
- [ ] Golden Git diffs for unchanged/one-entity/multi-branch edits, migration-version matrix and negative conflict fixtures.
- [ ] Multi-file crash/fault injection and cross-machine ELF/A2L identity reconciliation fixtures.
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
