import { describe, expect, it } from "vitest";
import type { ElfSymbol } from "../../core/api";
import { canDraftRuntimeAddress, paginateSymbols, querySymbols } from "./symbolQuery";

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

  it("paginates with bounded page size and clamps stale page state", () => {
    const sorted = querySymbols(Array.from({ length: 125 }, (_, index) => symbol(index)), "", "all", "name");
    const last = paginateSymbols(sorted, 300);
    expect(last.page).toBe(2);
    expect(last.start).toBe(101);
    expect(last.end).toBe(125);
    expect(last.visible).toHaveLength(25);
    expect(paginateSymbols([], 500)).toMatchObject({ page: 0, total: 0, start: 0, end: 0 });
    expect(() => paginateSymbols(sorted, 0, 0)).toThrow();
  });

  it("does not offer manual address drafts for unsafe values", () => {
    expect(canDraftRuntimeAddress(symbol(0))).toBe(true);
    expect(canDraftRuntimeAddress({ ...symbol(0), address: -1 })).toBe(false);
    expect(canDraftRuntimeAddress({ ...symbol(0), address: 2 ** 32 })).toBe(false);
    expect(canDraftRuntimeAddress({ ...symbol(0), address: Number.NaN })).toBe(false);
  });
});
