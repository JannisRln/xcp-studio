---
id: T-0001
title: Reproducible CI, lockfiles and mandatory quality gates
status: blocked
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

Windows CI formats Rust in a temporary runner, runs cargo test and uses npm install/build/test. The docs validator was added and passed in PR #19; PR #20 implemented a frontend lockfile, Clippy with warnings denied and npm ci; missing required branch protection settings remain an administrator blocker. This ticket also implements safe cleanup for source branches with already merged PRs.

**Desired outcome:** Reproducible CI, lockfiles and mandatory quality gates. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [x] Commit reproducible dependency lockfiles and switch frontend CI to npm ci.
- [x] Make Rustfmt checks meaningful while retaining the requested temporary autoformat policy; run Clippy with warnings denied.
- [x] Add documentation ticket/link/requirements validation as a required Windows CI job.
- [x] Document branch protection and failure-gating test evidence.
- [x] Verify the frontend build and unit tests on a clean Windows runner.

## Non-goals

- Do not change XCP protocol behavior or UI architecture.
- Do not auto-commit formatted Rust files from CI.

## Owned paths and interface boundaries

- .github/workflows/ci.yml, frontend/package.json, frontend/package-lock.json, Cargo.lock (if appropriate), scripts/check_docs.py, README.md.
- Avoid simultaneous edits to dependency manifests or common workflows by other agents.

## Acceptance criteria

- [x] A clean checkout can run npm ci and frontend build/tests without resolving unpinned dependencies.
- [ ] Clippy, Rust tests, frontend build/tests and docs validation are enforced as required CI jobs.
- [ ] A deliberate failing test and malformed documentation ticket cause red CI.
- [x] No formatter-modified changes are pushed from the CI runner; documented local hook behavior remains intact.

## Verification plan

- [x] Windows CI workflow URL, job names and commit SHA.
- [ ] Negative-test proof for build/docs failure; lockfile diff and README command verification.
- [ ] Current PR head passes required CI and negative-path tests; distinguish simulator from HIL evidence.

## Dependencies / handoff

- Dependencies: none.
- Linked GitHub issue: [#4](https://github.com/JannisRln/xcp-studio/issues/4).
- Changes to shared interfaces require contract-first coordination and an ADR if architecture changes.
- Agent must claim ownership in this ticket and update INDEX.md before overlapping code edits.

## Evidence and completion

- Implementation PR: [#20](https://github.com/JannisRln/xcp-studio/pull/20) (merged); branch pruning ran successfully and removed merged feature branches.
- Green Windows CI: https://github.com/JannisRln/xcp-studio/actions/runs/41285666141 on 894d87014c974e36280759e2534520dd4215e812 (rust, frontend, docs). Final PR #20 head also passed CI before merge.
- Evidence: lockfile created on Windows CI, then clean npm ci/build/test passed; cargo fmt/check, Clippy -D warnings, and cargo test passed. Doc validator CI #79 previously failed on invalid A2L requirement matching, proving it blocks a PR. Mandatory branch protection remains an administrator setting; see docs/branch-protection.md.
- Open: required check selection in GitHub ruleset is not verified (administrator action); no deliberate failing Rust/frontend test was committed. Branch-prune workflow succeeded [run #41286072510](https://github.com/JannisRln/xcp-studio/actions/runs/41286072510); **blocker:** GitHub main ruleset has not been administratively verified for required rust/frontend/docs checks. Keep ticket blocked until this review and failure-gating check are confirmed.
