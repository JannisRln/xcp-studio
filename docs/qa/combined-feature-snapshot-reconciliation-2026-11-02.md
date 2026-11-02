# Reconciliation of the six-feature QA snapshot

**Date:** 2026-11-02  
**Origin:** [QA-only PR #59](https://github.com/JannisRln/xcp-studio/pull/59), original head `e6851c02e544548059932289e6baa817705efacf`, assembled from six feature branches and a pointer fix against historical main `8014d82a8ef39c85a3c441a93206b605af0d2c71`.  
**Current integrated baseline checked:** `d72b74eaab4ae72be25641c32f7332f0b7aaa733` (includes the merged React/uPlot #53 and Git-native manifest-relative requirements #69).

## What this snapshot proves

The temporary QA branch tested a combined synthetic simulator integration. It did **not** independently certify hardware, ECU writes, DAQ timing, runtime authority, native UI adoption, or release-wide T-0011 requirements. The source feature PRs were subsequently integrated individually with separate required Windows checks, including pointer root-mapping fix #56 and the expanded browser quality/E2E tests from #53.

A blob-by-blob comparison of the original PR #59's **43 changed paths** against integrated `main` found:

- **36 paths byte-for-byte identical** to current integrated main, including the A2L, pointer, mock-only calibration, diagnostics and project core modules, their fixtures and browser chart files.
- **7 paths deliberately different**, because current `main` has the newer/corrected versions:
  - `.github/workflows/ci.yml`: verified PR-touched Rustfmt gate, plus the current extended browser E2E/benchmark
  - `crates/xcp-core/src/lib.rs`: preserved additive `a2l`, `ecu`, `calibration` exports and rustfmt ordering
  - `crates/xcp-server/src/main.rs`: merged server modules and CI formatting updates
  - `docs/tickets/INDEX.md`: reconciled core ticket state and product priorities
  - `docs/tickets/T-0010-project-persistence.md`: Git-native direction, merged narrow core evidence and subsequent path rules
  - `frontend/src/features/measurements/browserDriver.mjs` and `live-view.bench.mjs`: bounded 120-second stress-test evaluation timeout, retaining normal browser command timeouts

**There are no feature source files present only in the old QA snapshot.** Reapplying the seven older blobs would regress verified fixes; no old source contents are restored by this reconciliation.

## Disposition

Per the product owner's request to integrate outstanding work, this PR is narrowed from a temporary, *DO NOT MERGE* combined-source branch to **this documentation-only reconciliation**, preserving historical attribution without changing application code, Rust workspace, CI, ECU session, DTOs or hardware access policy. Optional native desktop experiment #55 is a **separate** change, not part of this snapshot.

The acceptance state remains limited to the simulator and recorded CI evidence. Do not mark T-0011 or real ECU/HIL/calibration writes as accepted. Follow-on design and performance issues retain their own tracking (e.g. [#68](https://github.com/JannisRln/xcp-studio/issues/68)).

Full release and production hardware acceptance require independent targeted testing, not merely an all-green combined-branch run.
