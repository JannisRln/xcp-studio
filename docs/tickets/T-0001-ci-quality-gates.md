---
id: T-0001
title: Reproducible CI, lockfiles and mandatory quality gates
status: ready
priority: P0
area: quality
owner: unassigned
branch: none
github_issue: 4
depends_on: []
requirements: [QA-001, QA-002, QA-005, QA-006]
---

# T-0001 — Reproducible CI, lockfiles and mandatory quality gates

## Context / desired behavior

Windows CI currently formats Rust in a temporary runner, runs cargo test, and uses npm install/build/test. There is no frontend lockfile, mandatory Clippy or docs validation yet.

**Desired outcome:** Reproducible CI, lockfiles and mandatory quality gates. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [ ] Commit reproducible dependency lockfiles and switch frontend CI to npm ci.
- [ ] Make Rustfmt checks meaningful while retaining the requested temporary autoformat policy; run Clippy with warnings denied.
- [ ] Add documentation ticket/link/requirements validation as a required Windows CI job.
- [ ] Document branch protection and failure-gating test evidence.
- [ ] Verify the frontend build and unit tests on a clean Windows runner.

## Non-goals

- Do not change XCP protocol behavior or UI architecture.
- Do not auto-commit formatted Rust files from CI.

## Owned paths and interface boundaries

- .github/workflows/ci.yml, frontend/package.json, frontend/package-lock.json, Cargo.lock (if appropriate), scripts/check_docs.py, README.md.
- Avoid simultaneous edits to dependency manifests or common workflows by other agents.

## Acceptance criteria

- [ ] A clean checkout can run npm ci and frontend build/tests without resolving unpinned dependencies.
- [ ] Clippy, Rust tests, frontend build/tests and docs validation are enforced as required CI jobs.
- [ ] A deliberate failing test and malformed documentation ticket cause red CI.
- [ ] No formatter-modified changes are pushed from the CI runner; documented local hook behavior remains intact.

## Verification plan

- [ ] Windows CI workflow URL, job names and commit SHA.
- [ ] Negative-test proof for build/docs failure; lockfile diff and README command verification.
- [ ] Current PR head passes required CI and negative-path tests; distinguish simulator from HIL evidence.

## Dependencies / handoff

- Dependencies: none.
- Linked GitHub issue: [#4](https://github.com/JannisRln/xcp-studio/issues/4).
- Changes to shared interfaces require contract-first coordination and an ADR if architecture changes.
- Agent must claim ownership in this ticket and update INDEX.md before overlapping code edits.

## Evidence and completion

- Implementation PR / commit: pending.
- CI workflow/head SHA: pending.
- Test/fixture evidence: pending.
- Known limitations and follow-ups: pending.
