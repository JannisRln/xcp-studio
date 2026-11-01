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

# T-0002 — Complete modular accessible dashboard architecture

## Context / desired behavior

PR #18 was merged and introduced a modular dashboard, symbol browser, typed API and charts. PR #21 added page-level runtime-error recovery, persistent signal selection and 10k-symbol paging tests. Remaining work includes browser keyboard E2E, larger real ELF fixtures and component/dependency tradeoff reviews.

**Desired outcome:** Complete modular accessible dashboard architecture. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [x] Review/merge or reconcile PR #18 before editing overlapping frontend files.
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

- Implementation PRs: [#18](https://github.com/JannisRln/xcp-studio/pull/18) modular dashboard and [#21](https://github.com/JannisRln/xcp-studio/pull/21) error handling, keyboard focus, persistent selection and safe symbol drafts; both merged.
- CI: PR #21 [run #94](https://github.com/JannisRln/xcp-studio/actions/runs/41286456084) passed Rust/frontend/docs before merge.
- Tests: Vitest for typed address handling, 10k-symbol paging, React static render of navigation/error fallback and immutable signal selection. No browser keyboard E2E yet.
- Known limitations: imported ELF symbols remain link-time addresses until type/runtime resolution (T-0003/T-0014); full browser E2E/accessibility review and project persistence pending.
