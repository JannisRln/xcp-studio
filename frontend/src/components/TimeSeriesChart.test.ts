import { describe, expect, it } from "vitest";
import { chartPoints } from "./TimeSeriesChart";
import type { MeasurementFrame, SignalDefinition } from "../core/api";

const signal: SignalDefinition = { id: "rpm", name: "rpm", address: 4096, value_type: "u32", unit: "rpm", color: "blue" };
describe("time-series data selection", () => {
  it("keeps frame timestamps and matches name plus address", () => {
    const frames: MeasurementFrame[] = [
      { timestamp_ms: 1, samples: [{ name: "rpm", address: 4096, value: 1200 }] },
      { timestamp_ms: 2, samples: [{ name: "rpm", address: 4100, value: 9000 }] },
      { timestamp_ms: 3, samples: [{ name: "rpm", address: 4096, value: 1300 }] },
    ];
    expect(chartPoints(frames, signal)).toEqual([{ t: 1, y: 1200 }, { t: 3, y: 1300 }]);
  });
});
