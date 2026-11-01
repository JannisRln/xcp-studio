import type { ElfSymbol } from "../../core/api";

export type SymbolSort = "name" | "address" | "size";

/** Search only the fields provided by the current ELF inspection API (not DWARF types). */
export function querySymbols(
  symbols: readonly ElfSymbol[], query: string, kind: string, sort: SymbolSort, minSize = 0,
): ElfSymbol[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matching = symbols.filter(symbol => {
    if (kind !== "all" && symbol.kind !== kind) return false;
    if (symbol.size < minSize) return false;
    if (!terms.length) return true;
    const haystack = `${symbol.name} ${symbol.address_hex} ${symbol.address}`.toLocaleLowerCase();
    return terms.every(term => haystack.includes(term));
  });
  return matching.sort((a, b) => {
    switch (sort) {
      case "name":
        return a.name.localeCompare(b.name) || a.address - b.address;
      case "address":
        return a.address - b.address || a.name.localeCompare(b.name);
      case "size":
        return b.size - a.size || a.name.localeCompare(b.name);
    }
  });
}

/** Never render more than pageSize entries, even for huge symbol tables. */
export function paginateSymbols(symbols: readonly ElfSymbol[], requestedPage: number, pageSize = 50) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500)
    throw new Error("Invalid symbol page size");
  const lastPage = Math.max(0, Math.ceil(symbols.length / pageSize) - 1);
  const page = Number.isSafeInteger(requestedPage) ? Math.max(0, Math.min(lastPage, requestedPage)) : 0;
  return {
    page, lastPage, total: symbols.length,
    start: symbols.length ? page * pageSize + 1 : 0,
    end: Math.min(symbols.length, (page + 1) * pageSize),
    visible: symbols.slice(page * pageSize, (page + 1) * pageSize),
  };
}

/** Link-time addresses never establish runtime validity; this only permits staging metadata. */
export function symbolDraftIssue(symbol: ElfSymbol): string | null {
  if (symbol.kind.toLowerCase() !== "data") return "Not a data variable";
  if (!Number.isSafeInteger(symbol.address) || symbol.address < 0 || symbol.address > 0xffffffff)
    return "Link-time address is outside the supported 32-bit range";
  if (!Number.isSafeInteger(symbol.size) || symbol.size < 0)
    return "Invalid ELF symbol size";
  return null;
}

export function canDraftRuntimeAddress(symbol: ElfSymbol): boolean {
  return symbolDraftIssue(symbol) === null;
}

/** Up/Down/Home/End move between enabled action buttons in the visible page. */
export function nextSymbolActionIndex(key: string, current: number, count: number): number | null {
  if (count < 1 || current < 0 || current >= count) return null;
  switch (key) {
    case "ArrowDown": return Math.min(count - 1, current + 1);
    case "ArrowUp": return Math.max(0, current - 1);
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}
