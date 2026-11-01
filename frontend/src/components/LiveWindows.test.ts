import { describe, expect, it } from "vitest";
import { DEFAULT_WINDOWS, validateLayout } from "./LiveWindows";

describe("resizable live measurement window bounds", () => {
  it("accepts default two-window layout", () => {
    expect(validateLayout(DEFAULT_WINDOWS)).toEqual(DEFAULT_WINDOWS);
  });
  it("rejects corrupted and oversized layout definitions", () => {
    expect(validateLayout([])).toBeNull();
    expect(validateLayout([{i:"chart",x:10,y:0,w:9,h:7},
      {i:"values",x:0,y:0,w:3,h:7}])).toBeNull();
    expect(validateLayout([{i:"chart",x:0,y:0,w:9,h:7},
      {i:"unknown",x:9,y:0,w:3,h:7}])).toBeNull();
    expect(validateLayout([{i:"chart",x:0,y:0,w:9,h:7},
      {i:"chart",x:9,y:0,w:3,h:7}])).toBeNull();
  });
});
