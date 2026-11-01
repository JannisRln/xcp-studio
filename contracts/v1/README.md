# Versioned simulator API v1 fixture contracts

The checked-in JSON documents are **schema examples**, tested by both Rust (`crates/xcp-server/src/api/v1.rs`) and TypeScript (`frontend/src/core/apiV1.test.ts`). They provide deterministic expected value shape, not live response timestamps or live request IDs.

| Fixture | Route and meaning |
| --- | --- |
| health.json | GET /api/v1/health |
| session.json | GET /api/v1/sessions/current |
| read.json | POST /api/v1/sessions/current/reads with address 4096, count 4 |
| error-disconnected.json | Error response for reading while disconnected (409) |
| acquisition-sample.json | Shared acquisition WebSocket samples event |
| acquisition-gap.json | Subscriber overflow/gap WebSocket event |
| acquisition-status.json | GET /api/v1/acquisitions/current or ID, POST acquisition status object |
| acquisition-sample-qualified.json | Additive per-sample scalar type, finite-read quality, manual address provenance and clock-source fields |
| acquisition-gap-scoped.json | Subscriber-specific lag event, never global ECU loss |
| acquisition-failed.json | Terminal acquisition failure (no silent partial sample frame) |
| error-validation.json | Structured 422 v1 error with non-sensitive optional validation details |

Versioning policy: additive changes are allowed within a version only if older consumers still parse responses; breaking semantics require a new version or explicit migration. Unknown schema_version is an error. Do not represent large 64-bit values as floating-point JSON numbers. Acquisition samples and gaps have a **implemented backend polling** WebSocket versioned envelope (T-0005). This does not implement ECU-side DAQ, persistent recording or replay.

The original unversioned /api/xcp/* routes remain available and unchanged.

## Measurement contract extension (compatible v1)

The baseline `acquisition-sample.json` and `acquisition-gap.json` remain valid. The v1 backend additionally emits optional fields on successful sample frames: `timestamp_origin: "host_utc_after_reads"`, `monotonic_clock: "acquisition_elapsed"`, and per-sample `value_type`, `quality: "valid"`, `address_origin: "manual"`. A gap emitted due to slow subscriber fanout can include `scope: "subscriber"`. Values are decoded finite scalars from **simulator XCP polling**; "valid" does not certify an ECU timestamp, runtime address mapping, physical scaling, simultaneous acquisition or hardware quality. Poll/read errors terminate the run with `state: "failed"`; null/invalid samples are *not* silently fabricated.

`timestamp_ms` uses host UTC epoch milliseconds after sequential reads; `monotonic_elapsed_ms` is elapsed backend acquisition runtime in milliseconds. Both are JS-safe integer numbers (no ECU timebase). `sequence` is backend-batch sequence; `dropped` is a count of lost broadcast events for **one subscriber**, not missing ECU acquisition frames. `dropped_since_previous` remains zero on emitted sample frames; consumers must act on gap events. No reliable replay/retention is implied.

A `value_type` is one of u8/i8/u16/i16/u32/i32/f32/f64; integer values obey signedness, integrality and exact width bounds. 32-bit addresses and every raw read width must remain in range. Large 64-bit integers and nanosecond ticks require decimal strings in a future separately negotiated schema; do not pass them as JSON numbers. Missing / undefined extension fields are accepted for older v1 producers; unknown versions and known-enum invalid values are rejected by TS boundary parsing. New fields are additive; all legacy `/api/xcp/*` routes and prior v1 fields remain supported.

Rollback: revert the producer/consumer extension without changing any route, request body or original fixture. Release/merge still requires T-0005 and T-0006 owner review of this additive contract.
