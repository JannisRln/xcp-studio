# XCP Studio — Product and System Specification

**Specification version:** 1.0 (target behavior, not a claim of completion)  
**Target:** Windows-first engineering workstation application  
**Primary implementation:** Rust backend, React/TypeScript frontend  
**Source of truth:** this specification for product behavior; [requirements](requirements.md) for testable IDs; [API contract](api-contract.md) for wire formats; [architecture](architecture.md) for boundaries; [tickets](tickets/README.md) for execution.  
**Change policy:** product/API changes require a ticket, impact assessment, tests, and corresponding documentation changes.

> **Implementation status is not the specification.** Sections marked Target describe desired behavior even when the current prototype lacks that capability. See [implementation baseline](implementation-status.md) for what currently exists; never infer that a described feature is already delivered.

## 1. Vision, audience, and scope

XCP Studio is a desktop-oriented tool for inspecting ECU metadata, establishing XCP connections, acquiring time-aligned measurements, primarily viewing live data, optionally recording/exporting data, and safely calibrating parameters. The initial delivery must work without physical ECU hardware using a deterministic XCP simulator. Hardware support is an additional, independently validated milestone.

Primary users:
- **Calibration engineer:** discover ECU variables, read/edit calibrated parameters, validate writes and keep an audit trail.
- **Measurement engineer:** select signals, start acquisition, view chart/table trends, capture and export synchronized recordings.
- **ECU developer:** inspect ELF/DWARF symbols and types, resolve pointer-based structures, diagnose address and transport faults.
- **Integrator/test engineer:** run repeatable simulator fixtures, validate XCP behavior, reproduce errors and attach diagnostics.

Primary workflows:
1. Open/create a workspace and select simulator or a configured adapter.
2. Connect XCP session; verify slave identity/capabilities; inspect session state and failures.
3. Import an ELF; optionally import matching A2L; map typed ECU variables with address provenance.
4. Select or manually define signals; validate type, address, access rights and sample schedule.
5. **Primary workflow: Live View.** Connect, select signals and start acquisition; immediately inspect fresh numeric values, update rate, timestamps and live plots. Explicit stop ends acquisition; export and recording are secondary, optional actions.
6. Select a calibratable parameter, read it, preview a constrained change, confirm, write and verify by readback.
7. Save a deterministic, Git-reviewable project, reopen it on another machine or application version, explicitly preview migrations, and review metadata and diagnostic events.

## 2. Release tracks and explicit non-goals

| Track | Required outcome | Exclusions |
| --- | --- | --- |
| MVP v0.1 (P0) | End-to-end **simulator Live View** and a Git-native project Save/Open/Reopen workflow with deterministic diffs, versioned non-destructive migration and offline validation; guarded write/readback remains a separate P0 safety milestone | Mandatory full-session recording, production ECU safety certification, broad A2L and guaranteed 1 kHz |
| v0.2 (P1) | Optional durable backend recording/export, A2L conversions, richer project interoperability, enhanced diagnostics and PCAN/Vector connectivity with bench evidence | Unverified hardware writes |
| Later (P2) | DAQ optimization and broad target coverage, XCP on Ethernet, richer calibration maps and high-volume recordings | Do not imply delivery before acceptance tests |

Windows is the release-gating OS; Linux/macOS and Docker are not v0.1 requirements. Browser UI served locally is an implementation detail, not permission to expose ECU control on a public interface. Multi-user remote control is out of scope.

## 3. Functional domains

### 3.1 Workspace and application shell

**Target**
- Responsive navigation: Overview, Measurements, ECU/Symbol Browser, Calibration, Connections, Diagnostics, project/settings.
- Global status: API reachable, transport, XCP connected/disconnected/error, acquisition running/stopped, unsaved project edits.
- Clear loading, empty, error and retry states; errors are specific and never silently converted to zero values.
- Keyboard navigation, visible focus, semantic form labels and readable status that does not rely on color alone.
- Safe route/page switching during acquisition: acquisition ownership belongs to backend, not chart component lifetime.
- Browser refresh/reconnect does not corrupt recording or leave a hardware session in an unknown state.
- No UI-only fabricated values in production measurement views. A demo mode must be visibly labeled and isolated.

**Acceptance:** keyboard-only connect, signal selection, chart start/stop and export; graceful API-down state; no synthetic sample appears as ECU data.

### 3.2 Connection and transport

