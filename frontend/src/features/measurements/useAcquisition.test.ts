import { describe, expect, it } from "vitest";
import { appendFrame, eventFrame, MAX_BUFFER } from "./useAcquisition";
import type { MeasurementFrame } from "../../core/api";
import { parseAcquisitionEvent } from "../../core/acquisitionV1";
import eventFixture from "../../../../contracts/v1/acquisition-sample.json";

describe("shared acquisition buffer and timebase", () => {
  it("maps a real backend sample event without fabricating values", () => {
    const event = parseAcquisitionEvent(eventFixture);
    expect(event.type).toBe("samples");
    if (event.type !== "samples") return;
    expect(eventFrame(event)).toEqual({
      timestamp_ms: 1761980000000,
      acquisition_id: "acq-1",
      sequence: 1,
      monotonic_elapsed_ms: 20,
      dropped_since_previous: 0,
      samples: [
        { name: "Engine speed", address: 4096, value: 1850 },
        { name: "Coolant", address: 4100, value: 88.5 },
      ],
    });
  });

  it("bounds the visualization buffer even after thousands of frames", () => {
    let frames: MeasurementFrame[] = [];
    for (let t = 0; t < MAX_BUFFER + 150; t++)
      frames = appendFrame(frames, { timestamp_ms: t, samples: [] });
    expect(frames).toHaveLength(MAX_BUFFER);
    expect(frames[0].timestamp_ms).toBe(150);
    expect(frames.at(-1)?.timestamp_ms).toBe(MAX_BUFFER + 149);
  });
});
