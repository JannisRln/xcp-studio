import { describe, expect, it } from "vitest";

describe("XCP Studio frontend test setup", () => {
  it("supports hexadecimal XCP addresses", () => {
    expect(Number("0x1000")).toBe(4096);
  });

  it("decodes a little-endian 32-bit ECU value", () => {
    const view = new DataView(new Uint8Array([0x3a, 0x07, 0x00, 0x00]).buffer);
    expect(view.getUint32(0, true)).toBe(1850);
  });

  it("decodes a little-endian floating-point ECU value", () => {
    const bytes = new Uint8Array(4);
    const view = new DataView(bytes.buffer);
    view.setFloat32(0, 88.5, true);
    expect(view.getFloat32(0, true)).toBe(88.5);
  });
});