**Target**
- Connection profiles: simulator, PCAN-Basic, Vector XL/VN1640A; eventual extensible transport factory.
- Configurable adapter/channel/bitrate and XCP request/response CAN IDs, with validation before connect.
- Session state machine: disconnected → connecting → connected → recovering/error → disconnecting.
- Serialize CTO requests and any MTA-dependent command sequences per XCP session; never interleave concurrent SET_MTA/UPLOAD/DOWNLOAD.
- Timeouts, negative response codes, mismatched CAN frames, transport failures, explicit disconnect and interrupted sessions produce actionable errors.
- Reconnect is operator-controlled by default; automatic retries/backoff only after an explicit policy and safe state transition.
- Hardware control enabled only after verified selected adapter; no silent simulator fallback when a hardware profile fails.

**Acceptance:** simulator and transport mock tests for connect, read, disconnect, timeout, error response, concurrent reads and recovery; hardware verification separately recorded.

### 3.3 ECU metadata and variable model

**Target**
- ELF reader detects file class, endianness, machine/architecture, sections, symbols, addresses, sizes; invalid/untrusted input is rejected with bounds.
- DWARF resolver handles compilation units, base types, enums, typedefs, qualifiers, arrays, structs/unions, member offsets and pointers.
- Variable model includes: stable ID, display path, origin (ELF/DWARF/A2L/manual), raw type, byte width, signedness, encoding, endianness, link-time location, runtime location state, address extension, permissions, unit and conversion method if known.
- Explicit location states: resolved, requires relocation, runtime expression, optimized out, unsupported, ambiguous, invalid. Only resolved addresses can be read/written.
- Pointer chains: dereference with configured target pointer width and endianness; maximum depth and cycle detection; NULL, overflow, inaccessible memory and stale pointer detection. Resolution is an explicit operation with error/quality metadata.
- A2L (later) supports MEASUREMENT, CHARACTERISTIC, COMPU_METHOD, RECORD_LAYOUT and XCP-relevant IF_DATA; mapping to ELF/DWARF preserves both source records and flags inconsistencies.
- Never infer actual runtime addresses solely from ELF link-time symbol values without the required mapping/relocation validation.

**Acceptance:** fixtures with matching and stripped ELF, nested members/arrays/pointers and invalid expressions; real address read blocked until resolution.

### 3.4 Symbol Browser / ECU Explorer

**Target**
- Import ELF with progress, size limits, explicit failure details and retained file identity (name/hash/build ID when present).
- Search/filter/sort by name/path, address, type, size and source; virtualized or paginated lists for large metadata sets.
- Inspect type details, structure tree, location provenance, bytes and memory access eligibility.
- Add/remove symbols into a measurement set; permit manual signals with explicit type/endianness and address validation.
- Persist selected signals in the project; repeated imports resolve duplicates deliberately and invalidate stale mappings when image identity changes.
- For unsupported DWARF entries, show why they cannot be read rather than synthesizing a type/address.

**Acceptance:** parse fixtures, search/filter, inspect nested variables, add to acquisition with correct type; invalid location is non-actionable.

### 3.5 Acquisition and live visualization (primary UI priority)

**Target**
- Acquisition configuration specifies signal IDs, address and type resolution, sampling policy (DAQ preferred when supported; rate-limited UPLOAD polling fallback), expected cadence and data policy.
- Backend owns a single acquisition lifecycle per session with many subscribers; browser/tab count must not multiply ECU polling load.
- End-to-end message contains acquisition ID, monotonically increasing sequence, ECU/host timestamp semantics, per-signal raw value, physical value when conversion exists, unit, quality flags and gap/drop metadata.
- Use monotonic time for scheduling/latency measurement; wall clock for display/export with clock-origin metadata. Do not claim millisecond wall time as a monotonic acquisition clock.
- Bounded queues/ringbuffers and defined slow-consumer behavior. Queue overflow emits a drop counter and discontinuity flag; never grow without limit.
- Stream data via WebSocket with versioned message envelopes. REST controls start/stop/configuration and queries session/recording status.
- Chart: time axis, multiple channels, visibility/legend, zoom/pan, cursor inspection, configurable per-unit axes/scale, time range and quality/gap indication. A shared axis may be used in prototype but must be labeled.
- Pause *display* must not silently pause backend acquisition/recording. Explicitly distinguish pause visualization, pause acquisition and stop recording.
- CSV export uses actual captured samples/timestamps and headers/escaping; long recordings stream to disk on backend and download without relying on unbounded browser RAM.

**Acceptance:** known simulator signals produce time-ordered values; stream disconnected/reconnected with quality metadata; CSV reproduces captured values; multi-client test shows one backend acquisition schedule.

