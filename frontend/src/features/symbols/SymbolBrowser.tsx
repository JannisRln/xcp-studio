import { useDeferredValue, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { api } from "../../core/api";
import type { ElfSymbol, SignalDefinition, SignalType } from "../../core/api";
import { signalTypes } from "../../core/signals";
import { importErrorMessage, MAX_ELF_BYTES, validateInspection, validateManualSignal } from "./symbolDraft";
import {
  nextSymbolActionIndex, paginateSymbols, querySymbols, symbolDraftIssue, type SymbolSort,
} from "./symbolQuery";
import "./symbolBrowser.css";

type Props = {
  onAdd: (name: string, address: number, type: SignalType) => void;
  signals: SignalDefinition[];
};

export function SymbolBrowser({ onAdd, signals }: Props) {
  const [symbols, setSymbols] = useState<ElfSymbol[]>([]);
  const [filename, setFilename] = useState("");
  const [fileBytes, setFileBytes] = useState(0);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [kind, setKind] = useState("all");
  const [minSize, setMinSize] = useState(0);
  const [sort, setSort] = useState<SymbolSort>("name");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [retryable, setRetryable] = useState(false);
  const [manualError, setManualError] = useState("");
  const [manualMessage, setManualMessage] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualAddress, setManualAddress] = useState("");
  const [type, setType] = useState<SignalType | "">("");
  const [staged, setStaged] = useState<ElfSymbol | null>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const loading = useRef(false);
  const lastFile = useRef<File | null>(null);

  const kinds = useMemo(() => [...new Set(symbols.map(symbol => symbol.kind))].sort(), [symbols]);
  const filtered = useMemo(
    () => querySymbols(symbols, deferredQuery, kind, sort, minSize),
    [symbols, deferredQuery, kind, sort, minSize],
  );
  const paginated = paginateSymbols(filtered, page, pageSize);

  const resetFilters = () => {
    setQuery(""); setKind("all"); setMinSize(0); setSort("name"); setPage(0);
  };

  const load = async (file?: File) => {
    if (!file || loading.current) return;
    loading.current = true;
    lastFile.current = file;
    setBusy(true); setUploadError(""); setRetryable(false);
    try {
      if (file.size === 0) throw new Error("The selected ELF file is empty.");
      if (file.size > MAX_ELF_BYTES) throw new Error("Maximum ELF file size is 32 MiB.");
      const result = validateInspection(await api.inspectElf(file));
      setSymbols(result);
      setFilename(file.name);
      setFileBytes(file.size);
      setStaged(null);
      setManualName(""); setManualAddress(""); setType("");
      setManualError(""); setManualMessage("");
      resetFilters();
    } catch (cause) {
      setUploadError(importErrorMessage(cause));
      setRetryable(file.size > 0 && file.size <= MAX_ELF_BYTES);
      // Keep the last successfully imported ELF visible after an unsuccessful replacement.
    } finally {
      loading.current = false;
      setBusy(false);
    }
  };

  const stage = (symbol: ElfSymbol) => {
    if (symbolDraftIssue(symbol)) return;
    setStaged(symbol);
    setManualName(symbol.name);
    // Important: do not copy link-time location into the runtime address input.
    setManualAddress("");
    setType("");
    setManualError(""); setManualMessage("");
    addressInput.current?.focus();
  };

  const add = () => {
    setManualMessage(""); setManualError("");
    try {
      const draft = validateManualSignal(manualName, manualAddress, type, signals, staged);
      onAdd(draft.name, draft.address, draft.type);
      setManualMessage(`Manual ${draft.type} signal "${draft.name}" configured. Runtime mapping was supplied by the operator, not verified from ELF.`);
      setStaged(null);
    } catch (cause) {
      setManualError(cause instanceof Error ? cause.message : "Unable to configure signal");
    }
  };

  const navigateTable = (event: KeyboardEvent<HTMLTableSectionElement>) => {
    const actions = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-symbol-action]"))
      .filter(button => !button.disabled);
    const current = actions.indexOf(event.target as HTMLButtonElement);
    const next = nextSymbolActionIndex(event.key, current, actions.length);
    if (next === null) return;
    event.preventDefault();
    actions[next].focus();
  };

  return <div className="workspace-stack symbol-browser">
    <div className="stats-row">
      <div className="stat-tile"><span>ELF FILE</span><strong className="stat-text">{filename || "Not loaded"}</strong>
        <small>{filename ? `${(fileBytes / 1024 / 1024).toFixed(2)} MiB · link-time metadata` : "Import for inspection"}</small></div>
      <div className="stat-tile"><span>SYMBOLS</span><strong>{symbols.length.toLocaleString()}</strong><small>From ELF inspection</small></div>
      <div className="stat-tile"><span>MATCHING</span><strong>{filtered.length.toLocaleString()}</strong><small>Filtered entries</small></div>
      <div className="stat-tile"><span>SIGNALS</span><strong>{signals.length}</strong><small>Manual XCP definitions</small></div>
    </div>

    <section className="panel" aria-labelledby="symbol-browser-heading">
      <div className="panel-heading">
        <div><h2 id="symbol-browser-heading">ELF symbol browser</h2>
          <p>Inspect link-time names, sizes and locations. Typed DWARF variables are not yet available in this API.</p></div>
        <label className="button primary upload-control">Import ELF
          <input type="file" accept=".elf,.axf,.out,.bin" disabled={busy} aria-label="Choose ELF file"
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              void load(file);
            }} />
        </label>
      </div>
      {busy && <div className="symbol-import-status" role="status" aria-live="polite">
        <progress aria-label="ELF inspection in progress" /> Inspecting ELF on backend… Previously loaded symbols remain available.
      </div>}
      {uploadError && <div className="error-banner symbol-error" role="alert">
        <span>{uploadError}</span>
        {retryable && <button type="button" className="button small" disabled={busy}
          onClick={() => void load(lastFile.current ?? undefined)}>Retry import</button>}
      </div>}
      <div className="symbol-filterbar">
        <label className="field-group symbol-search">Search names and addresses
          <input className="field" type="search" placeholder="Name, 0x1000 or 4096 (space = AND)"
            aria-label="Search ELF symbols" value={query}
            onChange={event => { setQuery(event.target.value); setPage(0); }} />
        </label>
        <label className="field-group">Kind
          <select aria-label="Symbol kind" value={kind} onChange={event => { setKind(event.target.value); setPage(0); }}>
            <option value="all">All kinds</option>{kinds.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="field-group">Size
          <select aria-label="Minimum symbol size" value={minSize} onChange={event => { setMinSize(Number(event.target.value)); setPage(0); }}>
            <option value={0}>All sizes</option><option value={1}>≥ 1 byte</option><option value={2}>≥ 2 bytes</option>
            <option value={4}>≥ 4 bytes</option><option value={8}>≥ 8 bytes</option>
          </select>
        </label>
        <label className="field-group">Sort by
          <select aria-label="Sort symbols" value={sort} onChange={event => { setSort(event.target.value as SymbolSort); setPage(0); }}>
            <option value="name">Name</option><option value="address">Link-time address</option>
            <option value="size">Size descending</option>
          </select>
        </label>
        <button className="button small" type="button" onClick={resetFilters}
          disabled={!query && kind === "all" && minSize === 0 && sort === "name"}>Clear filters</button>
      </div>
      <p className="symbol-list-status" role="status" aria-live="polite">
        {query !== deferredQuery ? "Updating search…" : `${paginated.total.toLocaleString()} matching symbols`}
        {" · "}Only {pageSize} rows rendered per page. ELF addresses are not ECU runtime addresses.
      </p>
      <div className="table-scroll">
        <table className="data-table" id="symbol-results" aria-label="ELF symbol results">
          <thead><tr><th scope="col">Symbol</th><th scope="col">Link-time address</th>
            <th scope="col">Size</th><th scope="col">Kind</th><th scope="col">Type</th><th scope="col">Action</th></tr></thead>
          <tbody onKeyDown={navigateTable}>
            {paginated.visible.map((symbol, index) => {
              const issue = symbolDraftIssue(symbol);
              return <tr key={`${paginated.start + index}:${symbol.name}:${symbol.address_hex}`}
                className={staged === symbol ? "symbol-staged-row" : undefined}>
                <td title={symbol.name} className="symbol-name">{symbol.name || "(unnamed)"}</td>
                <td className="mono">{symbol.address_hex}</td><td>{symbol.size}</td>
                <td>{symbol.kind}</td><td className="symbol-unresolved">Unknown</td>
                <td>{issue
                  ? <span className="symbol-unavailable" title={issue}>{issue}</span>
                  : <button className="button small" type="button" data-symbol-action
                      aria-pressed={staged === symbol} onClick={() => stage(symbol)}>
                      {staged === symbol ? "Staged" : "Stage manual signal"}</button>}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      {symbols.length === 0 && !busy && <div className="empty-state">No ELF loaded. Import a file to browse its symbol table.</div>}
      {symbols.length > 0 && filtered.length === 0 && <div className="empty-state">
        No symbols match these filters. <button type="button" className="button small" onClick={resetFilters}>Clear filters</button>
      </div>}
      <div className="pagination symbol-pagination">
        <span>Showing {paginated.start.toLocaleString()}–{paginated.end.toLocaleString()} of {paginated.total.toLocaleString()}</span>
        <div className="symbol-page-actions">
          <label className="field-group symbol-page-size">Rows
            <select aria-label="Rows per page" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(0); }}>
              <option value={25}>25</option><option value={50}>50</option>
              <option value={100}>100</option><option value={200}>200</option>
            </select></label>
          <span aria-live="polite">Page {paginated.page + 1} of {paginated.lastPage + 1}</span>
          <button className="button small" type="button" disabled={paginated.page === 0}
            onClick={() => setPage(0)} aria-label="First symbol page">First</button>
          <button className="button small" type="button" disabled={paginated.page === 0}
            onClick={() => setPage(paginated.page - 1)}>Previous</button>
          <button className="button small" type="button" disabled={paginated.page === paginated.lastPage}
            onClick={() => setPage(paginated.page + 1)}>Next</button>
          <button className="button small" type="button" disabled={paginated.page === paginated.lastPage}
            onClick={() => setPage(paginated.lastPage)} aria-label="Last symbol page">Last</button>
        </div>
      </div>
      <p className="muted">Keyboard: Tab to a “Stage manual signal” button; use ↑ / ↓, Home / End to move between actionable rows on this page.</p>
    </section>

    <section className="panel" aria-labelledby="manual-signal-heading">
      <div className="panel-heading">
        <div><h2 id="manual-signal-heading">Manual typed signal</h2>
          <p>Configure a user-supplied runtime address and explicitly choose its raw type.</p></div>
      </div>
      {staged && <div className="symbol-staged" role="status">
        <div><strong>ELF reference (unresolved)</strong>
          <span>{staged.name} · {staged.address_hex} (link-time) · {staged.size} bytes</span>
          <p>This does not supply a runtime ECU address or a verified DWARF type. Enter the mapped runtime address below.</p>
        </div>
        <button className="button small" type="button" onClick={() => { setStaged(null); setManualError(""); }}>Clear reference</button>
      </div>}
      {manualError && <div className="error-banner" role="alert">{manualError}</div>}
      {manualMessage && <p className="symbol-success" role="status">{manualMessage}</p>}
      <form className="symbol-manual-form" id="manual-signal-form" onSubmit={event => { event.preventDefault(); add(); }}>
        <label className="field-group">Signal name
          <input className="field" placeholder="Engine speed" value={manualName} maxLength={128}
            onChange={event => { setManualName(event.target.value); setManualError(""); }} />
        </label>
        <label className="field-group">Runtime address (manual)
          <input ref={addressInput} className="field" placeholder="0x1000" value={manualAddress}
            inputMode="text" autoComplete="off"
            onChange={event => { setManualAddress(event.target.value); setManualError(""); }} />
        </label>
        <label className="field-group">Value type (required)
          <select aria-label="Manual signal value type" value={type}
            onChange={event => { setType(event.target.value as SignalType | ""); setManualError(""); }}>
            <option value="">Select a value type</option>
            {signalTypes.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <button className="button primary" type="submit">Add manual signal</button>
      </form>
      <p className="muted">The current ELF endpoint exposes names, link-time addresses, sizes and symbol kinds, not validated runtime locations, endianness or typed DWARF variables. These manual definitions use the existing little-endian, 32-bit simulator contract; they do not establish hardware read permission or a safe ECU memory mapping.</p>
    </section>
  </div>;
}
