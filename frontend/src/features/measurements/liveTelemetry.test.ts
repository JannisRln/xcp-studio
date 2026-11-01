import { describe, expect, it } from "vitest";
import {
  freshnessLimitMs, liveIndicator, measuredReceiveHz, recentReceiveTimes,
  reconnectDelayMs, sampleAgeMs, skippedSequences,
} from "./liveTelemetry";

describe("live view freshness and delivery statistics", () => {
  it("uses the browser monotonic clock, not ECU/host wall time", () => {
    expect(sampleAgeMs(2200, 2000)).toBe(200);
    expect(sampleAgeMs(1950, 2000)).toBe(0);
    expect(sampleAgeMs(100, null)).toBeNull();
    expect(freshnessLimitMs(100)).toBe(1500);
    expect(freshnessLimitMs(10000)).toBe(30000);
  });

  it("never labels a disconnected, stalled or awaiting stream as LIVE", () => {
    expect(liveIndicator(false, "streaming", true, 50, 100)).toBe("disconnected");
    expect(liveIndicator(true, "connecting", true, null, 100)).toBe("connecting");
    expect(liveIndicator(true, "streaming", true, null, 100)).toBe("waiting");
    expect(liveIndicator(true, "streaming", true, 200, 100)).toBe("live");
    expect(liveIndicator(true, "streaming", true, 2500, 100)).toBe("stale");
    expect(liveIndicator(true, "error", true, 50, 100)).toBe("error");
    expect(liveIndicator(true, "idle", false, 50, 100)).toBe("disconnected");
  });

  it("correctly distinguishes sequence gaps from duplicate/out-of-order batches", () => {
    expect(skippedSequences(null, 100)).toBe(0);
    expect(skippedSequences(100, 101)).toBe(0);
    expect(skippedSequences(100, 105)).toBe(4);
    expect(skippedSequences(100, 100)).toBe(0);
    expect(skippedSequences(100, 99)).toBe(0);
  });

  it("calculates browser reception rate using bounded recent observations", () => {
    let times: number[] = [];
    for (let i = 0; i < 1000; i++) times = recentReceiveTimes(times, i * 100);
    expect(times.length).toBeLessThanOrEqual(52);
    expect(measuredReceiveHz(times)).toBe(10);
    expect(measuredReceiveHz([])).toBe(0);
    times = recentReceiveTimes(times, 110000);
    expect(times).toEqual([110000]);
  });

  it("backs off reconnect attempts and caps delay without duplicating acquisitions", () => {
    expect([0, 1, 2, 3, 4, 5, 15].map(reconnectDelayMs))
      .toEqual([500, 1000, 2000, 4000, 8000, 10000, 10000]);
  });
});
