---
id: T-0010
title: Versioned project files and workspace restoration
status: in-progress
priority: P1
area: projects
owner: chatgpt-agent
branch: feature/T-0010-versioned-project-core
github_issue: 13
depends_on: [T-0002, T-0012]
requirements: [UI-006, PROJ-001, PROJ-002, PROJ-003, PROJ-004, PROJ-005]
---

# T-0010 — Versioned project files and workspace restoration

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

## Isolated core phase (this branch)

- Branch owner: chatgpt-agent; project-file core under `frontend/src/features/projects/`.
- Added v2 JSON model and strict import/export, explicit v1-to-v2 in-memory migration, size and secret-key rejection, file-fingerprint reconciliation and Vitest cases.
- Dependency status: T-0012 is only partially implemented; do not integrate shared DTOs or AppShell until contract coordination.
- **Not implemented:** atomic durable saves, project UI workflow, browser E2E reopen, real ECU source verification and server-backed restoration.
- Requirement completion remains blocked on integration, CI and fault-injection evidence; this is not full T-0010 acceptance.

## Evidence and completion

- Implementation PR: [Draft PR #51](https://github.com/JannisRln/xcp-studio/pull/51); branch `feature/T-0010-versioned-project-core`.
- CI evidence: [Windows CI run 41328861453](https://github.com/JannisRln/xcp-studio/actions/runs/41328861453) succeeded on code head `e5e4584bdafc1f29bc6e301e626c45eb2e66453f` (frontend, docs, Rust, live-view-e2e). This documentation-only evidence update creates a new PR head and must be rechecked.
- Test/fixture evidence: `frontend/src/features/projects/projectFormat.test.ts` (roundtrip, legacy migration, corrupt/newer versions, missing/stale/duplicate ECU identity, secret/unknown fields, bounded File import/export).
- Known limitations and follow-ups: durable atomic save/write fault tests, AppShell/project picker and browser E2E reopen, real file fingerprint verification, session/read safety integration. T-0012 coordination required.
