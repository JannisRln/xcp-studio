import { describe, expect, it } from "vitest";
import { sampleQuality } from "./quality";

describe("measurement read quality and browser freshness", () => {
  const live = { name: "RPM", address: 4096, value: 1850, quality: "valid" as const,
    address_origin: "manual" as const };
  it("does not conflate finite data with backend-asserted valid reads", () => {
    expect(sampleQuality(true, "streaming", "live", live)).toBe("VALID READ");
    expect(sampleQuality(true, "streaming", "live", { ...live, quality: undefined }))
      .toBe("UNVERIFIED");
    expect(sampleQuality(true, "streaming", "live", undefined)).toBe("MISSING");
    expect(sampleQuality(true, "streaming", "live", { ...live, value: NaN }))
      .toBe("MISSING");
  });
  it("prioritizes transport interruption, freshness and disconnect over last value", () => {
    expect(sampleQuality(false, "streaming", "live", live)).toBe("DISCONNECTED");
    expect(sampleQuality(true, "error", "error", live)).toBe("INTERRUPTED");
    expect(sampleQuality(true, "streaming", "stale", live)).toBe("STALE");
    expect(sampleQuality(true, "connecting", "connecting", live)).toBe("STALE");
  });
});
