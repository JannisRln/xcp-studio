# XCP-on-CAN Simulator — Implemented Scope and Target

**Implemented scope:** deterministic in-memory XCP master/slave and a loopback HTTP/WebSocket API.  
**Target scope:** shared acquisition engine, DAQ support and complete session lifecycle ([T-0004](tickets/T-0004-xcp-session-actor.md), [T-0005](tickets/T-0005-shared-acquisition.md)).

## 1. Existing simulated transport

- crates/xcp-core/src/xcp.rs contains XcpMaster, SimulatedTransport and SimulatedSlave.
- SimulatedTransport invokes the slave immediately when the master sends a matching CAN frame, with response queued for receive.
- The simulated target uses **32-bit addresses**, **byte addressing**, **little-endian values** and **classic CAN frames up to 8 bytes**.
- Default CAN identifiers: command 0x667, response 0x666. These are simulator defaults, not universal ECU defaults.
- SimulatedSlave::new(base, size) allocates a bounded memory window; writable mode can be disabled.
- The server initializes memory at base 0x1000, size 65,536 bytes:
  - 0x1000: u32 1850 (engine speed, little-endian)
  - 0x1004: f32 88.5 (coolant temperature, little-endian)

The initialized values stay constant unless explicitly changed. Flat plots are expected and are *not* evidence that WebSocket streaming is broken.

## 2. Implemented command subset

| Command | Opcode | Current behavior | Limits |
| --- | --- | --- | --- |
| CONNECT | 0xFF | Start session and return basic communication mode | Simulated capabilities only |
| DISCONNECT | 0xFE | End active session | Connected state required |
| SET_MTA | 0xF6 | Position byte address in memory | Address extension 0, 32-bit address |
| UPLOAD | 0xF5 | Read consecutive memory bytes | At most 7 data bytes per 8-byte CTO response |
| SHORT_UPLOAD | 0xF4 | Slave-side direct address read | At most 7 bytes; not separate master helper |
| DOWNLOAD | 0xF0 | Write consecutive memory bytes | At most 6 bytes per 8-byte CTO request |

The master provides read(address,count) by SET_MTA + chunked UPLOAD and write(address,bytes) by SET_MTA + chunked DOWNLOAD. Both are currently synchronous. The master has a configurable response timeout and ignores unrelated CAN IDs until its deadline; a transport receive call must itself be bounded. **Do not describe this as full production retry/reconnect support.** Negative responses, unsupported commands, wrong sequence and out-of-range accesses return protocol errors.

## 3. Existing HTTP API and streaming

After running xcp-server on 127.0.0.1:8080:

| Purpose | Route | Notes |
| --- | --- | --- |
| Connect/disconnect | POST /api/xcp/connect; POST /api/xcp/disconnect | Singleton simulated session |
| Status | GET /api/xcp/status | connected and transport |
| Raw read | POST /api/xcp/read | address (u32), count 1–4096 |
| Snapshot | POST /api/xcp/snapshot | 1–64 signals with address/name/value_type |
| Live feed | WebSocket /api/xcp/stream | First client message sets interval_ms 20–10000 and signals |

The current stream polls sequentially per WebSocket client; each client has its own schedule, and backend recording/DAQ does not yet exist. Current stream JSON includes timestamp_ms and samples, **not** guaranteed synchronized ECU sample timestamps, sequence or quality.

Sample snapshot request:

~~~json
{
  "signals": [
    {"name":"Engine speed","address":4096,"value_type":"u32"},
    {"name":"Coolant temperature","address":4100,"value_type":"f32"}
  ]
}
~~~

Refer to [API contract](api-contract.md) for exact current wire fields and proposed versioned API. Never substitute the proposed endpoints for the real running server.

## 4. Tests

From repo root with Rust installed:

~~~sh
cargo fmt --all -- --check
cargo test --workspace
~~~

Desired integration test matrix:
- Connect/disconnect sequence and idempotent errors.
- Known 1850 and 88.5 raw bytes/typed decoding.
- Different reads crossing 7-byte packet boundaries; write crossing 6-byte packets.
- Out-of-range, protected memory and unsupported command errors.
- Wrong CAN ID, corrupted response, missing response and timeout.
- Concurrent sessions/reads with serialized MTA ownership.
- WebSocket configuration validation, disconnect handling and slow subscriber behavior.

Only tests actually present and passing can be cited as verification. See [test strategy](test-strategy.md).

## 5. Unsupported features and safety limitations

- No physical hardware is selected via the current server API.
- No ECU DAQ/STIM, event packets, dynamic DAQ allocation or production clock synchronization.
- No protocol resource unlocking, checksums, pages, extended address features or full transport negotiation.
- No backend-owned recorder, persistent acquisition ID or shared multi-client fanout.
- No complete retry/backoff/recovery state machine.
- No guarded public calibration write/readback API.
- No production ECU safety or performance guarantee.

Simulator-only command support is a test mechanism. See [security/safety policy](security-safety.md) before any hardware expansion.
