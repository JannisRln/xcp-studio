---
id: T-0007
title: Safe simulated calibration write, readback and audit
status: in-progress
priority: P0
area: calibration
owner: calibration-core-agent
branch: feature/T-0007-calibration-core
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

## Independent core phase (2026-11-01)

- **Limited scope only:** data-only, simulator-specific transaction preparation/evaluation under `crates/xcp-core/src/calibration/mod.rs`, with mock-only memory mutation in unit tests. No backend write API, no session or public DTO changes; PR #42 default-deny applies without exception.
- **Still blocked for integration:** T-0003/T-0004/T-0013 have not passed full acceptance; the mandatory write denial in `crates/xcp-server/src/hardware_policy.rs` must not be circumvented. This phase does not satisfy CAL-001 or UI/E2E acceptance.
- **API note:** `Preview::prepare` binds a validated simulator runtime mapping, typed raw baseline, ECU/session/image identity, revision and caller-supplied opaque confirmation token/expiry. `Preview::confirm` consumes intent and rechecks the baseline. `Confirmed::finish` records trusted dispatch/readback evidence but does not issue I/O.
- **Safety:** No automatic retry after a sent timeout/disconnect; outcome is unknown, requires operator reconciliation. Float comparison is **bitwise exact** (including signed zero); no implicit tolerance. Raw integer range checks are exact. Optional linear physical conversions reject imprecise integers over 2^53, nonfinite values and invalid ranges.
- **Future approval gates:** reviewed contract/ADR plus API/TS fixtures (T-0012), verified address provenance and identity/revision ownership (T-0003/T-0014), one session-serialized baseline→send→readback transaction (T-0004), strong single-use token/expiry persistence, durable append-only audit plus UI preview/confirmation, explicit safety owner approval for any simulator policy relaxation, negative/CI/E2E tests. Physical hardware enablement is **out of scope** and needs independent safe-state authorization and HIL evidence.
- See [isolated core integration notes](../calibration-core-integration.md).

## Evidence and completion

- Implementation PR / commit: `feature/T-0007-calibration-core` (draft PR to be linked after creation).
- CI workflow/head SHA: pending.
- Test/fixture evidence: `crates/xcp-core/src/calibration/mod.rs` (`#[cfg(test)]` mock cases); execution to be verified by CI, not claimed as passed locally.
- Known limitations and follow-ups: no production write path; blocked session, integration and UI gates described above.
