# Architecture — Current Baseline and Target Design

**Architecture status:** Normative boundaries plus an explicitly labeled prototype baseline.  
References: [product specification](product-specification.md), [API contract](api-contract.md), [requirements](requirements.md), [ADRs](adr/README.md), [agent workflow](agent-workflow.md).

## 1. Architectural principles

1. **Backend owns ECU I/O.** React never communicates directly with a CAN driver or hardware SDK.
2. **One XCP session coordinator per ECU.** Commands that manipulate MTA or other session state are serialized, including when invoked by concurrent API requests.
3. **Acquisition is independent of the UI.** React subscribes to samples; closing a browser tab must not cancel recording unless explicitly requested.
4. **Strongly typed and traceable data.** Source metadata, runtime address, endianness, conversions and quality are explicit.
5. **Control plane separate from data plane.** HTTP/REST for connection/configuration/commands; WebSocket for measurement/diagnostic events.
6. **Bounded resource use.** Incoming files, sample buffers, queues, subscribers and recordings have enforceable limits.
7. **Simulator-first, hardware-safe.** Validate behavior without vendor SDKs; hardware needs separate evidence and safe defaults.
8. **No speculative success.** Unsupported commands, unknown metadata and failed writes produce typed errors, not mocked successes.

## 2. Existing repository and prototype

| Path | Current responsibility | Known constraint |
| --- | --- | --- |
| crates/xcp-core/src/lib.rs | CAN frame/transport traits; simulator and Windows adapter exports | Transport interface is synchronous |
| crates/xcp-core/src/xcp.rs | XCP master and in-memory simulated slave | Scoped CTO commands, no ECU DAQ |
| crates/xcp-core/src/elf.rs | ELF symbol inspection, DWARF compilation-unit summary | No complete typed variable/location graph |
| crates/xcp-core/src/pcan.rs | PCAN-Basic classic CAN adapter for Windows | No production hardware session factory or UI wiring |
| crates/xcp-server/src/main.rs | Axum HTTP API and per-client WebSocket polling stream | Monolithic process state, Mutex guarding XCP, no shared acquisition service |
| frontend/src/main.tsx | Application entrypoint in baseline main | Modular dashboard proposed in PR #18; see status snapshot |
| frontend/src/features/measurements/ | Demo/live XCP measurement components in baseline | Per-tab buffer and polling; no backend recorder |
| .github/workflows/ci.yml | Windows Rust and frontend jobs | Rustfmt applied in temporary runner; Clippy/npm ci still outstanding |

Do not mistake a prototype endpoint or a merged PR for completion of its full requirement. [Implementation status](implementation-status.md) distinguishes partial functionality from verified milestones.

## 3. Target component model

~~~text
Windows desktop / local browser
 ┌──────────────────────────────────────────────────────────────┐
 │ React + TypeScript                                            │
 │ App shell | Workspace state | Signal Explorer | Calibration  │
 │ Time series charts | Diagnostics | Project editor           │
 │ Typed HTTP client                WS stream client            │
 └───────────────┬──────────────────────────┬───────────────────┘
                 │ REST commands/config     │ WS samples/events
 ┌───────────────▼──────────────────────────▼───────────────────┐
 │ Axum API (loopback-only default)                               │
 │ Versioned validators | error mapper | request IDs             │
 │ Session API | Metadata API | Acquisition API | Recorder API    │
 └───┬─────────────┬────────────────┬───────────────────────────┘
     │             │                │
 ┌───▼─────────┐ ┌─▼──────────────┐ ┌▼──────────────────────────┐
 │ ECU metadata│ │ Session actor   │ │ Acquisition service      │
 │ ELF / DWARF │ │ XCP state       │ │ Scheduler / DAQ receiver  │
 │ A2L mapping │ │ cmd queue       │◄┤ Signal decoding / quality│
 │ Ptr resolver│ │ capability map  │ │ Bounded fanout / recorder │
 └─────────────┘ └─┬──────────────┘ └────────────┬──────────────┘
                   │                              │
             ┌─────▼──────────────────────┐      ┌▼──────────────┐
             │ CAN transport abstraction   │      │ Recording store│
             │ Simulator | PCAN | Vector   │      │ Export / files │
             └─────┬──────────────────────┘      └───────────────┘
                   ▼
                ECU / simulated slave
