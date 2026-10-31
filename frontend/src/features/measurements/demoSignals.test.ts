import { describe, expect, it } from "vitest";
import { sample, signals } from "./demoSignals";

describe("demo signal model", () => {
  it("defines unique signal names", () => {
    expect(new Set(signals.map(signal => signal.name)).size).toBe(signals.length);
  });

  it("generates finite deterministic demo samples", () => {
    for (const signal of signals) {
      expect(Number.isFinite(sample(signal, 0))).toBe(true);
      expect(sample(signal, 42)).toBe(sample(signal, 42));
    }
  });
});
