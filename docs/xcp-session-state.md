# XCP session lifecycle, recovery and deadline contract

**Ticket:** T-0004. **Scope:** current classic CAN simulator-first Rust core; not a full ASAM XCP implementation.

## State transitions

| Initial state | Command / result | Next state | Observable caller result |
| --- | --- | --- | --- |
| Disconnected | CONNECT success, supported mode | Connected | CONNECT response |
| Disconnected | read/write | Disconnected | SessionError::Disconnected |
| Disconnected | DISCONNECT | Disconnected | Ok, no CAN frame |
| Disconnected | CONNECT timeout, transport, invalid mode/response, negative | Faulted | Explicit XCP or timeout error |
| Connected | CONNECT | Connected | Cached response, no additional CAN traffic |
| Connected | read/write success | Connected | Bytes or Ok |
| Connected | benign negative ERR (access denied, out of range) or invalid caller address | Connected | Protocol error or invalid parameters |
| Connected | ERR_SEQUENCE, transport loss, malformed CTO or no response | Faulted | XCP error |
| Connected | deadline exceeded while in flight | Faulted | SessionError::Xcp(XcpError::DeadlineExceeded) (outcome unknown) |
| Connected | DISCONNECT acknowledged | Disconnected | Ok |
| Connected | DISCONNECT failure | Faulted | XCP error; ECU disconnection unconfirmed |
| Faulted | read/write | Faulted | SessionError::Faulted |
| Faulted | CONNECT after stale-reply drain and valid response | Connected | CONNECT response; operator initiated |
| Faulted | CONNECT error or drain failure | Faulted | Explicit error |
| Faulted | DISCONNECT acknowledged | Disconnected | Ok |
| Any | queued request deadline exceeded before execution | Unchanged | SessionError::Xcp(XcpError::DeadlineExceeded); no CAN command sent |
| Any | actor stopped / command queue full | Unchanged | WorkerStopped / Xcp(CommandQueueFull) |

A synchronous caller's deadline includes actor queue wait, the CONNECT/SET_MTA/UPLOAD/DOWNLOAD sequence and reply transmission. The queue is bounded to 128 pending commands. Expired queued operations are never executed. In-flight operations may have affected ECU memory before timing out: there is **no automatic retry, rollback or success claim**. A write must be treated as an unknown outcome until the operator performs a fresh connection and verified readback.

## CTO receive / reconnect limitations

- Each XCP request checks the earlier of its response timeout (default 500 ms) and the operation deadline (default 10 s). Unrelated CAN IDs are ignored until the deadline; empty receive polls do not spin at 100% CPU.
- The transport's `receive_with_timeout` must honor the supplied remaining timeout for a hard deadline. The default trait adapter preserves existing nonblocking transports but **does not interrupt blocking driver calls**. Windows PCAN uses the lower of configured receive timeout and remaining CTO budget; no physical adapter is enabled by these tests.
- After faults the actor discards up to 64 pending CAN frames via zero-timeout receives before explicit reconnect or disconnect. This reduces stale CTO confusion, but CAN CTO responses lack transaction IDs: late frames arriving after the drain can still be ambiguous. Production adapters require controlled receive flush/reset and hardware verification; the session must not automatically replay writes.
- CONNECT validates the seven-byte classic CAN response, little-endian byte granularity and max CTO 8; calibration resource bit is checked before DOWNLOAD. Non-default address granularity, big-endian address coding, multi-packet transport framing, address extensions, resource unlock, ECU DAQ and negotiated service-specific capabilities remain unsupported. No unsupported mode is silently reinterpreted as simulator defaults.
- This state model is internal to xcp-core. Existing HTTP/WS response DTOs and the frontend have not been modified.

## Reproducible verification

- Unit/integration: `cargo test -p xcp-core`, including `crates/xcp-core/tests/xcp_simulator.rs` and `crates/xcp-core/tests/session_faults.rs`.
- Formatting/lints: `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`.
- Broader integration: `cargo test --workspace` and `python scripts/check_docs.py`; Windows CI is authoritative if Rust is unavailable locally.
- Simulator and transport mock results do not replace physical HIL verification.
