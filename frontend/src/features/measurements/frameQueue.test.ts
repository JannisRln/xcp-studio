import { describe, expect, it } from "vitest";
import { PreviewFrameQueue } from "./frameQueue";

describe("bounded WebSocket-to-React preview ring", () => {
  it("keeps only the latest 2000 frames under a 10000-event burst", () => {
    const queue = new PreviewFrameQueue(2000);
    for (let i = 0; i < 10000; i++)
      queue.push({ timestamp_ms: i, sequence: i, samples: [] });
    expect(queue.length).toBe(2000);
    const batch = queue.drain();
    expect(batch).toHaveLength(2000);
    expect(batch[0].sequence).toBe(8000);
    expect(batch[1999].sequence).toBe(9999);
    expect(queue.length).toBe(0);
  });

  it("reuses the queue after drain and reset without retaining stale frames", () => {
    const queue = new PreviewFrameQueue(2);
    queue.push({ timestamp_ms: 1, samples: [] });
    expect(queue.drain().map(frame => frame.timestamp_ms)).toEqual([1]);
    queue.push({ timestamp_ms: 2, samples: [] });
    queue.push({ timestamp_ms: 3, samples: [] });
    queue.push({ timestamp_ms: 4, samples: [] });
    expect(queue.drain().map(frame => frame.timestamp_ms)).toEqual([3, 4]);
    queue.push({ timestamp_ms: 5, samples: [] });
    queue.clear();
    expect(queue.drain()).toEqual([]);
  });

  it("rejects invalid capacities", () => {
    expect(() => new PreviewFrameQueue(0)).toThrow();
    expect(() => new PreviewFrameQueue(NaN)).toThrow();
  });
});
