# Traceable Requirements

**Normative status:** Target requirements. A line in this table is **not** evidence of implementation. Consult [implementation-status.md](implementation-status.md), the ticket's acceptance evidence and green CI for delivery.  
**Priority:** P0 = simulator MVP/release blocker; P1 = post-MVP/bench milestone; P2 = later.  
**IDs:** immutable; do not recycle or silently change semantics. Deprecate with explanation and replacement ID.  
**Verification:** AT = automated test, IT = integration test, E2E = end-to-end test, HIL = hardware-in-the-loop, RV = design/code review.

## ECU metadata and ELF/DWARF

| ID | Priority | Requirement | Acceptance / verification | Ticket |
| --- | --- | --- | --- | --- |
| ECU-001 | P0 | Reject invalid ELF files and inspect named ELF symbols. | Valid/invalid ELF fixtures; bounded input; AT | T-0003 |
| ECU-002 | P0 | Detect DWARF compilation units and absent debug data. | Debug/stripped fixtures; AT | T-0003 |
| ECU-003 | P0 | Resolve primitive DWARF variable types and widths. | Signed/unsigned/float fixtures; AT | T-0003 |
| ECU-004 | P0 | Resolve typedefs, arrays, structs, members and pointers. | Nested types/member offsets; AT | T-0003 |
| ECU-005 | P0 | Keep link-time and runtime ECU addresses distinct. | Unresolved symbol cannot initiate read/write; IT | T-0003 |
| ECU-006 | P1 | Report unsupported DWARF location expressions. | Unsupported/optimized-out is explicit, no guessed address; AT | T-0003 |
| ECU-007 | P1 | Apply A2L conversion methods, scaling and units. | Raw/physical values separated; AT | T-0008 |
| ECU-008 | P0 | Validate address size, endianness and target layout. | Fixture variants; overflow and alignment tests; AT | T-0003 |
| ECU-009 | P0 | Safely resolve bounded pointer chains at runtime. | NULL, cycles, bounds, depth, stale data; IT | T-0014 |
| ECU-010 | P0 | Preserve metadata origin and ELF identity. | Source provenance and changed-file mismatch; IT | T-0003 |
| ECU-011 | P1 | Browse large symbol sets with paging/filtering. | 10k-symbol fixture/UI responsiveness; component test | T-0002 |
| ECU-012 | P0 | Manual signal import has explicit validated type/address. | Bad address/type rejected; AT | T-0002 |

## XCP session and transport

| ID | Priority | Requirement | Acceptance / verification | Ticket |
| --- | --- | --- | --- | --- |
| XCP-001 | P0 | Connect/disconnect simulated XCP slave. | Lifecycle integration tests; IT | T-0004 |
| XCP-002 | P0 | Serially execute MTA-sensitive XCP commands. | Parallel read/write test proves no interleaving; IT | T-0004 |
| XCP-003 | P0 | Read typed values and raw memory correctly. | Type/endian/address fixtures; IT | T-0004 |
| XCP-004 | P0 | Write bounded typed memory and verify response. | Multi-packet, error, bounds fixtures; IT | T-0004 |
| XCP-005 | P0 | Report timeout, protocol and transport failures. | Fault-injection tests; IT | T-0004 |
| XCP-006 | P0 | Model session state/reconnect and cancellation. | Disconnect during acquisition; IT | T-0004 |
| XCP-007 | P0 | Check operation capability and resource rights. | Unsupported/locked ECU paths; IT | T-0004 |
| XCP-008 | P1 | Discover DAQ capabilities before configuring. | Slave capability fixtures; IT | T-0005 |
| XCP-009 | P1 | Support calibrated address extensions and non-default ECU formats. | Feature-negotiation fixtures; IT | T-0004 |

## Acquisition, charts, export

