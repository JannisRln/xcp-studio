import { describe, expect, it } from "vitest";
import type { ElfSymbol } from "../../core/api";
import { canDraftRuntimeAddress, nextSymbolActionIndex, paginateSymbols, querySymbols, symbolDraftIssue } from "./symbolQuery";

const symbol = (index: number): ElfSymbol => ({
  name: `variable_${String(index).padStart(5, "0")}`,
  address: 4096 + 4 * index,
  address_hex: `0x${(4096 + 4 * index).toString(16)}`,
  size: index % 8 + 1,
  kind: index % 2 ? "data" : "function",
});

describe("ELF symbol search and pagination", () => {
  it("filters and sorts 10,000 entries without mutating the source", () => {
    const source = Array.from({ length: 10000 }, (_, index) => symbol(9999 - index));
    const first = source[0];
    const filtered = querySymbols(source, "VARIABLE_0000", "data", "address");
    expect(filtered.length).toBe(5);
    expect(filtered.map(entry => entry.address)).toEqual([...filtered.map(entry => entry.address)].sort((a, b) => a - b));
    expect(source[0]).toBe(first);
  });

  it("handles 75k symbols and renders at most 200 rows per page", () => {
    const source = Array.from({ length: 75000 }, (_, index) => symbol(index));
    const filtered = querySymbols(source, "variable_ 0x", "data", "size", 4);
    expect(filtered.length).toBeGreaterThan(10000);
    const last = paginateSymbols(filtered, 999999, 200);
    expect(last.visible.length).toBeLessThanOrEqual(200);
    expect(last.end).toBe(filtered.length);
    expect(last.lastPage).toBe(Math.ceil(filtered.length / 200) - 1);
  });

  it("searches decimal/hex addresses with AND terms and respects minimum size", () => {
    const items = [symbol(0), symbol(1), symbol(2)];
    expect(querySymbols(items, "4100 variable", "all", "address").map(entry => entry.name))
      .toEqual([symbol(1).name]);
    expect(querySymbols(items, "0x1004", "all", "name")).toHaveLength(1);
    expect(querySymbols(items, "", "data", "name", 4)).toHaveLength(0);
    expect(querySymbols(items, "", "data", "name", 2)).toHaveLength(1);
  });

  it("paginates with bounded page size and clamps stale page state", () => {
    const sorted = querySymbols(Array.from({ length: 125 }, (_, index) => symbol(index)), "", "all", "name");
    const last = paginateSymbols(sorted, 300);
    expect(last.page).toBe(2);
    expect(last.start).toBe(101);
    expect(last.end).toBe(125);
    expect(last.visible).toHaveLength(25);
    expect(paginateSymbols([], 500)).toMatchObject({ page: 0, total: 0, start: 0, end: 0 });
    expect(() => paginateSymbols(sorted, 0, 0)).toThrow();
    expect(() => paginateSymbols(sorted, 0, 501)).toThrow();
  });

  it("only stages 32-bit-range data symbols, never implying runtime resolution", () => {
    const data = symbol(1);
    expect(canDraftRuntimeAddress(data)).toBe(true);
    expect(canDraftRuntimeAddress(symbol(0))).toBe(false);
    expect(symbolDraftIssue(symbol(0))).toMatch(/Not a data/);
    expect(canDraftRuntimeAddress({ ...data, address: -1 })).toBe(false);
    expect(canDraftRuntimeAddress({ ...data, address: 2 ** 32 })).toBe(false);
    expect(canDraftRuntimeAddress({ ...data, address: Number.NaN })).toBe(false);
    expect(canDraftRuntimeAddress({ ...data, size: -1 })).toBe(false);
  });

  it("supports arrow and boundary keys on enabled visible row actions", () => {
    expect(nextSymbolActionIndex("ArrowDown", 0, 3)).toBe(1);
    expect(nextSymbolActionIndex("ArrowDown", 2, 3)).toBe(2);
    expect(nextSymbolActionIndex("ArrowUp", 0, 3)).toBe(0);
    expect(nextSymbolActionIndex("Home", 2, 3)).toBe(0);
    expect(nextSymbolActionIndex("End", 0, 3)).toBe(2);
    expect(nextSymbolActionIndex("Enter", 0, 3)).toBeNull();
    expect(nextSymbolActionIndex("ArrowDown", -1, 3)).toBeNull();
    expect(nextSymbolActionIndex("ArrowDown", 0, 0)).toBeNull();
  });
});