### 3.6 Calibration

**Target**
- Calibratable variables must have resolved writable address, type, endianness, rights and conversion boundaries.
- Display existing raw and physical values, units, valid range, resolution and conversion formula when available.
- Typed edit with preview of exact raw bytes, range validation and confirmation; high-risk hardware writes require explicit enablement.
- Backend write transaction: serialize with other XCP operations, read baseline, validate, write, readback, compare (bit-exact for integer; defined tolerance/bitwise policy for float), emit immutable event.
- Failure is visible: blocked permission, inconsistent readback, timeout, disconnect, out-of-range, unsupported memory page. Never label a write successful without successful verification.
- Provide rollback/restore *only where technically validated*; no automatic rollback promise on loss of ECU access.
- Safe defaults: no writes on connect or project load; default hardware mode read-only. An audit entry records timestamp, target, before/requested/readback, outcome and any operator confirmation.

**Acceptance:** simulated success and mismatch/rejected/timeout tests; hardware write remains locked until separate policy and bench evidence.

### 3.7 Recording, export and project persistence

**Target**
- Measurement storage has acquisition metadata (ECU identity, source file hashes, signal metadata, start/stop, timebase, gaps/quality), chunked samples and bounded disk usage.
- Operator sets recording path, retention and maximum size; errors such as disk full are reported and recorded, not hidden.
- Exports: CSV initially, scalable binary/columnar format may be added behind a documented schema. CSV includes timestamp, signal identity, unit, value semantics and missing-sample representation.
- Project document has schema version, connection profile (excluding secrets), ELF/A2L references and fingerprints, signals, layouts, chart configuration and acquisition presets.
- Atomic save (temp file then rename), migration path and unsupported-newer-version error; no silent destructive rewrite.
- **Git-native project format is core functionality:** human-readable, deterministic, UTF-8 text with stable entity IDs, minimal diff churn, meaningful field-level review and independently mergeable signals/views/presets. Git remains optional; the canonical storage must work on an ordinary local filesystem.
- Persist meaningful user-controlled ordering explicitly rather than relying on incidental JSON array order; avoid volatile timestamps, random IDs per save, machine-specific absolute paths and hidden local secrets in tracked configuration. Keep large recordings and binary ECU artifacts outside the tracked project by default; verify external ELF/A2L fingerprints on load.
- Version every incompatible project layout change; offer a read-only migration preview showing semantic and file changes before any write, support deterministic/idempotent migration fixtures and reject unknown/newer or conflicting content without silent data loss.
- A multi-file workspace save must be crash-safe **as a set**; per-file atomic rename alone is insufficient. Preserve the last verified project or a recoverable generation after interruption, disk-full or permission failure.
- Provide offline project schema/reference/conflict validation suitable for CI and Git workflows. Loading a saved configuration never authorizes ECU access, converts ELF link-time addresses to runtime addresses, or enables hardware writes. See [ADR 0003](adr/0003-git-native-projects.md) (proposed design, not an implemented schema).
- Import of untrusted project/ELF/A2L data has size/format limits and no arbitrary file execution.

**Acceptance:** save/reopen identical workspace; unchanged save creates no Git diff; editing independent signals produces reviewable non-overlapping changes; v1/v2→future migration previews are deterministic and non-destructive; invalid/conflicted/newer/corrupt files and checksum/metadata mismatch are safely rejected without ECU I/O or data loss.

### 3.8 Diagnostics and observability

**Target**
- Diagnostic events include timestamp, severity, subsystem, correlation/session/acquisition ID, message and structured context.
- Metrics: transport RX/TX and timeout counts, XCP error codes, queue utilization, dropped frames, subscribers, current rates, recording throughput and last successful sample.
- Redact credentials and user-specific paths in shared diagnostics; avoid dumping arbitrary ECU memory without explicit operator action.
- Export diagnostics bundle with logs and version/build info, without hidden background telemetry.
- Frontend distinguishes backend offline, XCP disconnected, stream fault, data-quality faults and server errors.

**Acceptance:** deterministic fault-injection and log tests; user can inspect why acquisition stopped.

## 4. Protocol and data correctness

- XCP CTO/DTO semantics and CAN frame limits follow the negotiated ECU and transport capabilities; do not assume every ECU accepts simulator defaults.
- The existing simulator uses 8-byte classic CAN, byte addressing, 32-bit target addresses and little-endian values; these are **simulator properties**, not global protocol guarantees.
- Interpret data according to ECU type and byte order. Avoid JS floating-point conversion for exact 64-bit integer raw values; use explicit encoding when introduced.
- Represent unresolved/invalid values as errors/quality states, never as fabricated zeros.
- Read and write access must check address range, overflow, length, session status, permissions, and resource unlock state.
- The XCP slave's DAQ/event capabilities must be discovered and validated before using DAQ.
- Test loss, duplication and out-of-order delivery; correlate responses and measurement sequences where supported.

