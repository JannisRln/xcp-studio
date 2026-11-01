import { describe, expect, it } from "vitest";
import type { MeasurementFrame, SignalDefinition } from "../core/api";
import { LiveRingBuffer } from "./liveRingBuffer";

const rpm: SignalDefinition = {
  id: "rpm", name: "RPM", address: 4096, value_type: "u32", unit: "rpm", color: "#fff",
};
const temperature: SignalDefinition = {
  id: "temp", name: "Coolant", address: 4100, value_type: "f32", unit: "°C", color: "#0ff",
};
const frame = (time: number, value: number): MeasurementFrame => ({
  timestamp_ms: time + 10000,
  monotonic_elapsed_ms: time,
  samples: [
    { name: "RPM", address: 4096, value },
    { name: "Coolant", address: 4100, value: 88.5 },
  ],
});

describe("typed-array live scope storage", () => {
  it("wraps without unbounded growth and preserves time order", () => {
    const buffer = new LiveRingBuffer(4);
    for (let i = 0; i < 20; i++) expect(buffer.append(frame(i, i), [rpm])).toBe(true);
    expect(buffer.length).toBe(4);
    expect(buffer.oldest).toBe(16);
    expect(buffer.newest).toBe(19);
    expect(buffer.at(0, LiveRingBuffer.key(rpm))).toEqual({ t: 16, y: 16 });
    expect(buffer.at(3, LiveRingBuffer.key(rpm))).toEqual({ t: 19, y: 19 });
    expect(buffer.lowerBound(18)).toBe(2);
    expect(buffer.nearest(18.8)).toBe(3);
  });

  it("rejects duplicates/out-of-order timestamps", () => {
    const buffer = new LiveRingBuffer(8);
    expect(buffer.append(frame(10, 1), [rpm])).toBe(true);
    expect(buffer.append(frame(10, 2), [rpm])).toBe(false);
    expect(buffer.append(frame(9, 2), [rpm])).toBe(false);
    expect(buffer.length).toBe(1);
  });

  it("preserves a narrow spike during pixel-bucket downsampling", () => {
    const buffer = new LiveRingBuffer(10000);
    for (let i = 0; i < 10000; i++)
      buffer.append(frame(i, i === 5003 ? 999999 : 12), [rpm]);
    const points = buffer.extrema(LiveRingBuffer.key(rpm), 0, 9999, 60);
    expect(points.length).toBeLessThanOrEqual(120);
    expect(points.some(point => point.y === 999999)).toBe(true);
    expect(points.every((point, i) => i === 0 || point.t >= points[i - 1].t)).toBe(true);
  });

  it("separates units, handles missing samples and resets all buffers", () => {
    const buffer = new LiveRingBuffer(4);
    buffer.append(frame(0, 100), [rpm, temperature]);
    buffer.append({ timestamp_ms: 10001, monotonic_elapsed_ms: 1, samples: [] },
      [rpm, temperature]);
    expect(Number.isNaN(buffer.at(1, LiveRingBuffer.key(rpm))?.y)).toBe(true);
    expect(buffer.extent([LiveRingBuffer.key(temperature)], 0, 1)).toEqual({
      low: 87.5, high: 89.5,
    });
    buffer.reset();
    expect(buffer.length).toBe(0);
    expect(buffer.signalIds).toEqual([]);
  });

  it("validates capacity and bounds", () => {
    expect(() => new LiveRingBuffer(1)).toThrow();
    const buffer = new LiveRingBuffer(4);
    expect(buffer.at(0, LiveRingBuffer.key(rpm))).toBeNull();
    expect(buffer.extrema(LiveRingBuffer.key(rpm), 0, 1, 100)).toEqual([]);
  });
});
