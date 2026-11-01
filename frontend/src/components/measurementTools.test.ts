import { describe, expect, it } from "vitest";
import { cursorFrequencyHz, frameTimeDomain, panViewport, zoomViewport } from "./measurementTools";

describe("uPlot interactive time windows", () => {
  const domain = { earliest: 0, latest: 10000 };
  const viewport = { start: 6000, end: 10000 };

  it("uses finite source timestamps for the display domain", () => {
    expect(frameTimeDomain([{ timestamp_ms: 300, samples: [] },
      { timestamp_ms: 100, samples: [] }, { timestamp_ms: NaN, samples: [] }]))
      .toEqual({ earliest: 100, latest: 300 });
    expect(frameTimeDomain([{ timestamp_ms: NaN, samples: [] }])).toBeNull();
    expect(frameTimeDomain([])).toBeNull();
  });

  it("preserves the hovered time when zooming and clamps extreme wheel inputs", () => {
    const next = zoomViewport(domain, viewport, 0.5, 7000);
    expect(next.rangeMs).toBe(2000);
    const start = domain.latest - next.panMs - next.rangeMs;
    expect(start).toBe(6500);
    expect(start + next.rangeMs * 0.25).toBe(7000);
    expect(zoomViewport(domain, { start: 0, end: 10000 }, 100, 5000).rangeMs).toBe(10000);
    expect(zoomViewport(domain, { start: 0, end: 10000 }, 0.0001, 5000).rangeMs).toBe(20);
    expect(zoomViewport(domain, viewport, NaN, 7000)).toEqual({ rangeMs: 0, panMs: 0 });
  });

  it("keeps shift-drag pan within captured history", () => {
    expect(panViewport(domain, viewport, 1200)).toEqual({ rangeMs: 4000, panMs: 1200 });
    expect(panViewport(domain, viewport, 100000)).toEqual({ rangeMs: 4000, panMs: 6000 });
    expect(panViewport(domain, viewport, -5000)).toEqual({ rangeMs: 4000, panMs: 0 });
  });

  it("reports a finite cursor reciprocal regardless of cursor order", () => {
    expect(cursorFrequencyHz(1000, 1250)).toBe(4);
    expect(cursorFrequencyHz(1250, 1000)).toBe(4);
    expect(cursorFrequencyHz(1000, 1000)).toBeNull();
    expect(cursorFrequencyHz(null, 1250)).toBeNull();
  });
});