| ID | Priority | Requirement | Acceptance / verification | Ticket |
| --- | --- | --- | --- | --- |
| MEAS-001 | P0 | Acquire timestamped typed ECU measurements. | Known simulator values/time order; IT | T-0005 |
| MEAS-002 | P0 | Stream acquired values to frontend. | No synthetic chart values; E2E | T-0005 |
| MEAS-003 | P0 | Export acquired samples. | Export equals captured values/timestamps; AT/E2E | T-0006 |
| MEAS-004 | P0 | Backend owns acquisition lifecycle independent of GUI. | Tab close/reopen does not invalidate capture; IT | T-0005 |
| MEAS-005 | P0 | Bounded buffers/backpressure with drop metrics. | Slow-client/load tests; IT | T-0005 |
| MEAS-006 | P0 | Distinguish monotonic scheduling vs wall-clock timestamps. | Timestamp semantics and clock-origin tests; AT | T-0005 |
| MEAS-007 | P0 | Configure multiple typed signals/rates safely. | Invalid rate, duplicates, 64+ request handling; IT | T-0005 |
| MEAS-008 | P0 | Render live chart with units, time axis and gaps. | Widget/composition tests; E2E | T-0006 |
| MEAS-009 | P0 | Separate display pause, capture pause and stop. | Lifecycle tests for each action; E2E | T-0006 |
| MEAS-010 | P1 | Persist large recordings in backend with limits. | Sustained recording/disk-full/reopen tests; IT | T-0015 |
| MEAS-011 | P1 | Prefer ECU DAQ where supported; fallback polling explicitly. | DAQ test vs polling trace; HIL/IT | T-0005 |
| MEAS-012 | P0 | Identify missing samples and sequence gaps. | Simulated loss/out-of-order; IT | T-0005 |

## Calibration

| ID | Priority | Requirement | Acceptance / verification | Ticket |
| --- | --- | --- | --- | --- |
| CAL-001 | P0 | Write and verify simulated calibration values. | Readback matches requested value; IT | T-0007 |
| CAL-002 | P0 | Validate raw/physical type, range and conversion. | Out-of-range/roundtrip tests; AT | T-0007 |
| CAL-003 | P0 | Preview and confirm changes before write. | No silent background writes; UI test | T-0007 |
| CAL-004 | P0 | Log baseline, requested, readback and outcome. | Success/error audit trace; IT | T-0007 |
| CAL-005 | P0 | Detect mismatch, timeout, access denial. | Negative tests and UI error; IT | T-0007 |
| CAL-006 | P1 | Keep hardware writing disabled by default. | Explicit operator enablement; HIL/RV | T-0013 |
| CAL-007 | P1 | Define safe restoration behavior without false rollback promises. | Failure modes documented/tested; RV/IT | T-0013 |

## A2L and CAN hardware

| ID | Priority | Requirement | Acceptance / verification | Ticket |
| --- | --- | --- | --- | --- |
| A2L-001 | P1 | Import valid A2L and reject malformed input. | Golden fixtures and parser limits; AT | T-0008 |
| A2L-002 | P1 | Parse MEASUREMENT, CHARACTERISTIC, COMPU_METHOD, RECORD_LAYOUT. | Reference fixtures; AT | T-0008 |
| A2L-003 | P1 | Map raw to physical with units/limits. | Rounding/limits/negative conversion cases; AT | T-0008 |
| A2L-004 | P1 | Detect ELF/A2L address and type conflicts. | Explicit conflict state; IT | T-0008 |
| A2L-005 | P1 | Extract relevant XCP/IF_DATA configurations. | Parser fixture; AT | T-0008 |
| CAN-001 | P1 | Configure and connect PCAN hardware. | Physical Windows PCAN bench evidence; HIL | T-0009 |
| CAN-002 | P1 | Configure and connect Vector VN1640A via XL API. | Vector bench evidence; HIL | T-0009 |
| CAN-003 | P1 | Report driver/channel/bitrate and CAN frame errors. | Mock errors and hardware log; IT/HIL | T-0009 |
| CAN-004 | P1 | Support safe CAN ID and filter configuration. | Wrong-ID/unrelated-traffic tests; IT/HIL | T-0009 |
| CAN-005 | P1 | Isolate vendor SDK dependencies in adapters. | Simulator CI needs no vendor DLL; CI | T-0009 |

## UI, project and diagnostics

