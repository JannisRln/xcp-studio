/**
 * Headless Edge/Chromium 20,000-frame uPlot benchmark using the real component.
 * The input fixture is synthetic; browser frame rate does not equal XCP rate.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { resolve } from "node:path";
import { awaitHttp, frontend, launch, openBrowser, shutdown } from "./browserDriver.mjs";

const url = "http://127.0.0.1:5175/src/features/measurements/benchmark.html";
let browser;
try {
  launch("npm", ["run", "dev", "--", "--host","127.0.0.1",
    "--port","5175","--strictPort"], frontend);
  await awaitHttp(url);
  browser = await openBrowser(url);
  await browser.navigate(url);
  await browser.waitFor("typeof window.xcpBenchmark?.run === 'function'");
  const heap = async () => {
    try { return (await browser.cdp("Runtime.getHeapUsage")).usedSize; }
    catch { return null; }
  };
  const before = await heap();
  // The full 80-update synthetic stress run can legitimately exceed the
  // 20-second interactive CDP limit. Keep this benchmark bounded to 120 seconds.
  const result = await browser.evaluate("window.xcpBenchmark.run(80)", 120_000);
  const after = await heap();
  assert.equal(result.samplesPerUpdate, 20000);
  assert.ok(result.canvasCount >= 2, "Did not render both uPlot Canvas lanes");
  assert.ok(result.updates === 80 && Number.isFinite(result.observedAnimationFps));
  const cpu = cpus()[0];
  const report = {
    measuredAtUtc:new Date().toISOString(),
    environment:{os:platform(),osRelease:release(),cpu:cpu?.model ?? "unknown",
      logicalCpus:cpus().length,totalMemoryBytes:totalmem(),
      node:process.version,browserExecutable:browser.executable},
    ...result,
    javascriptHeapBytes:{before,after,delta:before === null || after === null
      ? null : after - before},
    limitations:"JS heap is not OS RSS; browser frame FPS is not ECU sampling rate. No physical hardware or Rust stream is used.",
  };
  const output = resolve(process.env.XCP_BENCH_OUTPUT ?? "frontend/measurement-benchmark.json");
  writeFileSync(output, JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
  console.log("BENCHMARK RESULT " + output);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await shutdown();
}
