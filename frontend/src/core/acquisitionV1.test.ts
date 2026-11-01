import { afterEach, describe, expect, it, vi } from "vitest";
import sampleFixture from "../../../contracts/v1/acquisition-sample.json";
import gapFixture from "../../../contracts/v1/acquisition-gap.json";
import statusFixture from "../../../contracts/v1/acquisition-status.json";
import errorFixture from "../../../contracts/v1/error-disconnected.json";
import {
  acquisitionApi, acquisitionWsUrl, parseAcquisitionEvent,
  parseAcquisitionStatus,
} from "./acquisitionV1";
import { VersionedApiError } from "./apiV1";

afterEach(() => vi.unstubAllGlobals());

describe("shared acquisition API wire fixtures", () => {
  it("matches both backend sample and overflow fixtures", () => {
    const sample = parseAcquisitionEvent(sampleFixture);
    expect(sample.type).toBe("samples");
    if (sample.type === "samples") {
      expect(sample.samples[0].value).toBe(1850);
      expect(sample.sequence).toBe(1);
      expect(sample.monotonic_elapsed_ms).toBe(20);
    }
    expect(parseAcquisitionEvent(gapFixture)).toMatchObject({ type: "gap", dropped: 11 });
    expect(parseAcquisitionStatus(statusFixture)).toMatchObject({
      acquisition_id: "acq-1", state: "running", interval_ms: 100, subscriber_count: 2,
    });
  });

  it("rejects fabricated, malformed or unsupported stream messages", () => {
    for (const value of [
      null, {}, { ...sampleFixture, schema_version: 2 },
      { ...sampleFixture, sequence: -1 },
      { ...sampleFixture, timestamp_ms: Number.MAX_SAFE_INTEGER + 10 },
      { ...sampleFixture, samples: [{ name: "rpm", address: 4096, value: "1850" }] },
      { ...sampleFixture, samples: [{ name: "rpm", address: 4096, value: Number.NaN }] },
      { ...gapFixture, dropped: 0 },
      { ...gapFixture, type: "unknown" },
    ]) expect(() => parseAcquisitionEvent(value)).toThrow();
  });

  it("rejects inconsistent acquisition signal metadata", () => {
    expect(() => parseAcquisitionStatus({ ...statusFixture, signals: [] })).toThrow();
    expect(() => parseAcquisitionStatus({ ...statusFixture, state: "transient" })).toThrow();
    expect(() => parseAcquisitionStatus({ ...statusFixture, signal_count: 70 })).toThrow();
    expect(() => parseAcquisitionStatus({ ...statusFixture, schema_version: 2 })).toThrow();
  });

  it("uses the backend-owned stream URL with no per-client configuration", () => {
    expect(acquisitionWsUrl("https:", "localhost:5173", "acq-1"))
      .toBe("wss://localhost:5173/api/v1/acquisitions/acq-1/stream");
    expect(acquisitionWsUrl("http:", "127.0.0.1:8080", "acq/2"))
      .toBe("ws://127.0.0.1:8080/api/v1/acquisitions/acq%2F2/stream");
  });

  it("starts one backend acquisition and validates its result", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => statusFixture });
    vi.stubGlobal("fetch", fetchMock);
    expect((await acquisitionApi.create(100, statusFixture.signals as Array<{
      name: string; address: number; value_type: "u32" | "f32";
    }>)).acquisition_id).toBe("acq-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/acquisitions", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ interval_ms: 100, signals: statusFixture.signals }),
    }));
  });

  it("does not send malformed acquisition configuration", () => {
    expect(() => acquisitionApi.create(1, statusFixture.signals as never)).toThrow();
    expect(() => acquisitionApi.create(100, [])).toThrow();
    expect(() => acquisitionApi.create(100, [
      { name: "rpm", address: 4096, value_type: "u32" },
      { name: "rpm", address: 4100, value_type: "f32" },
    ])).toThrow();
  });

  it("returns typed 409 disconnected errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 409, json: async () => errorFixture,
    }));
    await expect(acquisitionApi.current()).rejects.toBeInstanceOf(VersionedApiError);
    try {
      await acquisitionApi.current();
    } catch (error) {
      expect(error).toMatchObject({ status: 409, code: "XCP_SESSION_DISCONNECTED" });
    }
  });
});
