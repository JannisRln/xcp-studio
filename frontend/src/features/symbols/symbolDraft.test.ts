import { describe, expect, it } from "vitest";
import type { ElfResult, ElfSymbol, SignalDefinition } from "../../core/api";
import { importErrorMessage, MAX_ELF_BYTES, validateInspection, validateManualSignal } from "./symbolDraft";

const data: ElfSymbol = {
  name: "engine_speed", address: 0x1000, address_hex: "0x1000", size: 4, kind: "data",
};
const result = (symbols: ElfSymbol[]): ElfResult => ({ count: symbols.length, symbols });
const existing: SignalDefinition[] = [{
  id: "engine-speed", name: "Engine speed", address: 0x1000, value_type: "u32", unit: "rpm", color: "#fff",
}];

describe("ELF import response validation", () => {
  it("accepts empty and large symbol lists without inventing type or runtime mapping", () => {
    expect(validateInspection(result([]))).toEqual([]);
    const source = Array.from({ length: 10000 }, (_, i) => ({ ...data, name: `value_${i}` }));
    expect(validateInspection(result(source))).toHaveLength(10000);
    expect(source[0]).not.toHaveProperty("value_type");
    expect(source[0]).not.toHaveProperty("runtime_address");
  });

  it("rejects inconsistent, malformed, or unbounded metadata", () => {
    expect(() => validateInspection({ ...result([data]), count: 2 })).toThrow(/count/);
    expect(() => validateInspection(result([{ ...data, address_hex: "invalid" }]))).toThrow(/malformed/);
    expect(() => validateInspection(result([{ ...data, size: -1 }]))).toThrow(/malformed/);
    expect(() => validateInspection(result([{ ...data, address: Number.POSITIVE_INFINITY }]))).toThrow(/malformed/);
    expect(() => validateInspection({ count: 250001, symbols: [] })).toThrow(/count/);
  });

  it("returns actionable messages for HTTP, timeout, and unreachable backend", () => {
    expect(importErrorMessage(Object.assign(new Error("invalid file"), { status: 422 }))).toMatch(/invalid file/);
    expect(importErrorMessage(Object.assign(new Error("too large"), { status: 413 }))).toMatch(/32 MiB/);
    expect(importErrorMessage(Object.assign(new Error("timeout"), { name: "TimeoutError" }))).toMatch(/timed out/);
    expect(importErrorMessage(new TypeError("fetch failed"))).toMatch(/Cannot reach/);
    expect(MAX_ELF_BYTES).toBe(33554432);
  });
});

describe("explicit typed manual signal validation", () => {
  it("requires operator-supplied runtime location and explicit type", () => {
    expect(() => validateManualSignal("speed", "", "u32", [], data)).toThrow(/address/i);
    expect(() => validateManualSignal("speed", "0x1000", "", [], data)).toThrow(/type/);
    expect(() => validateManualSignal("", "0x1000", "u32", [], null)).toThrow(/name/);
    expect(validateManualSignal(" speed ", "0x1000", "u32", [], data))
      .toEqual({ name: "speed", address: 4096, type: "u32" });
  });

  it("rejects address/width overflow and symbols narrower than selected value type", () => {
    expect(() => validateManualSignal("value", "0xffffffff", "f64", [], null)).toThrow(/beyond/);
    expect(() => validateManualSignal("value", "4294967296", "u8", [], null)).toThrow(/32-bit/);
    expect(() => validateManualSignal("value", "0x1000", "f64", [], data)).toThrow(/extent/);
    expect(validateManualSignal("value", "0xfffffffc", "u32", [], null).address).toBe(0xfffffffc);
    expect(validateManualSignal("value", "0xffffffff", "i8", [], null).type).toBe("i8");
  });

  it("rejects duplicates, oversized names, and unsupported type values", () => {
    expect(() => validateManualSignal("Engine speed", "0x1000", "u32", existing, null)).toThrow(/already/);
    expect(() => validateManualSignal("ß".repeat(70), "0x1000", "u8", [], null)).toThrow(/128 UTF-8/);
    expect(() => validateManualSignal("speed", "0x1000", "int64" as "u32", [], null)).toThrow(/type/);
  });

  it("does not infer validity from the staged ELF link address", () => {
    const staged = { ...data, address_hex: "0x1000" };
    const supplied = validateManualSignal("engine_speed", "0x2000", "f32", [], staged);
    expect(supplied.address).toBe(0x2000);
    expect(supplied.type).toBe("f32");
  });
});
