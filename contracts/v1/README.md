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

Versioning policy: additive changes are allowed within a version only if older consumers still parse responses; breaking semantics require a new version or explicit migration. Unknown schema_version is an error. Do not represent large 64-bit values as floating-point JSON numbers. Acquisition samples and gaps have a **implemented backend polling** WebSocket versioned envelope (T-0005). This does not implement ECU-side DAQ, persistent recording or replay.

The original unversioned /api/xcp/* routes remain available and unchanged.