~~~

A browser WebSocket is a **subscriber**, never an ECU acquisition owner. Session ownership and a single read/write scheduler are backend services. The project store must be independent of frontend component instances.

## 4. Recommended repository boundaries (target)

~~~text
crates/
  xcp-core/
    src/
      transport/     # transport trait and CAN frame validation
      xcp/           # session commands, capability negotiation
      ecu/           # typed addresses, values, conversions, provenance
      metadata/      # ELF/DWARF and A2L parsing, pointer expressions
      acquisition/   # sampling schedule, DAQ, stream events, buffering
      calibration/   # validation, write/readback, audit records
      simulator/     # deterministic slave, fault injection
      recording/     # backend writer and export formats
  xcp-server/
    src/
      api/           # REST and WebSocket handlers, versioned DTOs
      services/      # session actor, acquisition lifecycle, state registry
      main.rs        # composition root only
frontend/
  src/
    app/             # router, app shell, providers and global error boundary
    core/            # API wire types, runtime validators, domain IDs
    components/      # reusable accessible chart/table/form primitives
    features/
      connections/
      symbols/
      measurements/
      calibration/
      diagnostics/
      projects/
    test/            # test fixtures, render utilities, E2E support
docs/
  tickets/           # agent-executable tasks; source-controlled backlog
  adr/               # architectural decisions
~~~

These are **desired boundaries**, not a mandate to reorganize all directories in one PR. Migrations should be incremental and preserve public APIs unless a ticket explicitly changes them.

## 5. Domain concepts and ownership

| Concept | Owner | Data invariants |
| --- | --- | --- |
| ConnectionProfile | Project/config service | Transport type and parameters validated; no embedded secrets |
| Session | Rust session actor | At most one serialized command path per connected ECU |
| EcuImage | Metadata service | File hash/build ID + target architecture + origin |
| VariableDescriptor | Metadata service | Stable path, type, location state, provenance |
| ResolvedAddress | Pointer/runtime resolver | Only validated addresses may reach XCP I/O |
| SignalDefinition | Measurement domain | Stable ID, variable reference, sample type, unit/conversion |
| Acquisition | Backend acquisition service | Unique ID, lifecycle, schedule, subscriber-independent |
| SampleBatch | Acquisition service | Sequence/timebase, typed values/quality and gap metadata |
| Recording | Backend recorder | Immutable capture metadata, streaming writes, bounded size |
| CalibrationTransaction | Calibration service | Baseline, proposal, confirmation, readback and outcome |

Frontend keeps ephemeral UI state (filters, panels, cursor position); project service persists durable workspace state. Never duplicate authoritative session/acquisition state in multiple React components without a synchronization strategy.

## 6. Session state and concurrency contract

~~~text
DISCONNECTED --connect--> CONNECTING --success--> CONNECTED
                                │
                                └--failure--> ERROR --reset--> DISCONNECTED
CONNECTED --disconnect--> DISCONNECTING --success--> DISCONNECTED
CONNECTED --transport failure--> ERROR/RECOVERING (policy-controlled)
~~~

- A session actor/command queue serializes CONNECT, SET_MTA, UPLOAD, DOWNLOAD and DISCONNECT.
- Backend requests carry cancellation/deadline; a canceled frontend request does not leave an invisible half-completed write.
- Acquisition cannot issue a raw UPLOAD concurrently with a write unless the actor explicitly sequences both.
- If the ECU disconnects, backend sends a terminal acquisition state and stops the recorder safely; no implicit reconnection during calibration.
- Report active session ID/profile and capability set, not only a boolean.

**Current implementation difference:** the server uses an Arc<Mutex<Option<XcpMaster<SimulatedTransport>>>>. The per-WebSocket timer reads through the same mutex. This is an MVP shortcut and must not be described as the final acquisition architecture.

## 7. Acquisition lifecycle and backpressure

Target lifecycle: CREATED → CONFIGURED → STARTING → RUNNING → STOPPING → STOPPED; ERROR is terminal until explicit recovery.

