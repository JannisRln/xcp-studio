# Implementation Status — Evidence-Based Snapshot

**Snapshot date:** 2026-11-01. **Baseline:** default branch main as inspected when the documentation branch was created. This file is deliberately a time-stamped snapshot, not a claim that all future PR states are known. Check GitHub before implementing or merging.

Legend: DELIVERED = code exists for stated narrow behavior; PARTIAL = only part of requirement; NOT YET = no verified delivery; IN PR = proposed change awaiting merge.

## Verified narrow capabilities

| Domain | Baseline status | Evidence / actual behavior | Not yet delivered |
| --- | --- | --- | --- |
| Rust CAN abstraction | DELIVERED (subset) | xcp-core CanTransport and simulated transport | Full async/hardware session orchestration |
| XCP simulator master/slave | DELIVERED (subset) | CONNECT, DISCONNECT, SET_MTA, UPLOAD, DOWNLOAD and simulator memory | DAQ, robust session actor, complete capabilities/negotiation |
| HTTP session/read | DELIVERED (subset) | /api/xcp/connect, /disconnect, /status, /read | Session IDs, actor lifecycle, hardware selection and safe typed write transaction |
| Typed snapshot endpoint | DELIVERED (subset) | /api/xcp/snapshot reads up to 64 typed simulated signals | Precise per-sample timestamps, quality and shared acquisition |
| WebSocket streaming | DELIVERED (subset) | /api/xcp/stream per-client timed polling, 20–10000 ms | Backend-owned capture, DAQ, bounded subscriber fanout, drop counters |
| ELF symbols | DELIVERED (subset) | ELF symtab/dynsym inspection and upload API | Complete DWARF type/location resolution |
| DWARF summary | DELIVERED (subset) | Detects debug info and counts compilation units | Canonical variable tree/pointer resolution |
| PCAN-Basic | PARTIAL | Windows adapter in xcp-core, driver dependency documented | Configurable production API session and bench evidence |
| Vector VN1640A | NOT YET | Ticket/requirements only | Transport implementation and HIL tests |
| A2L | NOT YET | Ticket/requirements only | Parser, mapping, conversions |
| Dashboard | PARTIAL + IN PR | PR #17 provided live simulator values/CSV; PR #18 proposes major modular chart/symbol UI | Full accessible visualization, backend-owned recording, release E2E |
| Measurement CSV | PARTIAL | Browser buffer CSV export | Durable full-session recording, sequence/gap metadata |
| Calibration | NOT YET (API/UI) | xcp-core master can write simulated slave | Guarded preview/write/readback/verify transaction and audit |
| Project persistence | NOT YET | Ticket/requirements only | Versioned save/load and migrations |
| Diagnostics | PARTIAL | Health endpoint and browser activity log | Structured transport metrics, redacted export |
| CI | PARTIAL | Windows cargo fmt in temporary runner, cargo test; frontend npm install/build/test | Mandatory Clippy, npm ci, committed lockfiles, E2E and docs validation |

## Existing GitHub integration points

