import { describe, expect, it, vi, afterEach } from "vitest";
import healthFixture from "../../../contracts/v1/health.json";
import sessionFixture from "../../../contracts/v1/session.json";
import readFixture from "../../../contracts/v1/read.json";
import errorFixture from "../../../contracts/v1/error-disconnected.json";
import validationFixture from "../../../contracts/v1/error-validation.json";
import {
  apiV1, parseHealthV1, parseReadV1, parseSessionV1, parseErrorV1,
  VersionedApiError,
} from "./apiV1";

afterEach(() => vi.unstubAllGlobals());

describe("shared REST v1 fixtures", () => {
  it("parses the same health, session, read and error schema as Rust", () => {
    expect(parseHealthV1(healthFixture).mode).toBe("simulation");
    expect(parseSessionV1(sessionFixture).connected).toBe(true);
    expect(parseReadV1(readFixture).bytes).toEqual([58, 7, 0, 0]);
    expect(parseErrorV1(errorFixture).error.code).toBe("XCP_SESSION_DISCONNECTED");
    expect(parseErrorV1(validationFixture).error.details?.field).toBe("interval_ms");
  });

  it("rejects malformed, unknown-version and precision-loss values", () => {
    expect(() => parseHealthV1({ ...healthFixture, schema_version: 2 })).toThrow();
    expect(() => parseSessionV1({ ...sessionFixture, connected: "true" })).toThrow();
    expect(() => parseReadV1({ ...readFixture, address: 4294967296 })).toThrow();
    expect(() => parseReadV1({ ...readFixture, bytes: [256] })).toThrow();
    expect(() => parseReadV1({ ...readFixture, bytes: [58, 7, 0, 0], hex: "00" })).toThrow();
    expect(() => parseErrorV1({ schema_version: 1, error: { code: "ERR" } })).toThrow();
    expect(() => parseErrorV1({ ...validationFixture, error: { ...validationFixture.error, details: [] } })).toThrow();
    expect(() => parseErrorV1({ ...validationFixture, error: { ...validationFixture.error, code: "unknown-enum" } })).toThrow();
  });

  it("validates input before sending a read", () => {
    for (const params of [[-1, 1], [4096, 0], [4096, 4097], [0xffffffff, 2], [NaN, 2]]) {
      expect(() => apiV1.read(params[0], params[1])).toThrow();
    }
  });

  it("uses versioned URL and typed error information", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 409, json: async () => errorFixture,
    }));
    try {
      await apiV1.read(4096, 4);
      throw new Error("Expected read to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(VersionedApiError);
      expect(error).toMatchObject({ code: "XCP_SESSION_DISCONNECTED", status: 409 });
    }
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/sessions/current/reads",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("decodes valid read responses from the versioned route", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => readFixture,
    }));
    expect((await apiV1.read(4096, 4)).hex).toBe("3A 07 00 00");
  });
});
