import { describe, expect, it } from "vitest";
import type { MeasurementFrame, SignalDefinition } from "../core/api";
import {
  chartAxis, chartViewport, decimateExtrema, groupSignalsByUnit, nearestChartFrame,
} from "./chartMath";

const frames: MeasurementFrame[] = [
  { timestamp_ms: 0, samples: [] },
  { timestamp_ms: 5000, samples: [] },
  { timestamp_ms: 10000, samples: [] },
];

describe("bounded chart projection", () => {
  it("supports all, zoomed, and earlier windows", () => {
    expect(chartViewport(frames, 0, 0)).toEqual({ start: 0, end: 10000 });
    expect(chartViewport(frames, 5000, 0)).toEqual({ start: 5000, end: 10000 });
    expect(chartViewport(frames, 5000, 5000)).toEqual({ start: 0, end: 5000 });
    expect(chartViewport([], 15000, 0)).toEqual({ start: 0, end: 1 });
  });

  it("keeps exact sharp minimum and maximum under downsampling", () => {
    const points = Array.from({ length: 10001 }, (_, t) => ({
      t, y: t === 4500 ? -1000 : t === 5400 ? 2000 : 100,
    }));
    const decimated = decimateExtrema(points, 450);
    expect(decimated.length).toBeLessThanOrEqual(450);
    expect(decimated[0]).toEqual(points[0]);
    expect(decimated.at(-1)).toEqual(points.at(-1));
    expect(decimated).toContainEqual({ t: 4500, y: -1000 });
    expect(decimated).toContainEqual({ t: 5400, y: 2000 });
    expect(decimated.every((point, i) => i === 0 || point.t >= decimated[i - 1].t)).toBe(true);
  });

  it("never produces a zero or nonfinite Y axis for flat and empty signals", () => {
    expect(chartAxis([])).toEqual({ low: 0, high: 1 });
    const axis = chartAxis([{ t: 1, y: 88.5 }, { t: 2, y: 88.5 }]);
    expect(axis.low).toBeLessThan(88.5);
    expect(axis.high).toBeGreaterThan(88.5);
    expect(() => decimateExtrema([], 3)).toThrow();
  });

  it("uses nearest timestamp even if captured host wall clock changes backward", () => {
    expect(nearestChartFrame(frames, 6000)?.timestamp_ms).toBe(5000);
    expect(nearestChartFrame([], 5000)).toBeNull();
    expect(nearestChartFrame(frames, Number.NaN)).toBeNull();
  });

  it("separates signals by physical unit instead of combining °C with rpm", () => {
    const signals: SignalDefinition[] = [
      { id: "rpm", name: "rpm", address: 4096, value_type: "u32", unit: "rpm", color: "blue" },
      { id: "coolant", name: "coolant", address: 4100, value_type: "f32", unit: "°C", color: "orange" },
      { id: "torque", name: "torque", address: 4104, value_type: "i16", unit: "Nm", color: "red" },
      { id: "raw", name: "raw", address: 4106, value_type: "u8", unit: "", color: "green" },
    ];
    expect(groupSignalsByUnit(signals).map(item => item.unit))
      .toEqual(["rpm", "°C", "Nm", "raw"]);
  });
});
