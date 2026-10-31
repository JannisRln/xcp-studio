# XCP simulator scope

This milestone implements a synchronous, in-memory XCP-on-CAN master and slave.

Supported commands: CONNECT, DISCONNECT, SET_MTA, UPLOAD,
SHORT_UPLOAD (slave-side), DOWNLOAD. CAN CTO length is at most eight bytes.

The simulator uses a byte-addressed, little-endian target, with 32-bit
addresses, a configurable memory window and optional write protection.
Commands return XCP positive/negative response PIDs and basic error codes.

## Run tests on Windows

```powershell
cargo test --workspace
cargo fmt --all -- --check
```

## Limitations

- No physical PCAN or Vector hardware access yet.
- No asynchronous receive, retries, timeouts, event packets, or DAQ.
- No transport-layer CAN ID negotiation.
- No resource unlocking, checksums, address extensions other than zero,
  or variable address granularity.
- The synchronous simulator is a test double, not a production ECU.
- Calibration is simulated only; do not use the current code on a real ECU.
