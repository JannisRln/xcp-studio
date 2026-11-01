import { describe, expect, it } from "vitest";
import { streamEndpoint, validateFrame } from "./useAcquisition";

describe("acquisition protocol", () => {
  it("builds secure and insecure WebSocket URLs", () => {
    expect(streamEndpoint("https:", "ecu.local")).toBe("wss://ecu.local/api/xcp/stream");
    expect(streamEndpoint("http:", "localhost:5173")).toBe("ws://localhost:5173/api/xcp/stream");
  });
  it("validates actual measurement frames", () => {
    expect(validateFrame({ timestamp_ms: 123, samples: [{ name: "rpm", address: 4096, value: 1850 }] }))
      .toMatchObject({ timestamp_ms: 123 });
  });
  it("rejects invalid, malformed and server error messages", () => {
    for (const payload of [null, {}, { timestamp_ms: "now", samples: [] },
      { timestamp_ms: 1, samples: [{ name: "rpm", address: 4096, value: "1850" }] },
      { error: "XCP session not connected" }]) expect(() => validateFrame(payload)).toThrow();
  });
});
