# ADR-0002 — Rust session actor and backend acquisition ownership

**Status:** accepted target architecture, migration not complete.  
**Date:** 2026-11-01  
**Related requirements:** XCP-002, XCP-006, MEAS-004, MEAS-005, CAL-001.  
**Tickets:** T-0004, T-0005, T-0007, T-0015.

## Context

XCP uses stateful commands such as SET_MTA followed by UPLOAD/DOWNLOAD. Concurrent REST requests, WebSocket timers and calibration operations can corrupt each other's operations if access is not serialized at the session level. Browser-owned capture is also vulnerable to tab lifecycle, slow rendering and duplicate polling.

The existing simulator uses an Arc<Mutex<Option<XcpMaster<SimulatedTransport>>>>. This serializes some synchronous calls but leaves scheduling, cancellation, ownership and long-running recording undefined.

## Decision

- Introduce one Rust session owner (actor or equivalent serialized command queue) per ECU, owning transport, negotiated capabilities and lifecycle.
- Every MTA-sensitive operation passes through the owner with deadline and typed outcome; no direct caller accesses shared mutable XCP state.
- Introduce one backend acquisition service per active acquisition, using session commands for polling or a DAQ receive path when supported.
- Subscriber count must not alter ECU acquisition frequency.
- Use bounded channels for acquisition→fanout and acquisition→recorder, explicit overflow and stop semantics.
- Calibration write/readback is a serialized transaction with a known baseline, explicit confirmation and error/unknown outcome.
- Keep wall and monotonic clock semantics separate; include quality/gaps in exported data.

## Alternatives considered

- One mutex around every shared call: adequate for initial simulator but insufficient for explicit scheduling, fairness, cooperative cancellation and shared capture lifecycle.
- Independent session per browser tab: rejected because ECU load multiplies and commands can interfere.
- Browser-side recording: rejected as loss-prone and unbounded for longer sessions.

## Consequences and migration

- Begin with typed session interface and explicit service ownership (T-0004), then shared acquisition (T-0005) and recording (T-0015).
- Keep session and API wire DTOs distinct. Do not hold a blocking mutex across async work on the final architecture.
- Use deterministic simulator fixtures and fault injection before hardware access.
- Hardware write enablement is a separate safety milestone; simulator verification alone is insufficient.

## Verification

Concurrency and cancellation tests; two WebSocket clients observing one acquisition; bounded buffer stress; disconnect while recording; calibration serialization/readback tests.
