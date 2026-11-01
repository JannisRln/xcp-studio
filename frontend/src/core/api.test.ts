import { describe, expect, it } from "vitest";
import { decodeValue, parseAddress } from "./api";

describe("XCP address validation", () => {
  it("accepts decimal and hexadecimal addresses", () => {
    expect(parseAddress("0x1000")).toBe(4096);
    expect(parseAddress("4096")).toBe(4096);
    expect(parseAddress(" 0XFFFFFFFF ")).toBe(0xffffffff);
  });
  it("rejects invalid and out of range addresses", () => {
    for (const address of ["", "-1", "0x", "1.5", "4294967296", "0x100000000", "Infinity", "1e4", "abc"])
      expect(() => parseAddress(address)).toThrow();
  });
});
describe("little endian memory decoding", () => {
  it("decodes unsigned and signed integer values", () => {
    expect(decodeValue([0xff], "u8")).toBe(255);
    expect(decodeValue([0xff], "i8")).toBe(-1);
    expect(decodeValue([0x34, 0x12], "u16")).toBe(0x1234);
    expect(decodeValue([0xff, 0xff], "i16")).toBe(-1);
    expect(decodeValue([0x3a, 0x07, 0, 0], "u32")).toBe(1850);
    expect(decodeValue([0xff, 0xff, 0xff, 0xff], "i32")).toBe(-1);
  });
  it("decodes floating point values", () => {
    expect(decodeValue([0, 0, 0xb1, 0x42], "f32")).toBe(88.5);
    const bytes = Array.from(new Uint8Array(new Float64Array([Math.PI]).buffer));
    expect(decodeValue(bytes, "f64")).toBeCloseTo(Math.PI);
  });
  it("rejects insufficient bytes", () => {
    expect(() => decodeValue([1], "u32")).toThrow("Insufficient");
  });
});
