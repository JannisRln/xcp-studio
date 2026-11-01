import { describe, expect, it } from "vitest";
import { acquisitionCsv, measurementCsv } from "./export";
import type { MeasurementFrame, SignalDefinition } from "./api";

const signals: SignalDefinition[] = [
  { id: "a", name: 'Engine "speed"', address: 4096, value_type: "u32", unit: "rpm", color: "blue" },
  { id: "b", name: "Coolant, temp", address: 4100, value_type: "f32", unit: "°C", color: "orange" },
];
describe("measurement CSV", () => {
  it("exports real frames with timestamps and proper CSV escaping", () => {
    const frames: MeasurementFrame[] = [{
      timestamp_ms: 1700000000000,
      samples: [{ name: 'Engine "speed"', address: 4096, value: 1850 },
        { name: "Coolant, temp", address: 4100, value: 88.5 }],
    }];
    expect(measurementCsv(frames, signals)).toBe(
      'timestamp_ms,"Engine ""speed""","Coolant, temp"\r\n1700000000000,1850,88.5\r\n',
    );
  });
  it("leaves missing samples blank instead of fabricating values", () => {
    expect(measurementCsv([{ timestamp_ms: 1, samples: [] }], signals))
      .toContain("\r\n1,,\r\n");
  });
  it("preserves acquisition sequence, timebase, dropped events and proper quoting", () => {
    const frames: MeasurementFrame[] = [{
      acquisition_id: "acq-1", sequence: 42,
      timestamp_ms: 1761980000000, monotonic_elapsed_ms: 400,
      dropped_since_previous: 3,
      samples: [{ name: 'Engine "speed"', address: 4096, value: 1850 }],
    }];
    expect(acquisitionCsv(frames, signals)).toBe(
      'acquisition_id,sequence,timestamp_ms,monotonic_elapsed_ms,dropped_since_previous,"Engine ""speed""","Coolant, temp"\r\n' +
      'acq-1,42,1761980000000,400,3,1850,\r\n',
    );
  });

  it("exports headers for an empty buffer", () => {
    expect(measurementCsv([], signals).split("\r\n")).toHaveLength(2);
  });
});
