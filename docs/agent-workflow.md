# Multi-agent development workflow

**Goal:** independent agents make compatible, testable progress without shared-state edits, implicit interface changes or premature completion claims.

See [AGENTS.md](../AGENTS.md), [tickets](tickets/INDEX.md), [requirements](requirements.md) and [architecture](architecture.md).

## 1. Sources of truth and precedence

1. Product requirements/safety constraints: [product-specification.md](product-specification.md), [requirements.md](requirements.md).
2. Architecture ownership and protocol semantics: [architecture.md](architecture.md), [api-contract.md](api-contract.md), accepted [ADRs](adr/README.md).
3. Concrete implementation and acceptance: the ticket markdown file.
4. GitHub issue: discussion, cross-reference and assignee; not a second copy of technical specifications.
5. Existing code: actual behavior of the checked-out commit, never a substitute for intended requirements.

If documents conflict, **stop the conflicting implementation** and propose an amendment in a single decision PR; do not silently choose whichever is easiest. Security/safety constraints always remain binding.

## 2. Pick, claim and scope a ticket

- Start at [ticket index](tickets/INDEX.md). Choose a READY ticket whose dependencies are DONE or whose independently deliverable phase is explicitly identified.
- Before coding, check the latest GitHub state of linked issues, PRs and target files; the status snapshot may be stale.
- Create branch named feature/T-0000-short-topic (or fix/T-0000-..., docs/T-0000-...). One owner agent per ticket, one PR per independently reviewable change.
- In the same PR, set the ticket's status to IN_PROGRESS, owner to the stable agent identifier and branch to the actual branch; update its row in INDEX.md. Only the claiming agent changes those fields while active.
- Announce the claim in the linked GitHub issue (comment) if multiple agents are operating; do not use issue comments as a replacement for file claims.
- Follow **Owned paths** in the ticket. Before editing a shared file, ask the integration owner to serialize that change or use a separate contract PR.
- Keep PR scope aligned with one ticket; do not hide unrelated refactors or dependency upgrades in a feature PR.

## 3. Ticket lifecycle

BACKLOG → READY → IN_PROGRESS → REVIEW → DONE. BLOCKED can be entered from READY/IN_PROGRESS if a dependency, interface, hardware or external decision prevents safe progress.

- **BACKLOG:** defined but not sufficiently refined or prerequisites unknown.
- **READY:** dependency, contract, files and measurable acceptance criteria established.
- **IN_PROGRESS:** actively owned; code/fixture branch exists.
- **BLOCKED:** named blocker and owner/action are recorded; never call this done.
- **REVIEW:** PR exists with implementation + tests + updated docs; CI and review still required.
- **DONE:** merged implementation, green required CI, verified acceptance evidence and linked issue closure. An open PR is not DONE.
- Reopen DONE if a regression invalidates acceptance; document the regression and new PR.

Only update status in a PR. Merge conflicts in INDEX.md are resolved by the integration owner; no agent force-pushes or overwrites another ticket's claim.

## 4. Parallelism and integration order

**Safe in parallel when contracts are frozen:** symbol parser fixtures and visualization components; hardware mock transport and project schema; docs test harness and standalone UI unit tests.

**Must be sequenced or contract-first:**
- Shared wire DTO and TypeScript client vs Rust handler changes.
- Session actor and acquisition scheduler, both of which can touch XCP command serialization.
- Recorder sample format and export frontend.
- Calibration write API and session permissions/resource unlock.
- package.json / package-lock.json or Cargo dependency changes, shared CI files, common AppShell.
- Cross-cutting root README, requirements/architecture and ticket index changes should be batched by one integration agent.

Recommended dependency order:
1. Contract/schema and CI foundations: T-0012 + T-0001.
2. Independent metadata types (T-0003) and UI boundaries (T-0002), with read-only stable APIs.
3. Safe XCP lifecycle (T-0004) and pointer runtime resolution (T-0014) after metadata.
4. Shared backend acquisition (T-0005); measurement UI (T-0006) on frozen streaming fixtures.
5. Calibration (T-0007) and E2E evidence (T-0011); P1 adapters/A2L/project work as independent modules.

When a dependency is only partially shipped, explicitly list the usable interface/version and remaining gaps; never silently treat partial implementation as DONE.

## 5. Contract-first change protocol

For an API or architectural change:
1. Open an interface amendment PR against [API contract](api-contract.md) and/or an ADR before modifying multiple consumers.
2. Define data schemas, numerical precision, error semantics, optional fields, version compatibility and invalid examples.
3. Write shared JSON fixtures and Rust/TypeScript contract tests against them.
4. Implement producer and consumer on respective branches after agreement on the contract.
5. Ensure old behavior remains supported or document a versioned migration.
6. Integration owner checks cross-language data correctness and negative paths.

Agents must not invent wire fields, DAQ capability or device identity to make frontend demos look functional.

## 6. Branch, PR and review protocol

- Base each branch on current main; regularly rebase/merge main rather than copying another agent's unmerged branch.
- PR title format: feat(T-0000): short description; reference GitHub issue and ticket.
- PR body uses [template](../.github/PULL_REQUEST_TEMPLATE.md), including exact requirements, test artifacts, interface change flags and risks.
- CI runs on every PR. Wait for final success on the **current** head SHA; do not rely on previous green runs.
- Review includes failure behavior, payload bounds, resource ownership, memory safety, error propagation and matching docs.
- Do not merge if any required check is pending/failed. Do not claim a fix without a subsequent green run.
- Squash merged PRs, or use the repo's approved merge policy; record final SHA in the ticket evidence.

## 7. Validation commands and environments

~~~sh
# Rust: Windows is release-gating
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# Frontend (inside frontend/)
npm ci
npm run build
npm test

# Documentation (from repo root)
python scripts/check_docs.py
~~~

**Current CI caveat:** it currently runs cargo fmt --all in the ephemeral runner and cargo test, plus npm install/build/test; Clippy and npm ci are targets in T-0001. Never report them as existing CI checks before implementation. Developer machines without Rust/Node may cite CI but must not claim local verification.

Additional checks: simulator integration, invalid ELF, WebSocket disconnect, slow clients, output schema accuracy, calibration mismatch, project migration and Windows HIL evidence as applicable. See [test strategy](test-strategy.md).

## 8. Handoff contract

On PR handoff, put in the ticket:
- Current branch/PR/merged SHA; exact implementation summary and affected requirement IDs.
- Files changed and current interface versions.
- Tests run with outcomes and URLs; distinguish local, CI and hardware bench.
- Known bugs, failure modes, TODOs and changed assumptions.
- Unblocked follow-up tickets and next owner request.
- Any outstanding review/dependency decisions.

Suggested end-of-PR note:
> Ticket T-0000; implemented ...; tests ...; API change ...; status ...; known limitation ...; follow-up ....

## 9. Safety and operational safeguards

- Do not write arbitrary memory on physical hardware by default.
- Do not promote simulator-only tests as proof of PCAN/Vector functionality.
- Don't claim precise 1 kHz without measured rate/jitter/loss and ECU constraints.
- Avoid unbounded chart arrays, WebSocket sends, upload buffers or recording queues.
- Never commit credentials, SDK binaries or private ECU firmware images. Store synthetic fixtures.
- Do not expose local server remotely without security review.
- Doxygen and inline technical documentation comments are always written in English.

## 10. Operational reconciliation

The source-controlled ticket index is the planning state at the current commit, not a live GitHub synchronization service. Before acting, an agent must inspect the latest status of the linked issue and any PR. If there is a conflict, prefer completed evidence/merged code as facts and correct the ticket via PR. Avoid automation that overwrites human claims without review.
