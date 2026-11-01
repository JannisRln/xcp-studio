# XCP Studio — Execution Ticket Index

**Canonical backlog:** one Markdown file per ticket. This page is a navigational index; its status rows are kept in sync by the implementing PR. GitHub Issues are linked discussion trackers. See [ticket rules](README.md), [agent workflow](../agent-workflow.md) and [requirements](../requirements.md).

> Baseline on 2026-11-01. This is not a live GitHub project board. Every agent must verify the latest main/PR/issue state before claiming a ticket. No ticket is DONE merely because part of its feature exists.

## P0 / simulator MVP

| ID | Ticket | Priority | Status | Depends on | GitHub issue |
| --- | --- | --- | --- | --- | --- |
| T-0001 | [CI and quality gates](T-0001-ci-quality-gates.md) | P0 | blocked | — | [#4](https://github.com/JannisRln/xcp-studio/issues/4) |
| T-0002 | [Modular frontend architecture](T-0002-frontend-architecture.md) | P0 | ready | — | [#5](https://github.com/JannisRln/xcp-studio/issues/5) |
| T-0003 | [Typed ELF/DWARF](T-0003-typed-elf-dwarf.md) | P0 | review | — | [#6](https://github.com/JannisRln/xcp-studio/issues/6) |
| T-0004 | [XCP session actor](T-0004-xcp-session-actor.md) | P0 | review | — | [#7](https://github.com/JannisRln/xcp-studio/issues/7) |
| T-0005 | [Shared acquisition + DAQ](T-0005-shared-acquisition.md) | P0 | blocked | T-0004, T-0012 | [#8](https://github.com/JannisRln/xcp-studio/issues/8) |
| T-0006 | [Measurement charts and export](T-0006-measurement-workspace.md) | P0 | in-progress | T-0002, T-0005 | [#9](https://github.com/JannisRln/xcp-studio/issues/9) |
| T-0007 | [Simulated calibration transaction](T-0007-calibration-transaction.md) | P0 | blocked | T-0003, T-0004, T-0013 | [#10](https://github.com/JannisRln/xcp-studio/issues/10) |
| T-0011 | [Simulator E2E release acceptance](T-0011-simulator-e2e-release.md) | P0 | blocked | T-0005, T-0006, T-0007 | [#3](https://github.com/JannisRln/xcp-studio/issues/3) |
| T-0012 | [Versioned API contracts](T-0012-versioned-api-contracts.md) | P0 | review | — | [#8](https://github.com/JannisRln/xcp-studio/issues/8) |
| T-0013 | [Security and hardware-write safety](T-0013-security-safety-policy.md) | P0 | review | — | [#10](https://github.com/JannisRln/xcp-studio/issues/10) |
| T-0014 | [Runtime pointer resolution](T-0014-runtime-pointer-resolution.md) | P0 | blocked | T-0003, T-0004 | [#6](https://github.com/JannisRln/xcp-studio/issues/6) |

## P1 / integration and persistence

| ID | Ticket | Priority | Status | Depends on | GitHub issue |
| --- | --- | --- | --- | --- | --- |
| T-0008 | [A2L metadata and conversions](T-0008-a2l-import-mapping.md) | P1 | blocked | T-0003 | [#11](https://github.com/JannisRln/xcp-studio/issues/11) |
| T-0009 | [PCAN + Vector Windows transport](T-0009-can-hardware-adapters.md) | P1 | blocked | T-0004, T-0013 | [#12](https://github.com/JannisRln/xcp-studio/issues/12) |
| T-0010 | [Project persistence](T-0010-project-persistence.md) | P1 | in-progress | T-0002, T-0012 | [#13](https://github.com/JannisRln/xcp-studio/issues/13) |
| T-0015 | [Durable backend recording](T-0015-backend-recording-store.md) | P1 | blocked | T-0005, T-0012 | [#9](https://github.com/JannisRln/xcp-studio/issues/9) |
| T-0016 | [Structured diagnostics](T-0016-diagnostics-observability.md) | P1 | blocked | T-0004, T-0005 | [#13](https://github.com/JannisRln/xcp-studio/issues/13) |

## Suggested parallel work allocation

| Wave | Agent / workstream | Ticket | Integration coordination |
| --- | --- | --- | --- |
| 1 | Quality and release automation | T-0001 | Owns CI/lockfiles; avoid overlap with dependency changes |
| 1 | Public contract and schema | T-0012 | Publishes producer/consumer JSON fixtures first |
| 1 | ECU metadata | T-0003 | Independent metadata parser/type fixtures |
| 1 | XCP session | T-0004 | Serialized transport/session API; coordinate DTO with T-0012 |
| 1 | Frontend | T-0002 | PR #18 has been merged; verify new UI baseline and avoid overlapping app-shell changes |
| 1 | Security and safeguards | T-0013 | Policy review blocks unsafe remote exposure/hardware writes |
| 2 | Acquisition and pointer resolver | T-0005, T-0014 | Shared session reads, separate metadata/runtime boundaries |
| 2 | A2L, hardware, project format | T-0008, T-0009, T-0010 | Independent feature modules after contracts |
| 3 | Measurement visualization and backend recorder | T-0006, T-0015 | Consume frozen acquisition schema |
| 3 | Calibration and diagnostics | T-0007, T-0016 | Coordinate audit/event schema and shared session |
| 4 | End-to-end release acceptance | T-0011 | Integrate only green, merged feature PRs |

**Merge discipline:** one branch/owner per ticket; cross-module schema change via T-0012; dependencies must be confirmed DONE unless a narrowly scoped independent phase is documented in the ticket. A BLOCKED item is not automatically assignable. Green CI is necessary but not sufficient for acceptance.

## Completion rules

- Claim: edit ticket owner, branch and status to in-progress; update this index and linked GitHub issue.
- Handoff: add PR, tests, contracts, evidence and caveats; set status to review.
- Complete: only after PR merges with green required checks and acceptance tests; set ticket and index to done, reconcile GitHub issue.
- Regression: return to ready/blocked with a new failure ticket and evidence.

For requirements and milestones, see [product specification](../product-specification.md) and [roadmap](../roadmap.md).
