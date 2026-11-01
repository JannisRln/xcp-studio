# Delivery Roadmap and Multi-Agent Dependencies

This roadmap sequences work against the [complete product specification](product-specification.md). Tickets are the authoritative work units; the order here is not permission to bypass dependency or safety reviews.

## Milestone M0 — Documented, reproducible development

**Goal:** published contracts and CI rules that multiple agents can use without changing shared interfaces independently.

- T-0001 reproducible Rust/frontend/docs quality gates.
- T-0012 versioned REST/WS contract and representative shared fixtures.
- T-0013 loopback/WS/hardware-write safety policy.
- T-0002 reconcile PR #18, complete responsive/accessible frontend boundaries.
- T-0003 typed ELF/DWARF model and T-0004 safe XCP session actor in parallel where paths do not overlap.

**Exit:** ready-to-implement API fixtures; clean Windows build; clear independent agent ownership and no unreviewed incompatible data types.

## Milestone M1 — Reliable simulator measurement

- T-0005 backend-owned acquisition service, bounded queues, lifecycle and polling fallback.
- T-0014 runtime pointer resolution after metadata/session interfaces stabilize.
- T-0006 charts, signal table, quality/gaps and CSV using backend sample data.
- T-0015 backend recording design and implementation may be developed after shared acquisition schema freezes (P1 functionality, but required for durable release workflow).

**Exit:** one acquisition for multiple subscribers; live samples from known simulated ECU values; no tab-driven duplicated acquisition; bounded memory and traceable CSV.

## Milestone M2 — Verified simulated calibration and release acceptance

- T-0007 safe preview/write/readback verification and negative cases.
- T-0011 automated simulator end-to-end acceptance scenario and benchmark evidence.

**Exit:** EPIC #3's connect→metadata→samples→chart→export→calibrate/readback flow passes as one reproducible test suite. No rate or safety claim without evidence.

## Milestone M3 — Metadata, hardware and persistent projects

- T-0008 A2L parsing and metadata reconciliation.
- T-0009 PCAN and Vector VN1640A production adapter integration and separate HIL results.
- T-0010 versioned project save/load, migrations and referenced image validation.
- T-0016 structured diagnostics, support bundle and redaction.

**Exit:** reproducible Windows hardware read session (not necessarily hardware writes), A2L conversion fixtures, workspace reopening and robust diagnostics.

## Critical-path dependencies

~~~text
T-0012 (contract) ──────┬──► T-0005 (acquisition) ───► T-0006 (measurement UI) ─┐
T-0004 (XCP session) ───┘             │                                         ├──► T-0011 (E2E)
                                     ├──► T-0015 (recorder)                     │
T-0002 (frontend) ────────────────────► T-0006                                  │
T-0003 (metadata) ───┐                                                        │
T-0013 (safety) ─────┼──► T-0007 (calibration) ──────────────────────────────────┘
T-0004 (session) ────┘
T-0003 + T-0004 ────────► T-0014 (pointer resolution)
T-0003 ─────────────────► T-0008 (A2L)
T-0004 + T-0013 ────────► T-0009 (hardware)
T-0002 + T-0012 ────────► T-0010 (projects)
T-0004 + T-0005 ────────► T-0016 (diagnostics)
~~~

## Suggested agent staffing

- Agent A — quality and contracts: T-0001 initially; coordinate T-0012 and freeze fixtures with downstream owners.
- Agent B — ECU metadata: T-0003, then T-0014 or T-0008.
- Agent C — XCP protocol/session: T-0004, then T-0005 (not simultaneous edits to session state).
- Agent D — frontend: T-0002, then T-0006 after streaming contract agreement.
- Agent E — safety/calibration: T-0013, then T-0007.
- Agent F — integration QA: T-0011 and release evidence; can work early on fixtures, not mark milestone done.

Staffing is illustrative. **Do not run agents against the same shared files simultaneously** without an integration owner and clear file-level division. Record branch/owner claim in each ticket.

## Definition of progress

- Started: ticket claimed with owner/branch.
- Implemented: code + tests in review PR, not done.
- Accepted: merged with green required CI and negative/edge evidence.
- Release-ready: combined E2E, known limitations and safety approvals complete.

See [ticket index](tickets/INDEX.md) for current blockers and requirements.
