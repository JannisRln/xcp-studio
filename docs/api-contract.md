# API and Streaming Contract

**Scope:** API contract and proposed evolution. **CURRENT** means implemented in the default-branch backend at specification authoring; **TARGET** means design proposal requiring a ticket, tests and code. No TARGET endpoint may be treated as callable before it is implemented.

Related: [architecture](architecture.md), [requirements](requirements.md) (API-001..004), [ADR-0001](adr/0001-control-and-streaming.md), [ADR-0002](adr/0002-session-and-acquisition-ownership.md).

## 1. Protocol boundaries

- HTTP JSON requests/responses over the loopback Axum server (default 127.0.0.1:8080).
- HTTP binary upload only for ELF inspection; maximum currently 32 MiB.
- WebSocket for measurement data. Initial client text message configures current stream.
- The Vite development proxy must support HTTP and WebSocket upgrade. Browser URLs use ws: on HTTP and wss: on HTTPS.
- This interface is **not remotely authenticated**. Do not expose the server on 0.0.0.0 or a public proxy without implementing the security milestone.
- No external agent may assume xcp-core's Rust types are wire-stable; API DTOs are separately versioned.

## 2. CURRENT REST routes

| Method | Endpoint | Request | Success | Known limitation |
| --- | --- | --- | --- | --- |
| GET | /api/health | none | {status,mode,version} | mode reports simulation |
| POST | /api/elf/inspect | ELF bytes, application/octet-stream | {symbols:[...],count} | raw ELF symbols, no full typed DWARF variable tree |
| GET | /api/xcp/status | none | {connected,transport} | boolean and simulation transport only |
| POST | /api/xcp/connect | none | {connected:true,transport:"simulation"} | singleton simulator session |
| POST | /api/xcp/disconnect | none | {connected:false,transport:"simulation"} | no persistent acquisition coordination |
| POST | /api/xcp/read | JSON {address,count} | {address,bytes,hex} | count 1–4096, requires connected session |
| POST | /api/xcp/snapshot | JSON {signals:[...]} | {timestamp_ms,samples:[...]} | per-signal serialized XCP reads; 1–64 signals |
| GET (Upgrade) | /api/xcp/stream | first WS text frame is configuration JSON | repeated snapshot JSON | per-client polling schedule, no DAQ/shared recorder |

Existing routes are unversioned; target versioned routes must be implemented additively/migrated under an explicit compatibility ticket.

### 2.1 Current ELF inspection

Request: POST /api/elf/inspect with raw ELF bytes. Response:

~~~json
{
  "count": 1,
  "symbols": [
    {
      "name": "engine_speed",
      "address": 4096,
      "address_hex": "0x1000",
      "size": 4,
      "kind": "data"
    }
  ]
}
~~~

Example is *shape only*, not a promise that a particular ELF fixture exists. The symbol address is link-time metadata and **must not** automatically become a validated runtime ECU address.

### 2.2 Current read and typed snapshot

~~~http
POST /api/xcp/read
Content-Type: application/json

{"address":4096,"count":4}
~~~

~~~json
{"address":4096,"bytes":[58,7,0,0],"hex":"3A 07 00 00"}
~~~

~~~http
POST /api/xcp/snapshot
Content-Type: application/json

{"signals":[
  {"name":"Engine speed","address":4096,"value_type":"u32"},
  {"name":"Coolant temperature","address":4100,"value_type":"f32"}
]}
~~~

~~~json
{
  "timestamp_ms": 1761980000000,
  "samples": [
    {"name":"Engine speed","address":4096,"value":1850},
    {"name":"Coolant temperature","address":4100,"value":88.5}
  ]
}
~~~

Value types accepted by the prototype: u8, i8, u16, i16, u32, i32, f32, f64 (lowercase snake_case enum). Current simulator byte order is little-endian and addresses are 32-bit unsigned. JSON numbers are not appropriate for exact future 64-bit integer semantics; define explicit decimal-string or byte encoding first.

The current snapshot timestamp is a UTC epoch milliseconds host-clock observation **after** sequential reads, not a hardware sample timestamp or a monotonic scheduler clock. No claim of precise simultaneity is allowed.

### 2.3 Current WebSocket protocol

1. Connect to ws://127.0.0.1:8080/api/xcp/stream.
2. Send exactly one initial text message containing:

