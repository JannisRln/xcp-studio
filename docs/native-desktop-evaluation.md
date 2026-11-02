# Native egui desktop evaluation — Windows evidence and architecture gate

**Status:** Experimental, PR [#55](https://github.com/JannisRln/xcp-studio/pull/55)
remains **Draft**. T-0006's active owner and ticket are not modified. Existing
React application, versioned API DTOs, XCP SessionActor/acquisition services and
hardware safety policy have no code changes in this experiment.

## Test system and provenance

The first **actual native Windows process and screenshot** were produced by
[Windows workflow 41341982148](https://github.com/JannisRln/xcp-studio/actions/runs/41341982148)
on experimental commit \`f3ea48e668128df3dece289df92f9a800e0a1eff\`. See the uploaded
\`xcp-native-desktop-windows\` artifact: \`native-workspace-windows.png\`,
\`windows-environment.json\`, \`xcp-native-benchmark-2000.json\`,
\`xcp-native-benchmark-20000.json\`, \`react-uplot-2000.json\`.

- System: Microsoft Windows Server 2025 Datacenter, 10.0.26100.
- CPU: Intel Xeon Platinum 8370C @ 2.80 GHz, four assigned logical processors.
- Display: 1024 × 768 reported Windows desktop.
- Browser comparison: Edge on Windows, Node v22.23.4.
- Mode: **Release** native UI with two synthetic channels; **no ECU hardware**.
- Dataset: \`timestamp_ms = 1761980000000 + i\`, sequence \`i\`,
  RPM \`i % 683 == 0 ? 8000 : 1850\`, temperature
  \`88.5 + (i % 17) / 10\`. Drop one first frame and append a new
  sample per update, 80 updates, 15,000ms viewport, 1,400 points per lane.
- The exported PNG was copied from the **actual Windows desktop** with the
  native GUI running. It is not a mockup. It demonstrates initial layout and
  window launch, not validated interactive use of each control.

## Observed numbers (single trial, no invented averages)

| Measurement | Native 2k | Native 20k | React/uPlot 2k, same Windows runner |
| --- | ---: | ---: | ---: |
| Input frames per update | 2,000 | 20,000 | 2,000 |
| Channels | 2 | 2 | 2 |
| Completed update cycles/sec | 27.13 | 16.06 | 25.43 |
| Callback / animation pacing FPS | 26.96 | 15.95 | 50.85 |
| Native frame interval p50/p95/p99 (ms) | 32.20 / 62.31 / 64.04 | 63.59 / 78.39 / 80.36 | **not measured on same boundary** |
| Native App::ui CPU p50/p95/p99 (ms) | 1.05 / 17.98 / 18.94 | 1.93 / 24.92 / 26.28 | **not measured** |
| Native prior-frame CPU incl. rendering p50/p95/p99 (ms) | 5.84 / 20.36 / 25.47 | 3.84 / 26.09 / 27.37 | **not measured** |
| React synchronous commit p50/p95/p99 (ms) | **not measured** | **not measured** | 25.6 / 41.7 / 48.2 |
| React update-to-second-rAF p50/p95/p99 (ms) | **not measured** | **not measured** | 33.7 / 63.4 / 67.3 |
| Native process RSS after run (bytes) | 75,280,384 | 75,644,928 | **not comparable to JS heap** |
| React JS heap delta (bytes) | **not measured** | **not measured** | 25,958,124 |

Native overall process CPU: **19.47 CPU-seconds over 8.77 wall-seconds**,
or **55.48% of the four assigned logical CPUs** across both trials.
Observed peak process working set: **76,972,032 bytes**, 131 RSS samples.
These totals are **not** per-trial CPU utilization or GPU/VRAM usage.

**Same-host React 20k is absent from this first trial**: the disposable
PR #53 browser driver hit its 20-second CDP Runtime.evaluate watchdog.
The 2k React trial succeeded after test-only parameter substitution in a
separate temporary checkout. Earlier [React CI 41340881302](https://github.com/JannisRln/xcp-studio/actions/runs/41340881302)
on a **different AMD EPYC runner** reported React/uPlot 20k update-to-second
rAF p50/p95/p99 232.7/284/342.9ms, 8.43 observed animation FPS,
4.21 updates/sec and 65,830,428 bytes JS heap delta. **Do not compare
that machine directly** to this native Intel-runner screenshot/benchmark.
Later workflows increase only the disposable CDP test-driver timeout and
repeat the comparison without changing tracked React sources.

## Measurement interpretation and constraints

- \`cpuUiUpdateMs\` clocks the native \`App::ui\` callback; it does not include
  GPU present or monitor scanout. \`previousFrameCpuIncludingRenderingMs\`
  is reported by eframe and excludes GPU/display waiting.
- Native \`observedFramePacingFps\` uses callback start intervals.
  React \`observedAnimationFps\` counts browser rAF invocations during the
  benchmark. Both are **proxies**, not hardware-observed presented frames,
  and their definitions differ.
- React update-to-second-rAF includes a different scheduling boundary from
  native CPU callback. Never treat their p95 values as identical render timings.
- Windows process resident memory and browser JavaScript heap are **different
  memory domains**. A fair process RSS comparison needs Edge child processes
  and native process accounting over matching time windows.
- Worker-to-GUI callback latency is an event-loop servicing proxy and is
  not OS input-to-photon latency. It was introduced *after* the first native
  screenshot/benchmark commit; it must not be retroactively reported.
- No GPU present/scanout timestamps, physical XCP hardware, high-frequency
  DAQ source or keyboard/mouse user trial was instrumented.
- Follow-up current-head native screenshot and simulator-to-native read-only
  subscriber validation are separate CI tasks; outcomes must be recorded from
  their actual artifacts, not assumed from script presence.

## Architecture and migration decision

**Do not replace React/uPlot based on this experiment.** An actual native
Windows window and bounded Rust rendering are demonstrated, but at 20k the
observed native callback pacing is approximately 16 FPS, and the same-host
2k browser animation rate exceeds native callback pacing (though the metrics
are not equivalent). The evidence does not establish a universal GPU or
interaction-latency improvement. Native may remain a separate read-only
analysis-view candidate.

Production migration requires repeatable 2k/20k measurements on the
**same machine**, aligned process RSS and input-to-present instrumentation,
actual dock/zoom/cursor usability acceptance, and the backend/session/security
integration owner approval. The backend must remain the sole ECU session and
acquisition owner; no GUI can bypass typed runtime-address or hardware safety
policy. Keep PR #55 Draft, do not merge automatically. Rollback is removal
of the new crate/workflow and its root workspace membership.
