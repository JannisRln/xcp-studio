import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SymbolBrowser } from "./SymbolBrowser";

describe("SymbolBrowser accessible initial state", () => {
  it("exposes a labelled ELF picker, filters, empty state and bounded pager", () => {
    const markup = renderToStaticMarkup(<SymbolBrowser signals={[]} onAdd={vi.fn()} />);
    expect(markup).toContain('aria-label="Choose ELF file"');
    expect(markup).toContain('aria-label="Search ELF symbols"');
    expect(markup).toContain('aria-label="Symbol kind"');
    expect(markup).toContain('aria-label="Minimum symbol size"');
    expect(markup).toContain('aria-label="Rows per page"');
    expect(markup).toContain('aria-label="ELF symbol results"');
    expect(markup).toContain("No ELF loaded");
    expect(markup).toContain("Page 1 of 1");
    expect(markup).toContain("Only 50 rows rendered per page");
  });

  it("starts with no implied runtime address and requires an explicit type choice", () => {
    const markup = renderToStaticMarkup(<SymbolBrowser signals={[]} onAdd={vi.fn()} />);
    expect(markup).toContain('placeholder="0x1000"');
    expect(markup).toContain('value=""');
    expect(markup).toContain("Select a value type");
    expect(markup).toContain("Runtime address (manual)");
    expect(markup).toContain("not ECU runtime addresses");
    expect(markup).toContain("Typed DWARF variables are not yet available");
    expect(markup).toContain("Add manual signal");
  });
});
