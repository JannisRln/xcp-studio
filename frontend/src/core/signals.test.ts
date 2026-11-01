import { describe, expect, it } from "vitest";
import { addSymbolSignal, defaultSignals, formatAddress } from "./signals";

describe("signal configuration", () => {
  it("uses known simulator addresses", () => {
    expect(defaultSignals.map(signal => signal.address)).toEqual([4096, 4100]);
  });
  it("adds a symbol with stable address identity", () => {
    const next = addSymbolSignal(defaultSignals, "Battery voltage", 4104, "f32");
    expect(next).toHaveLength(3);
    expect(next[2]).toMatchObject({ id: "Battery voltage@1008", value_type: "f32" });
    expect(addSymbolSignal(next, "Battery voltage", 4104, "f32")).toHaveLength(3);
  });
  it("rejects addresses outside the XCP memory range", () => {
    expect(() => addSymbolSignal([], "invalid", 2 ** 32)).toThrow();
    expect(() => addSymbolSignal([], "invalid", -1)).toThrow();
  });
  it("formats addresses with leading zeroes", () => {
    expect(formatAddress(4096)).toBe("0x00001000");
  });
});