~~~json
{
  "interval_ms": 100,
  "signals": [
    {"name":"Engine speed","address":4096,"value_type":"u32"},
    {"name":"Coolant temperature","address":4100,"value_type":"f32"}
  ]
}
~~~

3. Receive repeated JSON snapshot frames with timestamp_ms and samples. interval_ms is 20–10000 inclusive; 1–64 signals; signal names contain 1–128 characters and cannot be whitespace-only.
4. On error the server may send {"error":"..."} and terminate. The current implementation has no stable error code, frame sequence, acquisition ID, quality or loss metadata.

The stream is **per WebSocket client**: opening another tab creates another polling schedule. That is explicitly not the target architecture.

### 2.4 Current errors

The current server uses response body {"error":"message"} for common 400 BAD_REQUEST paths (including disconnected session and invalid count). This is a prototype error shape; clients must check HTTP status. Some errors can differ by route. There is no guaranteed stable error code until API-002 is implemented.

## 2.5 Additive CURRENT /api/v1 REST slice (T-0012)

The following endpoints are implemented by T-0012 and retain the existing /api/* routes unchanged. Only these endpoints are currently supported; the rest of the v1 proposal in section 3 is not implemented.

| Method | Path | Successful response | Validation / errors |
| --- | --- | --- | --- |
| GET | /api/v1/health | {schema_version:1,status,mode,version} | No request body |
| GET | /api/v1/sessions/current | {schema_version:1,connected,transport} | Current simulated singleton only; **no opaque session ID yet** |
| POST | /api/v1/sessions/current/reads | {schema_version:1,address,bytes,hex} | Input {address:u32,count:1..4096}; 32-bit range overflow rejected |

For v1 reads, malformed JSON/unknown fields return HTTP 400 INVALID_JSON; count and address overflow return HTTP 422 INVALID_READ_COUNT / INVALID_ADDRESS_RANGE; disconnected session returns HTTP 409 XCP_SESSION_DISCONNECTED; XCP transport/protocol read failures return HTTP 502 XCP_READ_FAILED with retryable=true (the caller must decide if retry is safe). Every v1 structured error includes a nonempty per-process request_id, intended for correlation rather than a persistent session ID.

Example v1 error:

~~~json
{"schema_version":1,"error":{"code":"XCP_SESSION_DISCONNECTED","message":"XCP simulator is not connected","request_id":"request-1","retryable":false}}
~~~

Canonical shared fixtures: [contracts/v1](../contracts/v1/README.md). Both Rust server tests and TypeScript client tests validate them. The frontend uses these validated v1 endpoints for health/status/raw reads; connection/disconnection, ELF upload and measurement streaming remain on their unversioned routes. The v1 WS subscriber endpoint and DAQ/recording ownership remain target functionality for T-0005.

## 2.6 Shared backend polling acquisition v1 (T-0005)

This is a separately managed **single acquisition per simulator ECU**, not a new per-subscriber scheduler. T-0005 adds these routes while keeping the legacy `/api/xcp/stream` unchanged for compatibility:

| Method | Route | Request/response |
| --- | --- | --- |
| POST | /api/v1/acquisitions | Body `{interval_ms:100,signals:[{name,address,value_type}]}`; returns HTTP 201 with acquisition status |
| GET | /api/v1/acquisitions/{id} | Status, monotonic sequence, subscribers, drops, last error |
| POST | /api/v1/acquisitions/{id}/stop | Idempotently stop that acquisition; status |
| GET (WebSocket) | /api/v1/acquisitions/{id}/stream | Subscribe to **existing** acquisition; no initial config message |

A single active acquisition is allowed per process; to reconfigure, stop the existing one before creating another. Intervals: 20–10000 ms; 1–64 signals; signal names must be unique and nonempty, at most 128 UTF-8 bytes; address/byte width must fit 32-bit. Supported types remain u8/i8/u16/i16/u32/i32/f32/f64 in little-endian simulator memory. Create requires a connected session. HTTP 409 ACQUISITION_ALREADY_RUNNING or XCP_SESSION_DISCONNECTED, 404 ACQUISITION_NOT_FOUND, 422 INVALID_SAMPLE_INTERVAL/INVALID_SIGNALS/INVALID_SIGNAL_NAME/INVALID_SIGNAL_ADDRESS, 429 SUBSCRIBER_LIMIT. Error bodies use the stable v1 envelope in section 2.5.

The service broadcasts up to 128 events in a bounded Tokio channel, supports up to 16 subscribers, and never blocks acquisition on a slow receiver. Each subscriber that falls behind receives a versioned `gap` event with dropped event count; global status exposes cumulative subscriber lag events. No historical replay is available. Status `state` is running/stopped/failed and `sampling_mode` is explicitly `polling`.

**Sample event** from [shared fixture](../contracts/v1/acquisition-sample.json):

~~~json
{"type":"samples","schema_version":1,"acquisition_id":"acq-1","sequence":1,"timestamp_ms":1761980000000,"monotonic_elapsed_ms":20,"dropped_since_previous":0,"samples":[{"name":"Engine speed","address":4096,"value":1850},{"name":"Coolant","address":4100,"value":88.5}]}
~~~

**Gap event:** `{"type":"gap","schema_version":1,"acquisition_id":"acq-1","dropped":11}`.

**Terminal event:** `{"type":"status","schema_version":1,"acquisition_id":"acq-1","state":"stopped","reason":"operator_stop"}`; faulted acquisition emits `state:"failed",reason:"xcp_read_error"`. Subscriber closes after terminal status.

Timestamp semantics: `timestamp_ms` is a **host wall-clock** observation after sequential reads, not an ECU timebase. `monotonic_elapsed_ms` is measured since the backend acquisition task began. Both represent milliseconds, not nanosecond accuracy or synchronized multi-signal ECU timing. `sequence` increases once per emitted backend sample batch, regardless of subscriber count. These numeric fields are within JS-safe range for expected runtime; any future nanosecond or 64-bit exact values must be encoded as strings.

**Limitations:** no ECU-side DAQ/event acquisition, no durable recorder, no quality metadata for individual samples, no replay/resume, no hardware timestamp synchronization. See T-0005/T-0015 and section 4 for the richer *target* contract.

## 3. TARGET REST API v1 (design proposal; implemented subset identified below)

Except for the three **CURRENT** endpoints in section 2.5, these target endpoints require implementing tickets and contract tests; names are tentative until API-001 is fully accepted.

| Method | Proposed route | Purpose | State owner |
| --- | --- | --- | --- |
| GET | /api/v1/health | Ready/version/capability summary | API |
| GET | /api/v1/adapters | Enumerate simulator/PCAN/Vector and capabilities | Transport registry |
| POST | /api/v1/sessions | Connect using validated ConnectionProfile | Session actor |
| GET | /api/v1/sessions/{id} | State, ECU identity, capabilities | Session actor |
| DELETE | /api/v1/sessions/{id} | Explicit disconnect | Session actor |
| POST | /api/v1/ecu-images | Import ELF and optional A2L source | Metadata service |
| GET | /api/v1/ecu-images/{id}/variables | Paged search, types, location state | Metadata service |
| POST | /api/v1/variables/resolve | Resolve runtime/indirect location safely | Resolver |
| POST | /api/v1/sessions/{id}/reads | Typed or raw one-shot read | Session actor |
| POST | /api/v1/acquisitions | Validate and create acquisition, then start | Acquisition service |
| GET | /api/v1/acquisitions/{id} | Lifecycle, rates, buffers, drops | Acquisition service |
| POST | /api/v1/acquisitions/{id}/stop | Graceful stop (idempotent) | Acquisition service |
| GET | /api/v1/acquisitions/{id}/stream (WS) | Subscribe to existing acquisition | Acquisition service |
| POST | /api/v1/recordings | Start bounded backend recording | Recorder |
| POST | /api/v1/recordings/{id}/stop | Flush and finalize | Recorder |
| GET | /api/v1/recordings/{id}/export | Download CSV with metadata | Recorder |
| POST | /api/v1/calibrations/preview | Validate typed proposed change | Calibration service |
| POST | /api/v1/calibrations/commit | Explicit confirmed write/verify | Calibration service |
| GET | /api/v1/diagnostics | Session/acquisition/transport counters | Observability |

### 3.1 Proposed error envelope

~~~json
{
  "schema_version": 1,
  "error": {
    "code": "XCP_SESSION_DISCONNECTED",
    "message": "The requested ECU session is not connected.",
    "request_id": "req-opaque-id",
    "details": {"session_id": "session-opaque-id"},
    "retryable": false
  }
}
~~~

Stable codes map to HTTP status: VALIDATION (400 or 422), CONFLICT/INVALID_STATE (409), UNAUTHORIZED/FORBIDDEN (401/403 if auth introduced), NOT_FOUND (404), TIMEOUT (504), DEVICE_UNAVAILABLE (503), INTERNAL (500). No internal memory bytes, absolute user paths or driver credentials in public error messages. Define error compatibility and field validation before migration.

### 3.2 Proposed connection profile and session

~~~json
{
  "profile": {
    "transport": "simulation",
    "can_ids": {"command": 1639, "response": 1638},
    "bitrate": null,
    "adapter_id": "builtin-simulator"
  }
}
~~~

Expected session includes opaque session_id, state, capabilities, transport and ECU identity. Hardware-specific transport parameters are validated by the adapter, not interpreted as simulator fields.

### 3.3 Proposed measurement config

~~~json
{
  "session_id": "session-opaque-id",
  "sampling": {"mode": "auto", "fallback": "polling", "interval_ms": 100},
  "signals": [
    {
      "signal_id": "engine-speed",
      "variable_id": "ecu-image/variable-path",
      "resolved_address": {"space": "ecu", "address": "0x00001000", "extension": 0},
      "raw_type": "u32",
      "endianness": "little"
    }
  ],
  "recording": {"enabled": false}
}
~~~

The resolver must validate runtime address and variable type **server-side**, rather than trusting arbitrary browser-provided addresses. Manual raw-address signals need an explicitly distinguishable access policy.

## 4. TARGET WebSocket v1 message envelopes

A client **subscribes** to an already created acquisition; it does not start a new ECU polling loop. A single session/acquisition can have multiple subscribers.

### 4.1 Start and metadata

~~~json
{
  "schema_version": 1,
  "type": "acquisition.started",
  "acquisition_id": "acq-opaque-id",
  "session_id": "session-opaque-id",
  "timestamp_origin": "host-utc",
  "monotonic_clock": "process-monotonic",
  "sampling_mode": "polling",
  "units": {"engine-speed": "rpm"}
}
~~~

### 4.2 Sample batch

~~~json
{
  "schema_version": 1,
  "type": "samples",
  "acquisition_id": "acq-opaque-id",
  "sequence": 42,
  "host_timestamp_ns": "1761980000000000000",
  "monotonic_elapsed_ns": "4200000000",
  "dropped_since_previous": 0,
  "signals": [
    {
      "signal_id": "engine-speed",
      "raw": {"type": "u32", "value": "1850"},
      "physical": 1850.0,
      "unit": "rpm",
      "quality": "valid"
    }
  ]
}
~~~

**Numeric representation rationale:** 64-bit nanoseconds and exact integers use decimal strings on JSON to avoid JavaScript precision loss. Schema must define null/missing/invalid quality states, gap semantics, monotonic origin and conversion provenance.

### 4.3 State change and drop notification

~~~json
{
  "schema_version": 1,
  "type": "acquisition.status",
  "acquisition_id": "acq-opaque-id",
  "state": "stopped",
  "last_sequence": 420,
  "lost_samples": 2,
  "reason": "operator-stop"
}
~~~

Subscriber-specific queue overflow should report a gap without blocking ECU reads. Disconnect signals must be distinct from WebSocket network failure. Reconnect/resume semantics (replay range, retention bounds, duplicate handling) require explicit design and integration tests; do not imply guaranteed replay before it is implemented.

## 5. Calibration transaction protocol (target)

1. GET variable or POST preview reads baseline and validates type, range, permissions and ECU identity.
2. POST preview returns transaction token, baseline, desired raw bytes and physical units; token expires and is scoped to a session/image.
3. UI displays preview and operator confirms.
4. POST commit supplies token and expected baseline/version. Backend serializes write and readback.
5. Backend returns verified/mismatch/rejected/unknown outcome, actual readback and audit reference.
6. A timeout after transmission is **unknown outcome**, not automatic failure with assumed unchanged ECU state.

**No /api/v1/calibrations/commit route exists in the current backend.** All hardware writes stay disabled until policy and testing are complete.

## 6. Versioning and consumer-driven testing

- Current unversioned routes are compatibility constraints while used by deployed frontends.
- Propose new /api/v1 endpoints additively; breaking schema changes bump schema_version or API path.
- Both Rust server DTOs and TypeScript decoding must use representative fixtures for success, malformed input, missing fields, unknown types, precision and errors.
- API fixture files should be shared between backend and frontend tests to prevent semantic drift.
- Never mark API-001..004 done based on documentation alone. Test the implementation and update this file with observed routes, not hypothetical behavior.
- Origin/security controls are a release blocker for network-exposed endpoints.
