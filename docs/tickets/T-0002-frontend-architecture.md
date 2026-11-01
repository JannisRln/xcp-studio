# T-0002 — Complete modular accessible dashboard architecture

---
id: T-0002
title: Complete modular accessible dashboard architecture
status: ready
priority: P0
area: frontend
owner: unassigned
branch: none
github_issue: 5
depends_on: []
requirements: [UI-001, UI-002, UI-003, UI-004, ECU-011, ECU-012]
---

## Context / desired behavior

PR #18 proposes a modular dashboard, chart, symbol browser, typed API and tests, but must be inspected for merge status before work. Its existence is not proof of feature completion.

**Desired outcome:** Complete modular accessible dashboard architecture. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [ ] Review/merge or reconcile PR #18 before editing overlapping frontend files.
- [ ] Separate app shell, feature modules, API client, domain types and shared controls with explicit ownership.
- [ ] Add error boundaries, loading/empty/error/retry and keyboard interaction tests.
- [ ] Validate ELF symbol list paging/search under large fixtures; preserve manual signal validation.
- [ ] Assess chart/grid/form dependency choices against bundle, license and accessibility needs.

## Non-goals

- No fabricated measurement samples as real ECU values.
- Do not add vendor libraries without evidence and licensing check.

## Owned paths and interface boundaries

- frontend/src/app/, frontend/src/components/, frontend/src/features/symbols/, frontend/src/core/ and frontend/src/main.tsx.
- Frontend domain DTO changes must be coordinated with T-0012; measurement charts with T-0006.

## Acceptance criteria

- [ ] main.tsx contains only bootstrapping; routes/components own their state and tested boundaries.
- [ ] Keyboard-only navigation, selected signal persistence within session, failure and empty states work.
- [ ] Symbol search/paging and type/address validation work on fixture data; no guessed runtime address.
- [ ] Frontend build plus accessibility and interaction tests pass.

## Verification plan

- [ ] Typecheck/build and component test commands; link to screenshot or functional test recording.
- [ ] Note PR #18 integration decision and any remaining chart/metadata limitations.
- [ ] Current PR head passes required CI and negative-path tests; distinguish simulator from HIL evidence.

## Dependencies / handoff

- Dependencies: none.
- Linked GitHub issue: [#5](https://github.com/JannisRln/xcp-studio/issues/5).
- Changes to shared interfaces require contract-first coordination and an ADR if architecture changes.
- Agent must claim ownership in this ticket and update INDEX.md before overlapping code edits.

## Evidence and completion

- Implementation PR / commit: pending.
- CI workflow/head SHA: pending.
- Test/fixture evidence: pending.
- Known limitations and follow-ups: pending.
