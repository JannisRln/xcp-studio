# T-0006 measurement-only browser verification

This directory contains test-only browser fixtures. They are not used for acquisition
and are not a product recording path. No frontend-generated fixture is presented
as live XCP data.

After `cargo build -p xcp-server` and `cd frontend && npm ci`, from repository root:

```sh
node frontend/src/features/measurements/live-view.browser-e2e.mjs
node frontend/src/features/measurements/live-view.bench.mjs
```

Browser E2E connects to the **real Rust simulator** via the Vite HTTP/WS proxy,
then exercises live uPlot Canvas, display pause/resume without backend stop,
browser CSV download/metadata comparison, dropped WebSocket/reconnect to the
same acquisition, and A/B cursor readouts. Requires Node.js 22 and Edge/Chromium,
with `XCP_BROWSER` optionally pointing to the browser executable.

The benchmark runs a separately labeled **synthetic 20,000-frame fixture** against
the same uPlot React chart component (not the ECU). It reports the OS, CPU, Node
version, browser, counts, observed frame rate, React/update-to-paint timings and
JavaScript heap (when CDP supports it), writing JSON under
`frontend/measurement-benchmark.json` or to `XCP_BENCH_OUTPUT`. Each result
contains actual observations, not expected performance targets. Run repeated trials
on a specified machine under comparable load; Canvas browser FPS is not CAN/XCP
sampling throughput, and heap bytes are not total process RSS.

The repository's existing CI script is `node scripts/live-view-e2e.mjs`; this
standalone extended browser acceptance script is not automatically invoked by
that job until the CI owner approves an integration. Tests that weren't executed
must not be reported as passed.
