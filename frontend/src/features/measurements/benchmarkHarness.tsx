import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { TimeSeriesChart } from "../../components/TimeSeriesChart";
import type { MeasurementFrame, SignalDefinition } from "../../core/api";
import "../../dashboard.css";
import "uplot/dist/uPlot.min.css";

const signals: SignalDefinition[] = [
  { id:"a", name:"Fixture RPM", address:4096, value_type:"u32",unit:"rpm",color:"#70ecbd" },
  { id:"b", name:"Fixture °C", address:4100, value_type:"f32",unit:"°C",color:"#f7c67e" },
];
const origin = 1761980000000;
const count = 20000;
const frame = (i: number): MeasurementFrame => ({
  timestamp_ms: origin + i,
  sequence: i,
  samples: [
    {name:"Fixture RPM", address:4096, value:i % 683 === 0 ? 8000 : 1850},
    {name:"Fixture °C", address:4100, value:88.5 + (i % 17) / 10},
  ],
});
let frames = Array.from({length:count}, (_, i) => frame(i));
const root = createRoot(document.getElementById("benchmark-root")!);

function render() {
  root.render(<TimeSeriesChart title="20,000-frame synthetic Canvas benchmark"
    frames={frames} signals={signals} />);
}
function percentiles(values: number[]) {
  const sorted = [...values].sort((a,b) => a-b);
  const at = (p: number) => sorted[Math.min(sorted.length-1,
    Math.floor((sorted.length-1) * p))] ?? null;
  return {p50:at(0.50),p95:at(0.95),p99:at(0.99),max:sorted.at(-1) ?? null};
}
const afterPaint = () => new Promise<void>(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** This measures real browser work, not ECU acquisition or backend sampling. */
async function run(iterations = 80) {
  const latency: number[] = [];
  const synchronous: number[] = [];
  let rafCount = 0;
  let monitoring = true;
  const monitor = () => {
    if (!monitoring) return;
    rafCount++;
    requestAnimationFrame(monitor);
  };
  requestAnimationFrame(monitor);
  const begin = performance.now();
  for (let index = 0; index < iterations; index++) {
    const start = performance.now();
    frames = [...frames.slice(1), frame(count + index)];
    flushSync(render);
    synchronous.push(performance.now() - start);
    await afterPaint();
    latency.push(performance.now() - start);
  }
  const durationMs = performance.now() - begin;
  monitoring = false;
  return {
    fixture:"synthetic browser-only, NOT XCP throughput",
    samplesPerUpdate:count, series:signals.length,
    updates:iterations, windowMs:15000, drawPointLimitPerLane:1400,
    durationMs, observedAnimationFps:rafCount * 1000 / durationMs,
    completedUpdatesHz:iterations * 1000 / durationMs,
    reactSynchronousCommitMs:percentiles(synchronous),
    updateToSecondAnimationFrameMs:percentiles(latency),
    canvasCount:document.querySelectorAll(".timeseries canvas").length,
  };
}
render();
(window as unknown as { xcpBenchmark: { run: typeof run } }).xcpBenchmark = {run};
