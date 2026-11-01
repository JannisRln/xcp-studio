# ADR-0001 — REST for control, WebSocket for streaming

**Status:** accepted architectural direction; target v1 protocol not yet implemented.  
**Date:** 2026-11-01  
**Related requirements:** API-001, API-004, MEAS-002, MEAS-004, MEAS-005.  
**Tickets:** T-0012, T-0005, T-0006.

## Context

An ECU engineering workstation must combine low-frequency control operations with continuous measurement data. Polling HTTP from React would couple timing to the browser and introduce unnecessary requests, particularly at higher signal rates. Backend access to CAN/XCP must remain serialized and independent of UI rendering.

The current server already uses Axum REST for connect/read and a WebSocket endpoint for per-client polling. This is an intermediate implementation, not shared acquisition.

## Decision

- Use REST/JSON to configure/connect/disconnect sessions, import metadata, initiate reads, create/stop acquisitions, and commit verified calibration transactions.
- Use WebSocket for live sample batches, acquisition state, drop/quality events and diagnostics subscriptions.
- The **backend acquisition service** creates and owns sampling/DAQ; WebSocket clients subscribe to an existing acquisition ID.
- Keep messages versioned, bound queue sizes, explicit timestamps/sequence/quality and loss notification.
- Recording is backend-owned, decoupled from any browser subscription.
- Keep server loopback-only until authentication/authorization and WebSocket origin controls exist.

## Alternatives considered

- Repeated REST polling: simple initially but wastes traffic and couples schedule to tab lifecycle; acceptable only as an explicitly bounded backend fallback to XCP DAQ.
- gRPC streaming: strong schemas but more deployment/client complexity at this stage; reconsider if remote multi-process clients justify it.
- SSE: useful for one-way events but weaker for current bidirectional stream control/recovery requirements; not selected as primary measurement transport.
- Native frontend-to-CAN: rejected due to driver isolation, safety and inconsistent session ownership.

## Consequences and migration

- Maintain current /api/xcp/stream until versioned subscriber endpoint and compatibility tests are delivered.
- Client must reconnect without independently starting additional ECU polling loops.
- Version and test wire contracts between Rust and TypeScript.
- Multi-client tests must show a single acquisition schedule. Backpressure must never stall the ECU acquisition task.

## Verification

T-0012 defines shared JSON fixtures and error/timebase semantics; T-0005 proves multi-client fanout/drop behavior; T-0006 verifies chart/CSV fidelity against sample batches.
