# Source-controlled ticket system

XCP Studio tasks are **Markdown tickets under docs/tickets/**, each self-contained enough for one agent to implement and another to review.

**Entry point:** [INDEX.md](INDEX.md).  
**Ticket format:** [TEMPLATE.md](TEMPLATE.md).  
**Agent execution rules:** [../agent-workflow.md](../agent-workflow.md).  
**Requirement IDs:** [../requirements.md](../requirements.md).  
**Product specification:** [../product-specification.md](../product-specification.md).

## Why source-controlled tickets?

A GitHub issue is useful for conversation and notifications but can drift from code. A Markdown ticket can be reviewed in the same PR as the implementation and reliably ties tests, interface changes, ownership and docs to commits. **GitHub issues remain linked discussion trackers**; do not create duplicate issues for every ticket.

## Files and naming

- INDEX.md: ordered backlog and dependency view.
- TEMPLATE.md: canonical template; copy for new work.
- T-0001-descriptive-slug.md: one task with one stable ID.
- Numeric IDs never change. Names may be improved without changing the ID; update all links in the same PR.
- Tickets may refer to one GitHub issue shared by several implementation phases.

## Minimal machine-readable header

Each ticket starts with an exact simple front matter block (no nested YAML, aliases or multi-line scalar values):

~~~yaml
---
id: T-0001
title: CI and quality gates
status: ready
priority: P0
area: quality
owner: unassigned
branch: none
github_issue: 4
depends_on: []
requirements: [QA-001, QA-002]
---
~~~

Allowed status values: backlog, ready, in-progress, blocked, review, done. Priority: P0/P1/P2. Dependency and requirement arrays must use single-line bracket notation. github_issue is an integer or none. The docs validator checks unique IDs, file naming, fields, requirement cross-references and dependency cycles. Keep YAML simple because the validator deliberately uses only the Python standard library.

## Required body sections

1. Context and desired behavior.
2. Scope and non-goals.
3. Owned paths / interface boundaries.
4. Detailed implementation checklist.
5. Acceptance criteria with negative cases.
6. Verification and evidence to record.
7. Dependencies and handoff notes.

Acceptance criteria describe **observable outcomes**, not simply 'code exists'. A ticket is complete only after implementation, tests, green CI and review. Evidence links should be durable (PR/CI/fixture paths). Checkbox progress is indicative, not a substitute for test reports.

## Ownership and concurrency

- One agent claims one ticket in its feature PR (owner + branch + status) and notes the claim on the linked issue.
- Agents may not silently edit another agent's owned paths.
- Shared API DTOs, session state, CI, dependencies/lockfiles and common app shell require serialized changes or contract-first coordination.
- If a ticket blocks, set status=blocked and document blocker/action rather than inventing a fallback.
- A reviewer or integration agent records evidence and transitions review → done after merge; index and ticket status move in the same PR.
- Do not mark done just because an MVP stub or a partial PR exists.

## Create a new ticket

1. Confirm no existing T-ID already covers the work; choose next unused numeric ID.
2. Copy TEMPLATE.md, replace every placeholder and add an INDEX.md row.
3. Link immutable requirement IDs, related GitHub issue and dependencies.
4. Define owned files, interface change impact and negative/failure tests.
5. Run python scripts/check_docs.py and open a docs PR before multiple agents begin implementation.

## Definition of Done (ticket)

- [ ] Scope and requirements implemented, including failure modes.
- [ ] Automated tests cover acceptance; HIL evidence exists if required.
- [ ] Current PR head passes required CI (Rust, frontend, docs as applicable).
- [ ] Wire/protocol/schema changes documented and versioned.
- [ ] Safety/performance claims are supported, not inferred.
- [ ] Reviewer approved; PR merged; linked issue status reconciled.
- [ ] Ticket evidence, status and INDEX.md updated through version control.

The tracking system does not itself schedule or run agents. It provides unambiguous work packages and merge discipline for agents invoked separately.
