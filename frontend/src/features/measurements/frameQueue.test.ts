import { describe, expect, it } from "vitest";
import type { MeasurementFrame } from "../../core/api";
import { enqueuePreviewFrame } from "./frameQueue";

describe("bounded pending live preview queue", () => {
  it("retains the latest frames during a stalled browser render", () => {
    const queue: MeasurementFrame[] = [];
    for (let i = 0; i < 10000; i++)
      enqueuePreviewFrame(queue, { timestamp_ms: i, sequence: i, samples: [] }, 2000);
    expect(queue).toHaveLength(2000);
    expect(queue[0].sequence).toBe(8000);
    expect(queue[1999].sequence).toBe(9999);
  });

  it("rejects invalid capacities rather than silently growing forever", () => {
    const queue: MeasurementFrame[] = [];
    const frame = { timestamp_ms: 1, samples: [] };
    expect(() => enqueuePreviewFrame(queue, frame, 0)).toThrow();
    expect(() => enqueuePreviewFrame(queue, frame, NaN)).toThrow();
    expect(queue).toHaveLength(0);
  });
});
