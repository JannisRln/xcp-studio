# T-XXXX — Descriptive ticket title

> Template only. Copy to T-0000-short-slug.md; fill all fields. This file is excluded from the ticket validator.

~~~yaml
---
id: T-0000
title: Short, independently reviewable deliverable
status: backlog
priority: P0
area: feature-area
owner: unassigned
branch: none
github_issue: none
depends_on: []
requirements: [QA-001]
---
~~~

## Context / desired behavior

What user workflow is blocked? State baseline behavior versus target and the exact requirement IDs.

## Scope

- [ ] Feature slice 1 (producer)
- [ ] Feature slice 2 (consumer)
- [ ] Negative/error handling
- [ ] Documentation / migration work

## Non-goals

Name deliberately excluded work; provide follow-up ticket IDs where relevant.

## Owned paths and interface boundaries

Allowed files/modules: ...
Shared contracts touched: ...
Other agent coordination required: ...

## Acceptance criteria

- [ ] Scenario GIVEN ... WHEN ... THEN ...
- [ ] Failure/timeout/bounds scenario GIVEN ... WHEN ... THEN ...
- [ ] Test and CI evidence proving acceptance

## Verification plan

Commands, fixtures, integration scenarios and bench/HIL prerequisites. Distinguish currently runnable tests from future tests.

## Dependencies / handoff

Depends on: ...
Expected API/schema version: ...
Blocking decisions: ...

## Evidence and completion

PR: pending  
CI run/head SHA: pending  
Automated tests: pending  
Bench tests (if applicable): not applicable  
Known limitations / follow-ups: pending
