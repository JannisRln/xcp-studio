## Ticket and requirements

- Ticket: T-0000 — docs/tickets/T-0000-name.md
- Linked GitHub issue: #0
- Requirement IDs: ...
- Base and independent workstream: ...

## Change summary

Describe user-visible behavior, implementation boundaries and actual tested status. Do not claim a feature complete if it only has a new endpoint or UI stub.

## Verification evidence

- [ ] Current PR head: Windows Rust test/format checks pass.
- [ ] Current PR head: frontend build/tests pass, if relevant.
- [ ] Documentation validator passes if docs/tickets/requirements changed.
- [ ] Negative/error cases covered.
- [ ] Integration or E2E case exercised where required.
- [ ] Hardware bench evidence attached **only** if physical device testing actually occurred.

Commands, fixture paths and CI run URL: ...

## Interface, safety and integration review

- [ ] Public REST/WS schema impact described; API contract/fixtures updated.
- [ ] Schema compatibility and TS/Rust consumers verified.
- [ ] Session/concurrency/resource bounds reviewed.
- [ ] ECU address provenance and type semantics checked.
- [ ] Calibration/hardware safety controls reviewed (if applicable).
- [ ] Shared files/lockfiles/CI edits coordinated with other agents.
- [ ] Relevant architecture/ADR/requirements docs updated.

## Known limitations and handoff

- Not implemented or deferred: ...
- Risks, migration and rollback assumptions: ...
- Updated ticket status/owner/branch, acceptance evidence and index: ...
- Follow-up ticket(s): ...

**Merge gate:** do not merge with pending/failed required CI or unresolved unsafe interface changes. See [agent workflow](../docs/agent-workflow.md).