## 5. UX and accessibility

- Dark engineering UI with compact dense tables, discoverable actions and preserved context.
- Every chart needs a label, readable axis, legend, sample count, timestamp reference and no-data indicator.
- Type, unit and source provenance accompany values; distinguish raw from physical values visually and in exports.
- Visual success/failure must also be expressed in text and accessible semantics.
- Critical actions (write, reconnect with changed profile, discard recording) require clear confirmation, with no accidental destructive shortcuts.
- Support typical desktop widths and narrow responsive use; primary release is Windows desktop.

## 6. Quality attributes, targets and operational constraints

| Attribute | Target / policy | Verification |
| --- | --- | --- |
| Functional correctness | No fabricated measurement/calibration data | Simulator E2E tests |
| Supported OS | Windows CI and release gating | Windows build/test + optional bench |
| Acquisition rate | Up to 1 kHz **where measured feasible**; not promised on CAN/ECU combinations | Benchmarked matrix with transport, count, jitter, loss |
| Resource limits | All input sizes, queues, buffers, subscribers and recordings bounded by policy | Load/fault tests |
| UI responsiveness | Chart rendering decoupled from transport and capture; avoid event-loop blocking | Render profiling and load tests |
| Reliability | Clean lifecycle and recovery with no silent data loss | Disconnect, timeout and overflow tests |
| Compatibility | Versioned project and stream schemas, intentional migrations | Compatibility fixtures |
| Security | Loopback default, no exposed write API without authorization policy | Bind/address review and write gating |
| Portability | No Docker/Linux v0.1 gate | Documented later milestone |
| Developer reproducibility | Pinned dependencies and repeatable CI; formatting policy understood | Automated PR checks |

## 7. Security and safety boundaries

- Backend starts on loopback by default. Remote access requires a separately designed authentication, authorization, origin and CSRF/WebSocket-origin policy; do **not** enable by changing the bind address alone.
- Restrict uploaded binary size, validate parsing, avoid panics on malformed inputs and cap expensive metadata traversals.
- WebSocket handshake must validate configuration and message size; enforce connections/rate/queue caps and closed-connection cleanup.
- Distinguish simulator capability from physical ECU safety: do not enable hardware writes based on simulator-only verification.
- No claims of functional safety, ISO 26262 compliance or production suitability without independent validation.
- Hardware operations require safe defaults, device identity verification and explicit user intent.

## 8. Release acceptance and evidence

**v0.1 release cannot be declared done unless all of these are true:**

1. Reproducible Windows CI passes Rust formatting, lint, tests and frontend lint/typecheck/tests/build; relevant integration checks are required.
2. Simulator connects and exposes known typed values; variable provenance is validated.
3. Recording starts/stops through backend; actual XCP samples appear in time-series chart and table.
4. Captured samples are exported with correct values, timestamps and quality fields, including missing values/gaps.
5. A simulated calibration parameter is written with explicit confirmation and successful readback; negative cases fail visibly.
6. Import failures, disconnected ECU, stream loss and invalid addresses have deterministic error states.
7. No critical functionality depends on synthetic frontend generators or undocumented assumptions.
8. Tests, commands, fixture inputs, evidence and known limitations are linked from the implementing tickets.
9. A Git-tracked project can be saved unchanged without file churn, independently edited and validated, reopened safely, and migrated from supported versions with preview, reproducible fixtures and interruption recovery evidence.

**v0.2 additionally requires:** validated A2L conversions, advanced project interoperability, hardware connection bench run, transport capability errors and operator documentation.

## 9. Traceability and change process

- Each behavior must map to requirement IDs in [requirements](requirements.md) and to one or more [tickets](tickets/INDEX.md).
- Each ticket defines dependencies, module ownership, acceptance tests and interface impact.
- Each PR links its ticket and affected requirement IDs; architecture/API changes update [architecture](architecture.md) and [API contract](api-contract.md).
- New/changed behavior is not complete without tests and documented edge cases.
- Architecture tradeoffs are tracked in [ADRs](adr/README.md) rather than decided inconsistently by separate agents.
- Current gaps and status snapshots belong in [implementation status](implementation-status.md); avoid changing the target specification into an optimistic progress report.