| ID | Priority | Requirement | Acceptance / verification | Ticket |
| --- | --- | --- | --- | --- |
| UI-001 | P0 | Modular frontend with typed API boundary. | Feature logic absent from entrypoint; RV | T-0002 |
| UI-002 | P0 | Loading/error/empty/retry states. | Offline/invalid-upload UI tests; AT | T-0002 |
| UI-003 | P0 | Keyboard-accessible critical flows. | Keyboard/focus/a11y tests; E2E | T-0002 |
| UI-004 | P0 | Responsive dashboard and bounded chart rendering. | Desktop/narrow visual and performance tests; RV | T-0002 |
| UI-005 | P0 | Display real sample source/quality clearly. | Demo vs ECU values never conflated; E2E | T-0006 |
| UI-006 | P0 | Remember signal selection and layouts. | Save/reload project; IT | T-0010 |
| PROJ-001 | P0 | Version and validate project schema. | Old/current/newer fixtures; AT | T-0010 |
| PROJ-002 | P0 | Store connection profiles, file fingerprints, signals and layouts. | Round-trip match; IT | T-0010 |
| PROJ-003 | P0 | Atomic save with corrupt-file protection. | Crash/invalid-file simulation; IT | T-0010 |
| PROJ-004 | P0 | Provide migrations for supported schemas. | Migration fixtures; AT | T-0010 |
| PROJ-005 | P0 | Distinguish missing/stale referenced ELF/A2L. | Stale-file scenario; IT | T-0010 |
| PROJ-006 | P0 | Canonical text serialization with stable identities and minimal Git diffs. | Unchanged save is byte-identical; single signal change has focused diff; AT | T-0010 |
| PROJ-007 | P0 | Keep independently edited project entities mergeable; detect semantic conflicts. | Two-branch disjoint edit and conflicting-ID/field fixtures; AT/IT | T-0010 |
| PROJ-008 | P0 | Preview explicit, deterministic, non-destructive project migrations. | Multi-version golden fixtures; idempotence, no data loss, rejected newer format; AT/E2E | T-0010 |
| PROJ-009 | P0 | Keep tracked project configuration portable and free of secrets, machine-local state and large recordings. | Cross-machine path/fingerprint, traversal and redaction fixtures; AT/IT | T-0010 |
| PROJ-010 | P0 | Validate Git-tracked project files offline without ECU access. | CLI/CI fixture test with conflict markers, missing refs and schema errors; IT | T-0010 |
| DIAG-001 | P0 | Structured errors and correlation context. | Reproducible simulator faults; IT | T-0012 |
| DIAG-002 | P0 | Expose acquisition rate/drop/timeout counters. | Metrics integration tests; IT | T-0005 |
| DIAG-003 | P1 | Export redacted diagnostic bundle. | Sensitive data omitted; AT | T-0016 |
| DIAG-004 | P1 | Display session and transport event history. | Session fault test; E2E | T-0016 |

## API, security, quality

| ID | Priority | Requirement | Acceptance / verification | Ticket |
| --- | --- | --- | --- | --- |
| API-001 | P0 | Versioned stable REST and streaming contracts. | Schema/contract tests; IT | T-0012 |
| API-002 | P0 | Consistent error codes with validation details. | Invalid request, disconnected session; IT | T-0012 |
| API-003 | P0 | Typed TS client from validated wire schemas. | Request/response test and TS build; AT | T-0012 |
| API-004 | P0 | Separate control plane and data plane. | No per-tab independent acquisition ownership; IT | T-0012 |
| SEC-001 | P0 | Bind to loopback by default. | Startup config and network review; RV | T-0013 |
| SEC-002 | P0 | Bound uploads, WS frames, rates and memory. | Oversize/stress tests; IT | T-0013 |
| SEC-003 | P1 | Authentication, authorization and WS origin policy before remote exposure. | Explicit threat model and tests; RV | T-0013 |
| SEC-004 | P0 | Prevent unintended writes on load/connect/read-only mode. | Negative tests; IT | T-0007 |
| SEC-005 | P1 | Redact credentials/private paths from shared diagnostics. | Redaction fixtures; AT | T-0013 |
| QA-001 | P0 | CI checks Rust fmt, clippy and all tests. | Intentional failure blocks PR; CI | T-0001 |
| QA-002 | P0 | CI performs deterministic frontend install, build and tests. | Committed lockfiles and npm ci; CI | T-0001 |
| QA-003 | P0 | Windows release-gating simulator E2E. | Reproducible connect→capture→export→write; E2E | T-0011 |
| QA-004 | P0 | Hardware tests are separate from simulator CI. | Published bench checklist/results; HIL | T-0009 |
| QA-005 | P0 | No unchecked changes merged to main. | Required status checks, review policy; RV | T-0001 |
| QA-006 | P0 | Keep specs, tickets, API and tests traceable. | Documentation validator; CI | T-0001 |
| QA-007 | P1 | Collect performance/jitter evidence before claiming rates. | Benchmark matrix with setup and results; HIL | T-0011 |

## Acceptance evidence contract

Each implementing ticket records:
- Requirement IDs addressed; successful and negative test cases.
- Commands and tested environments (Windows CI vs hardware bench).
- PR and commit links; test artifact/log references if available.
- Remaining limitations and follow-up tickets.
- Reviewer verification of interface changes and relevant documentation.

See [test strategy](test-strategy.md), [ticket index](tickets/INDEX.md) and [product specification](product-specification.md).
