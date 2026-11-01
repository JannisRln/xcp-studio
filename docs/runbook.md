# Developer and Operator Runbook (Simulator Baseline)

This runbook documents safe local development and diagnostics. It does not certify physical hardware behavior.

## 1. Prerequisites

- Supported Windows release/test environment with Rust stable (rustfmt/clippy) and Node.js 22.
- Git and Python 3.12 for docs validation.
- A local checkout of xcp-studio; no Docker is required for simulator work.
- Vendor PCAN/Vector drivers are not needed for simulator tests.

## 2. Build and start

From repository root:

~~~powershell
cargo fmt --all -- --check
cargo test --workspace
cargo run -p xcp-server
~~~

In a second terminal:

~~~powershell
cd frontend
npm ci
npm run dev
~~~

Open the localhost URL reported by Vite (typically port 5173); backend health is http://127.0.0.1:8080/api/health.

**Dependency reproducibility:** frontend/package-lock.json is committed. Use npm ci with Node.js 22 for clean installs; Node/Rust commands require the corresponding toolchains.

## 3. Simulator sanity check

1. GET /api/health should report status=ok and mode=simulation.
2. POST /api/xcp/connect (empty body) then GET /api/xcp/status reports connected=true.
3. POST /api/xcp/read with {"address":4096,"count":4} returns little-endian bytes for u32 1850.
4. POST /api/xcp/snapshot with two typed signals (0x1000/u32, 0x1004/f32) returns 1850 and 88.5 in the initialized simulator.
5. Connect a WebSocket to /api/xcp/stream; send {"interval_ms":100,"signals":[{"name":"rpm","address":4096,"value_type":"u32"}]}; inspect timestamped samples.
6. Stop/close WS, POST /api/xcp/disconnect and check status.

These samples are simulator memory reads, not ECU hardware or synthesized charts.

## 3.1 Live View end-to-end acceptance (Windows simulator + browser proxy)

**Live View is the primary workflow; backend recording is optional.** Open the Vite URL, connect the simulator from the Live View, select Engine speed (u32/0x1000) and Coolant (f32/0x1004), and start acquisition. Verify live values and a numeric receive rate. Simulator data is constant by design, so a flat chart is valid.

The automated script exercises the **actual compiled Rust server, Vite proxy, XCP CONNECT, typed acquisition startup, two simultaneous WebSocket subscribers, stable data/sequence/timebase, browser reconnection, explicit stop, and disconnected-session rejection**, with no fake WebSocket responses.

From the repository root:

~~~powershell
cargo build -p xcp-server
cd frontend
npm ci
cd ..
node scripts/live-view-e2e.mjs
~~~

This test spawns and stops the simulator server and Vite itself, and requires ports 8080 and 5173 to be free. Use Node.js 22 or newer for its built-in WebSocket support.

Windows CI job `live-view-e2e` runs this script after clean builds. Where Microsoft Edge is available, it saves an **actual browser screenshot** of the running Live View in the `xcp-live-view-windows` workflow artifact. The script validates HTTP/WebSocket behavior but does not automate clicking the React chart or establish physical ECU/HIL performance evidence. These require a separate browser-interaction acceptance test.

## 4. Troubleshooting

| Symptom | Check | Safe next step |
| --- | --- | --- |
| Frontend API offline | Server process and localhost port 8080; Vite proxy | Start xcp-server and refresh status |
| WebSocket fails to upgrade | Vite WebSocket proxy configuration and server WS endpoint | Verify ws proxy setting and browser network trace |
| XCP session disconnected | /api/xcp/status and whether another action disconnected | Explicitly reconnect; do not assume an active ECU |
| Invalid read address | Simulator memory window starts at 0x1000 with 65,536 bytes | Use known valid fixtures; do not guess arbitrary hardware address |
| ELF upload rejects file | File size (32 MiB), valid ELF magic/object and parser error | Use synthetic fixture and inspect error |
| Flat live chart | Default simulator values are static | A flat trend is correct until memory is intentionally changed |
| Rust CI different than local | CI formats in ephemeral runner | Run local cargo fmt --all -- --check and cargo test |
| Frontend dependency inconsistency | npm ci and committed package-lock.json match package.json | Run npm ci in a clean frontend checkout |

## 5. Incident and bug evidence

Include OS, Git SHA, backend/frontend versions, step sequence, exact endpoint (not sensitive payloads), sanitized error, expected vs observed behavior, CI run and whether test used simulator/PCAN/Vector. Never share ECU firmware dumps, driver credentials or private absolute file paths by default.

For physical hardware, follow [PCAN guide](pcan-basic.md), safe policy in [security-safety](security-safety.md) and a separate controlled bench procedure. Do not enable hardware writes for debugging.

See [agent workflow](agent-workflow.md), [test strategy](test-strategy.md) and [ticket index](tickets/INDEX.md).