- [#3 EPIC](https://github.com/JannisRln/xcp-studio/issues/3) tracks v0.1 end-to-end goal.
- PR #1 CI and PR #2 DWARF foundation were merged; later frontend and WS foundations also merged.
- [PR #18](https://github.com/JannisRln/xcp-studio/pull/18) proposed the modular dashboard. At this snapshot it was **open**; frontend/Rust checks recovered to green after a TypeScript syntax fix. Verify actual merge state before editing overlapping files.
- All original GitHub issues #4–#13 remain useful tracking references. Source-controlled execution tickets [T-0001–T-0016](tickets/INDEX.md) decompose their remaining work.

## Important boundaries

- **Simulator measurements are not synthetic frontend data** when read over XCP from simulator memory. However, the simulator uses fixed known values unless a test explicitly updates them; a flat line is expected.
- **The current WebSocket is not ECU DAQ.** Multiple clients each trigger their own polling loop.
- **The current timestamp is host epoch milliseconds following the reads.** It is not an ECU event clock or strict monotonic measurement timestamp.
- **ELF link-time symbols are not automatically safe runtime ECU addresses.**
- **PCAN Rust adapter existence is not proof that the GUI can connect physical hardware.**
- **No calibration write UI/API has passed its required safety/verification workflow.**
- **Passing one PR's CI does not finish the whole product or imply a hardware validation.**

## Update rules

Update this file only when a merged implementation and evidence change a capability. Link PR, final SHA, CI and the exact acceptance scenario. Do not move a category to DELIVERED on the basis of an unmerged PR. Tickets contain the operational checklist and current owner; this page summarizes verified capability only.

## Confirmed implementation updates — 2026-11-01

The original table above is a historical baseline. The following merged PRs are newer verified evidence; **they do not imply full feature completion**.

| Ticket / area | Merged evidence | Narrow capability now available | Remaining work |
| --- | --- | --- | --- |
| T-0001 CI | [PR #20](https://github.com/JannisRln/xcp-studio/pull/20) | Frontend npm ci + lockfile; Rust Clippy -D warnings; safe auto-pruning of already-merged source branches | Administrator must verify required main branch-protection checks |
| T-0004 XCP session | [PR #23](https://github.com/JannisRln/xcp-studio/pull/23), [PR #24](https://github.com/JannisRln/xcp-studio/pull/24) | Serialized XCP session actor used by legacy and versioned HTTP/WS handlers; concurrent MTA-safe request tests | Deadline/cancellation, capability negotiation and hardware session profiles |
| T-0012 versioned APIs | [PR #22](https://github.com/JannisRln/xcp-studio/pull/22), [PR #25](https://github.com/JannisRln/xcp-studio/pull/25) | Versioned health/session/read and acquisition lifecycle/WS subscription, shared Rust/TypeScript JSON fixtures | Complete versioned metadata/quality/calibration API and compatibility policies |
| T-0005 acquisition | [PR #25](https://github.com/JannisRln/xcp-studio/pull/25) | **One backend-owned XCP polling scheduler**, independent of browser subscriber count; up to 16 WS subscribers, bounded 128-frame fanout, sequence and lag/gap reporting | ECU-side DAQ, durable recording, replay and full signal-quality/timebase semantics |
| T-0006 measurement UI | [PR #27](https://github.com/JannisRln/xcp-studio/pull/27), [PR #28](https://github.com/JannisRln/xcp-studio/pull/28) | GUI consumes shared acquisition, reconnects after route reload, separates chart pause from backend stop, reports dropped events, exports bounded preview CSV; chart has zoom/pan, unit axes and cursor | Complete browser E2E, raw/physical conversion quality, persistent backend recording, historical replay |
| T-0013 local security | [PR #29](https://github.com/JannisRln/xcp-studio/pull/29) | Local Host/Origin/Fetch Metadata policy, DNS-rebinding and cross-site browser request mitigation, 16 KiB WS message limits | Authentication for any future remote access, request-rate limits, hardware write gating, diagnostics redaction |

**Validated CI runs:** shared acquisition [#113](https://github.com/JannisRln/xcp-studio/actions/runs/41291388091), frontend integration [#115](https://github.com/JannisRln/xcp-studio/actions/runs/41291904365), chart [#117](https://github.com/JannisRln/xcp-studio/actions/runs/41292351637), origin safety [#119](https://github.com/JannisRln/xcp-studio/actions/runs/41292669328); all Rust/frontend/docs jobs succeeded before the corresponding squash merge.

**Important distinction:** The original `/api/xcp/stream` remains for compatibility and still creates an independent polling loop for each client. The updated GUI uses `/api/v1/acquisitions/{id}/stream`, which subscribes to a shared backend acquisition instead. The backend-owned service is **not** ECU DAQ. Closing the GUI does not stop acquisition; browser CSV is limited to the retained 2,000-frame preview.

The source-controlled ticket index now returns unclaimed remaining scope to READY or BLOCKED after completion of the merged phases. A deleted branch does not remain an active ticket owner. Consult [ticket index](tickets/INDEX.md) and [agent workflow](agent-workflow.md) before launching parallel agents.
