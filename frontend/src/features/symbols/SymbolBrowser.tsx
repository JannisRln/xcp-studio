import { useMemo, useState } from "react";
import { api, parseAddress } from "../../core/api";
import type { ElfSymbol, SignalDefinition, SignalType } from "../../core/api";
import { formatAddress, signalTypes } from "../../core/signals";
import { canDraftRuntimeAddress, paginateSymbols, querySymbols, type SymbolSort } from "./symbolQuery";

type Props = {
  onAdd: (name: string, address: number, type: SignalType) => void;
  signals: SignalDefinition[];
};

export function SymbolBrowser({ onAdd, signals }: Props) {
  const [symbols, setSymbols] = useState<ElfSymbol[]>([]);
  const [filename, setFilename] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [sort, setSort] = useState<SymbolSort>("name");
  const [page, setPage] = useState(0);
  const [type, setType] = useState<SignalType>("u32");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualAddress, setManualAddress] = useState("0x1000");
  const [draftNote, setDraftNote] = useState("");

  const filtered = useMemo(() => querySymbols(symbols, query, kind, sort), [symbols, query, kind, sort]);
  const paginated = paginateSymbols(filtered, page);
  const visible = paginated.visible;
  const kinds = [...new Set(symbols.map(symbol => symbol.kind))].sort();

  const load = async (file?: File) => {
    if (!file) return;
    setError(""); setBusy(true); setPage(0);
    setFilename(""); setSymbols([]); setDraftNote("");
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error("Maximum ELF file size is 32 MiB");
      const result = await api.inspectElf(file);
      setSymbols(result.symbols);
      setFilename(file.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };
  const add = (name: string, address: number) => {
    try { onAdd(name, address, type); setError(""); setDraftNote(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const draftSymbol = (symbol: ElfSymbol) => {
    setManualName(symbol.name);
    setManualAddress(formatAddress(symbol.address));
    setDraftNote("ELF provides a link-time address only. Review its runtime mapping and value type before adding this address manually.");
  };

  return <div className="workspace-stack">
    <div className="stats-row">
      <div className="stat-tile"><span>ELF FILE</span><strong className="stat-text">{filename || "Not loaded"}</strong><small>ELF symbol table</small></div>
      <div className="stat-tile"><span>SYMBOLS</span><strong>{symbols.length.toLocaleString()}</strong><small>Extracted by Rust backend</small></div>
      <div className="stat-tile"><span>FILTERED</span><strong>{filtered.length.toLocaleString()}</strong><small>Matching entries</small></div>
      <div className="stat-tile"><span>MEASUREMENT LIST</span><strong>{signals.length}</strong><small>Configured XCP signals</small></div>
    </div>
    <section className="panel">
      <div className="panel-heading"><div><h2>ELF symbol browser</h2><p>Inspect link-time symbols and draft manual XCP signals</p></div>
        <label className="button primary upload-control">Import ELF
          <input type="file" accept=".elf,.axf,.out,.bin" disabled={busy} onChange={e => void load(e.target.files?.[0])} />
        </label></div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="toolbar">
        <input className="field" placeholder="Filter name or address..." aria-label="Search ELF symbols" value={query}
          onChange={e => { setQuery(e.target.value); setPage(0); }} />
        <select aria-label="Symbol kind" value={kind} onChange={e => { setKind(e.target.value); setPage(0); }}>
          <option value="all">All kinds</option>{kinds.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Sort symbols" value={sort} onChange={e => setSort(e.target.value as typeof sort)}>
          <option value="name">Name</option><option value="address">Address</option><option value="size">Size descending</option>
        </select>
      </div>
      <div className="table-scroll"><table className="data-table">
        <thead><tr><th>Symbol</th><th>Address</th><th>Size</th><th>Kind</th><th>Action</th></tr></thead>
        <tbody>{visible.map((symbol, index) => <tr key={`${symbol.name}-${symbol.address}-${index}`}>
          <td title={symbol.name} className="symbol-name">{symbol.name}</td>
          <td className="mono">{symbol.address_hex}</td><td>{symbol.size}</td><td>{symbol.kind}</td>
          <td><button className="button small" type="button" disabled={!canDraftRuntimeAddress(symbol)}
            onClick={() => draftSymbol(symbol)}>Draft manual address</button></td>
        </tr>)}</tbody>
      </table></div>
      {!symbols.length && <div className="empty-state">{busy ? "Parsing ELF..." : "Import an ELF file to inspect symbols."}</div>}
      <div className="pagination"><span>Showing {paginated.start}–{paginated.end} of {paginated.total}</span>
        <div><button className="button small" disabled={paginated.page === 0} onClick={() => setPage(paginated.page - 1)}>Previous</button>
        <button className="button small" disabled={paginated.page === paginated.lastPage} onClick={() => setPage(paginated.page + 1)}>Next</button></div>
      </div>
    </section>
    <section className="panel">
      <div className="panel-heading"><div><h2>Manual signal</h2><p>Add a known ECU address without an ELF file</p></div></div>
      {draftNote && <p className="error-banner" role="status">{draftNote}</p>}
      <form className="toolbar" id="manual-signal-form" onSubmit={event => { event.preventDefault(); try { add(manualName.trim() || formatAddress(parseAddress(manualAddress)), parseAddress(manualAddress)); } catch (cause) { setError(String(cause)); } }}>
        <input className="field" aria-label="Signal name" placeholder="Signal name" value={manualName} onChange={e => setManualName(e.target.value)} />
        <input className="field" aria-label="Memory address" value={manualAddress} onChange={e => setManualAddress(e.target.value)} />
        <label className="field-group">Value type<select aria-label="Manual signal value type" value={type} onChange={e => setType(e.target.value as SignalType)}>
          {signalTypes.map(value => <option key={value}>{value}</option>)}
        </select></label>
        <button className="button primary" type="submit">Add manual signal</button>
      </form>
      <p className="muted">ELF symbol addresses are not verified runtime XCP addresses. Drafting an address never starts a read; the operator must deliberately add a manual signal. Real ECU use requires validated relocation, address extension and data type.</p>
    </section>
  </div>;
}
