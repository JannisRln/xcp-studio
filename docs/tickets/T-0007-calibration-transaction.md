---
id: T-0007
title: Safe simulated calibration write, readback and audit
status: blocked
priority: P0
area: calibration
owner: unassigned
branch: none
github_issue: 10
depends_on: [T-0003, T-0004, T-0013]
requirements: [CAL-001, CAL-002, CAL-003, CAL-004, CAL-005, SEC-004]
---

# T-0007 — Safe simulated calibration write, readback and audit

## Context / desired behavior

Rust XCP master can write simulator memory, but no guarded public calibration transaction API exists.

**Desired outcome:** Safe simulated calibration write, readback and audit. Implement according to [product specification](../product-specification.md), [architecture](../architecture.md) and [API contract](../api-contract.md), where applicable.

## Scope

- [ ] Introduce server-controlled calibration preview and explicit confirmation token.
- [ ] Validate resolved runtime location, access, raw type, conversion, range and source ECU identity.
- [ ] Read baseline; serialize write with active XCP operations; verify readback and record immutable outcome.
- [ ] Implement typed calibration UI with preview/confirmation and meaningful error handling.
- [ ] Test mismatch, timeout, permission denial, stale baseline and disconnect.

## Non-goals

- Never enable physical ECU writes from this ticket.
- Do not promise rollback when the ECU is unavailable.

## Owned paths and interface boundaries

- crates/xcp-core/src/calibration/, crates/xcp-server/src/api/calibration*, frontend/src/features/calibration/.
- Shared session and public API changed only after T-0004/T-0012 contracts.

## Acceptance criteria

- [ ] Successful simulated write has matching readback and auditable transaction record.
- [ ] Mismatch/rejection/timeouts never display success; unknown outcome is explicit.
- [ ] Out-of-range edits and unverified address locations cannot be committed.
- [ ] No write happens on import/connect or without explicit confirmation.

## Verification plan

- [ ] Simulator integration tests and UI interactions; example audit events.
- [ ] Document float comparison tolerance policy and failure recovery.
- [ ] Current PR head passes required CI and negative-path tests; distinguish simulator from HIL evidence.

## Dependencies / handoff

- Dependencies: T-0003, T-0004, T-0013.
- Linked GitHub issue: [#10](https://github.com/JannisRln/xcp-studio/issues/10).
- Changes to shared interfaces require contract-first coordination and an ADR if architecture changes.
- Agent must claim ownership in this ticket and update INDEX.md before overlapping code edits.

## Evidence and completion

- Implementation PR / commit: pending.
- CI workflow/head SHA: pending.
- Test/fixture evidence: pending.
- Known limitations and follow-ups: pending.
