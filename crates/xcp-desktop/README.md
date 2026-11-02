# Native eframe/egui measurement lab (experimental)

This crate is an **isolated read-only prototype**, not a React replacement.
It uses eframe 0.36.2, egui_plot 0.37.0 and egui_dock 0.21.1. The two
chart lanes are visible simultaneously and can be moved/resized/undocked.
There are signal legends, wheel zoom, drag pan, click-to-place A/B cursors,
cursor deltas, explicit gaps and live/STALE/ERROR status.

## Run on Windows (interactive desktop)

From repository root:

~~~powershell
cargo run -p xcp-desktop
cargo test -p xcp-desktop
cargo run --release -p xcp-desktop -- --benchmark
pwsh -File crates/xcp-desktop/scripts/windows-benchmark.ps1
~~~

The --benchmark option runs **80 append/drop updates** for each 2,000 and
20,000 synthetic frames, saves xcp-native-benchmark-2000.json and
xcp-native-benchmark-20000.json in the process working directory, and
does not use XCP. The PowerShell script builds a release binary, runs tests,
captures an actual Windows desktop screenshot (only when an interactive
window exists), and saves OS/CPU metadata and reports under artifacts/native-gui/.
Repeat trials on the same physical Windows host, resolution, scale, refresh
rate, power plan and foreground focus. Run 3+ times for variability.

## Exact fixture match to React/uPlot PR #53

- Two series: Fixture RPM, Fixture °C (addresses 4096, 4100).
- Base timestamp: 1761980000000 + i milliseconds; sequence i.
- RPM: i % 683 === 0 ? 8000 : 1850.
- Temperature: 88.5 + (i % 17) / 10.
- Each update drops the first frame and appends frame(count + updateIndex).
- Same 15,000 ms viewport and 1,400-point plot limit per lane.
- 2k and 20k cases; 80 updates per case; clear SYNTHETIC labeling.

The browser benchmark on PR #53 currently **only implements 20k**.
The 2k React/uPlot counterpart requires separate test-harness coordination
with T-0006's active owner. It is not available for valid comparison yet.
Run the 20k React benchmark from PR #53 (or its merged descendant) using:

~~~powershell
node frontend/src/features/measurements/live-view.bench.mjs
~~~

The browser benchmark requires Node 22, Edge/Chromium and its feature-branch
test files. PR #54 proposes the Windows execution. No React files are changed
by this native prototype.

## What is actually measured

| Metric | Meaning | Limits |
| --- | --- | --- |
| cpuUiUpdateMs p50/p95/p99 | Instant timing around native App::ui | GPU submit/present is not included |
| previousFrameCpuIncludingRenderingMs p50/p95/p99 | eframe's previous-frame CPU usage including rendering | No GPU present or vsync wait; previous-frame lag |
| frameIntervalMs p50/p95/p99 | Time between native UI callback starts | Not physical display scanout |
| observedFramePacingFps | Reciprocal mean frame interval | Not ECU sampling frequency |
| completedUpdatesHz | Completed replacement cycles per second | Not DAQ throughput |
| clickToNextUpdateProxyMs | Click in native UI to next callback, if probed | Not OS input-to-photon latency |
| processResidentBytesAfterRun | Process resident bytes from Windows OS snapshot | Not VRAM or peak usage |

The browser benchmark reports React commit time, update-to-second-rAF,
animation-frame count and **JavaScript heap**, which are different measurement
boundaries from native callback CPU and **process RSS**. Those fields must
never be compared as if equivalent. Windows actual GPU render time and UI
input latency still require an appropriate present/ETW/input profiler.
Do not manufacture those metrics or screenshots if tooling is unavailable.

## Existing backend integration (optional, read-only)

Pass --subscribe-acquisition=acq-1 only after the existing xcp-server has
started a backend acquisition. This crate only connects to
ws://127.0.0.1:8080/api/v1/acquisitions/acq-1/stream. It cannot construct
an XCP master, connect/disconnect the ECU, start acquisition, issue
calibration or write ECU memory. All network I/O is on a worker thread.
Frames are passed to a bounded 256-message queue; the UI processes at most
128 events per repaint. Wire frames are bounded to 64 KiB. Gaps, invalid
quality, disconnected or stale views are represented without fabrication.
The live viewer displays at most two raw signal values and does not claim
physical conversion or ECU-synchronized timestamps. The real server is
still the single session and acquisition owner.

## Merge recommendation

Do **not** migrate based on this spike. First obtain real Windows process
screenshots, passing CI, stable read-only integration, 2k/20k matching runs,
repeat p50/p95/p99/FPS/memory comparisons with **equivalent instrumentation**,
and observed interaction benefits. Keep the React frontend unchanged. Rollback
is deleting crates/xcp-desktop and removing it from workspace members.
