# Main integration review — 2026-11-01

**Observed main:** `ee793a86119049f4400afc18193b4bd2135a1d44` on 2026-11-01. **Purpose:** document evidence-based integration gates while independent feature chats work on isolated branches. This report does not grant hardware access or mark partial tickets DONE.

## Verified merge/CI state

- No open pull requests were returned during the reconciliation check. Merged PRs #39, #40, #42, #43, #44, #45 and #46 are represented in [implementation status](implementation-status.md).
- [Main CI run 41324320683](https://github.com/JannisRln/xcp-studio/actions/runs/41324320683): `rust`, `frontend`, `docs`, `live-view-e2e` completed successfully on the above main SHA.
- [Pages deployment 41324320625](https://github.com/JannisRln/xcp-studio/actions/runs/41324320625) succeeded. It is a synthetic browser demo and not physical XCP evidence.
- Merged partial phases T-0003/T-0004/T-0013 return to READY for **remaining** work; T-0012 is BLOCKED on missing independent acceptance. T-0006 remains in progress; do not overwrite its active follow-up claim.
- At review, work branches named `feat/T-0006-uplot-quality-e2e-bench`, `feature/T-0014-bounded-pointer-core` and `feature/T-0008-a2l-core` existed. Branch names do not prove completed work. Feature owners should verify their own branch/PR state before modifying this document.

## T-0012 additive v1 contract verification

[PR #46](https://github.com/JannisRln/xcp-studio/pull/46) is merged and its [pre-merge CI 41323689344](https://github.com/JannisRln/xcp-studio/actions/runs/41323689344) plus main CI passed; [issue #8](https://github.com/JannisRln/xcp-studio/issues/8) records the acceptance gap.

| Field | Observed meaning | Must NOT imply |
| --- | --- | --- |
| `sample.quality=valid` | Finite successful sequential simulator decoding | Synchronized capture, hardware signal accuracy, validated ECU identity |
| `sample.address_origin=manual` | User-selected raw address | Valid ELF relocation or safely resolved ECU runtime address |
| `timestamp_origin=host_utc_after_reads` | Host wall time following reads | ECU-synchronized timestamp |
| `monotonic_clock=acquisition_elapsed` | Backend acquisition elapsed monotonic milliseconds | Hardware event time or exactly simultaneous samples |
| `gap.scope=subscriber` | Loss in the WebSocket subscriber path | ECU DAQ loss, recorder loss or global capture gap |

**Already demonstrated:** additive optional fields preserve prior v1 payloads, Rust/TS fixtures validate old/new shapes, existing T-0013 WS safety limits retained. **Approval NOT demonstrated:** separate T-0005 backend owner and T-0006 frontend owner agreement; PR review state was COMMENTED, not an independent APPROVED review. No new production freeze is claimed.

**Required next actions:** request explicit owner comments on issue #8 covering field meaning, missing/invalid enum compatibility, numeric precision, v1 old-client parsing, and the impact on acquisition/Live View; record both sign-offs before promoting T-0012 beyond BLOCKED. Any incompatible change requires a new versioned contract PR, not a silent DTO edit.

## Main protection administrator action — T-0001

Read-only GitHub checks returned `main.protected=false` and `GET /repos/JannisRln/xcp-studio/rulesets = []`. The branch-protection endpoint returned HTTP 403 (`Resource not accessible by integration`). Therefore mandatory gate enforcement **is not verified**, notwithstanding green CI.

A repository administrator must open **Settings → Rules → Rulesets**, create an active **branch** ruleset for `main`, and require:
1. Pull request before merge and independent review for safety/session/public-contract changes.
2. Successful check contexts `rust`, `frontend`, `docs`, `live-view-e2e` from the current head (check exact GitHub context names).
3. Block direct pushes, force pushes and branch deletion on `main`; enforce up-to-date checks or merge queue as appropriate.
4. A controlled negative-test PR to show a failing required check blocks merge, then close without merging broken code.

Afterward read the effective branch protection/ruleset in administrator UI and record screenshot/evidence, checks and test PR in T-0001. **Do not mark T-0001 DONE until verified.**

## Integration ownership and active branch separation

The integration owner edits `docs/tickets/INDEX.md`, `docs/implementation-status.md` and cross-cutting reconciliations. Feature chats claim only their ticket/module and submit individual PRs. Avoid parallel edits to `crates/xcp-core/src/session.rs`, shared `api/v1.rs`, `contracts/v1/`, `frontend/src/components/TimeSeriesChart.tsx`, `frontend/package-lock.json`, shared CI, or `docs/tickets/INDEX.md` without explicit serialized ownership. Sync/rebase branches before merge.

Remaining gaps include pointer runtime identity/relocation, A2L conversion, durable project format, diagnostics redaction, read-only physical adapter validation, simulated calibration core with hard write deny, ECU DAQ, recorder and complete release E2E. These remain separate scoped tickets and require their own evidence.