1. Validate all signal descriptors and address/runtime location states.
2. Determine DAQ capability and schedule; choose explicit polling fallback if DAQ is unavailable.
3. Create one acquisition ID and bounded sample queue/recording channel.
4. Timestamp as close to actual reception as possible; preserve timebase metadata.
5. Decode raw values; apply conversion only when metadata validates; attach quality/error flags.
6. Publish to bounded subscribers with defined overflow/gap behavior; avoid blocking capture on a slow WebSocket client.
7. Record samples independently of subscribers with bounded write queue and disk policy.
8. On stop/disconnect, finish inflight operations, flush writer, emit final counters, close subscriptions.

**Target data contract:** sequence, timestamp, provenance/quality, values, dropped count, rates and acquisition ID. See [API contract](api-contract.md). The existing stream currently emits only timestamp_ms and samples [{name,address,value}].

## 8. ECU variable identity, types and address safety

Preferred pipeline:

~~~text
ELF/DWARF/A2L/manual input
  -> parse bounds and target metadata
  -> canonical variable/type descriptor
  -> reconcile source conflicts
  -> resolve link-time/runtime location
  -> optional bounded pointer dereference
  -> validate memory region/access/capability
  -> typed XCP read/write
  -> raw value + physical conversion + quality
~~~

Type representation must include (where applicable): signedness, byte size, floating format, endian, array extents, qualifiers, member offsets, pointer width and address extension. Unsupported/optimized-out DWARF entries remain visible but not actionable.

## 9. Frontend data architecture

- App root composes connection/session provider, project store, API clients and errors.
- Features own their components and local state. Shared reusable chart/table primitives reside in components; business logic stays in features/domain.
- Typed client reads versioned DTOs; validate untrusted WebSocket messages at runtime before appending to buffers.
- Keep chart history bounded and decimated for rendering; recording completeness is guaranteed by the backend, not by chart buffer length.
- Use accessible table behavior and virtualize large symbol datasets; confirm complex libraries by license/bundle/performance evaluation rather than adding dependencies reflexively.
- Distinguish connection *status* from successful sample acquisition and from recording *status*.
- A route change must not implicitly overwrite signal configuration or silently stop ongoing recording.

## 10. Error taxonomy, observability and security

Error families: VALIDATION, SESSION, TRANSPORT, XCP_NEGATIVE_RESPONSE, METADATA, LOCATION, ACQUISITION, RECORDING, CALIBRATION, PERMISSION, INTERNAL.

Every API error should preserve a stable code, human-readable message, correlation ID and optional field details. Log internal root cause but do not expose driver secrets or raw memory unexpectedly. Use structured logs and metrics: command queue latency, timeout counts, stream subscribers, dropped samples, timestamp drift, file writer status.

Default binding is 127.0.0.1. Network exposure of calibration/write interfaces is blocked without a dedicated security design: authentication, authorization, origin checks, transport security and local privilege policy. See [ADR-0001](adr/0001-control-and-streaming.md) and [ADR-0002](adr/0002-session-and-acquisition-ownership.md).

## 11. API evolution and compatibility

- Current routes remain available until a migration ticket with compatibility tests replaces them.
- New public APIs use versioned paths or envelope/schema versions; no silent breaking field/semantic changes.
- Explicitly distinguish current server wire formats from proposed next-generation formats in [API contract](api-contract.md).
- TypeScript clients must not assume arbitrary JSON fits a trusted interface; validate public boundary messages.
- Document any clock, quality, unit or encoding change together with client tests and migration notes.

## 12. Multi-agent integration rules

Each area has one owning ticket/branch at a time, unless paths and interfaces are explicitly partitioned. Agents may work in parallel on independent modules (e.g. metadata parser and chart UI) against a frozen published DTO. Do not change core DTOs, XCP session operations, lockfiles or CI from multiple branches without coordination. Shared contract changes require an ADR/API update first.

See [agent workflow](agent-workflow.md), [ticket index](tickets/INDEX.md) and [PR template](../.github/PULL_REQUEST_TEMPLATE.md).
