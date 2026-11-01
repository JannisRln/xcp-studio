import type { ElfSymbol } from "../../core/api";

export type SymbolSort = "name" | "address" | "size";

export function querySymbols(
  symbols: readonly ElfSymbol[], query: string, kind: string, sort: SymbolSort,
): ElfSymbol[] {
  const search = query.trim().toLowerCase();
  return symbols.filter(symbol =>
    (kind === "all" || symbol.kind === kind) &&
    (symbol.name.toLowerCase().includes(search) ||
      symbol.address_hex.toLowerCase().includes(search)),
  ).sort((a, b) => {
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

export function canDraftRuntimeAddress(symbol: ElfSymbol): boolean {
  return Number.isSafeInteger(symbol.address) &&
    symbol.address >= 0 && symbol.address <= 0xffffffff;
}
