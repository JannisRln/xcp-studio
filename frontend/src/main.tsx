import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Page = "Overview" | "Measurements" | "ELF Explorer" | "Calibration" | "Connections" | "Diagnostics";
type ElfSymbol = { name: string; address: number; address_hex: string; size: number; kind: string };
type Health = { status: string; mode: string; version: string };
type Signal = { name: string; unit: string; color: string; base: number; amplitude: number; precision: number };
const signals: Signal[] = [
  { name: "Engine speed", unit: "rpm", color: "#67b9ff", base: 1850, amplitude: 420, precision: 0 },
  { name: "Coolant temperature", unit: "°C", color: "#f5ad67", base: 88, amplitude: 3, precision: 1 },
  { name: "Battery voltage", unit: "V", color: "#a8e6b2", base: 13.8, amplitude: 0.35, precision: 2 },
  { name: "Throttle position", unit: "%", color: "#bd9cff", base: 34, amplitude: 18, precision: 1 },
  { name: "Intake pressure", unit: "kPa", color: "#f18fa7", base: 98, amplitude: 12, precision: 1 },
];
const icons: Record<Page, string> = { Overview: "◫", Measurements: "⌁", "ELF Explorer": "◇", Calibration: "⚙", Connections: "⇄", Diagnostics: "⊞" };
const sample = (signal: Signal, tick: number) =>
  signal.base + Math.sin(tick * 0.17 + signals.indexOf(signal) * 1.4) * signal.amplitude
  + Math.sin(tick * 0.047 + signals.indexOf(signal)) * signal.amplitude * 0.24;
function Sparkline({ signal, tick, large = false }: { signal: Signal; tick: number; large?: boolean }) {
  const values = Array.from({ length: 64 }, (_, index) => sample(signal, tick - 63 + index));
  const min = signal.base - signal.amplitude * 1.55;
  const max = signal.base + signal.amplitude * 1.55;
  const points = values.map((value, index) => `${(index / 63) * 600},${140 - ((value - min) / (max - min)) * 140}`).join(" ");
  return <svg className={large ? "spark large" : "spark"} viewBox="0 0 600 140" preserveAspectRatio="none" role="img" aria-label={`Simulated trend for ${signal.name}`}>
    {large && [35, 70, 105].map(y => <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="#29354a" strokeDasharray="4 5" />)}
    <polyline points={points} fill="none" stroke={signal.color} strokeWidth={large ? 2.8 : 3.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
  </svg>;
}
function App() {
  const [page, setPage] = useState<Page>("Overview");
  const [health, setHealth] = useState<Health | null>(null);
  const [apiError, setApiError] = useState("");
  const [checking, setChecking] = useState(false);
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(true);
  const [selected, setSelected] = useState<string[]>(signals.slice(0, 3).map(s => s.name));
  const [query, setQuery] = useState("");
  const [elfSymbols, setElfSymbols] = useState<ElfSymbol[]>([]);
  const [elfName, setElfName] = useState("");
  const [elfQuery, setElfQuery] = useState("");
  const [elfError, setElfError] = useState("");
  const [elfLoading, setElfLoading] = useState(false);
  const [sessionConnected, setSessionConnected] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [readAddress, setReadAddress] = useState("0x1000");
  const [readCount, setReadCount] = useState(4);
  const [readResult, setReadResult] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [channel, setChannel] = useState("PCAN-USB 1");
  const [bitrate, setBitrate] = useState("500 kbit/s");
  const [log, setLog] = useState<string[]>(["Workspace initialized", "Demo signal generator available"]);
  const checkHealth = async () => {
    setChecking(true);
    try {
      const response = await fetch("/api/health", { signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: Health = await response.json();
      setHealth(data);
      setApiError("");
    } catch (error) {
      setHealth(null);
      setApiError(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    void checkHealth();
    void fetch("/api/xcp/status").then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setSessionConnected(Boolean(data.connected)); })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick(t => t + 1), 180);
    return () => window.clearInterval(id);
  }, [running]);
  const sessionAction = async (action: "connect" | "disconnect") => {
    setSessionBusy(true);
    setSessionError("");
    try {
      const response = await fetch(`/api/xcp/${action}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setSessionConnected(Boolean(data.connected));
      setReadResult("");
      record(`Simulator XCP ${action}`);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSessionBusy(false);
    }
  };
  const readMemory = async (addressText = readAddress, count = readCount) => {
    setSessionBusy(true);
    setSessionError("");
    try {
      const address = Number(addressText);
      if (!Number.isSafeInteger(address) || address < 0 || address > 0xFFFFFFFF ||
          !Number.isInteger(count) || count < 1 || count > 4096) {
        throw new Error("Invalid address or byte count");
      }
      const response = await fetch("/api/xcp/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, count }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setReadResult(`${addressText}: ${data.hex}`);
      record(`Read ${count} bytes at ${addressText} from simulated ECU`);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSessionBusy(false);
    }
  };
  const loadElf = async (file: File | undefined) => {
    if (!file) return;
    setElfLoading(true);
    setElfError("");
    setElfSymbols([]);
    setElfName(file.name);
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error("File exceeds the 32 MiB upload limit");
      const response = await fetch("/api/elf/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setElfSymbols(data.symbols as ElfSymbol[]);
      record(`Inspected ELF: ${file.name} (${data.count} symbols)`);
    } catch (error) {
      setElfError(error instanceof Error ? error.message : String(error));
    } finally {
      setElfLoading(false);
    }
  };
  const filteredElf = useMemo(() => elfSymbols.filter(s =>
    s.name.toLowerCase().includes(elfQuery.toLowerCase()) ||
    s.address_hex.toLowerCase().includes(elfQuery.toLowerCase())
  ).slice(0, 500), [elfSymbols, elfQuery]);
  const visible = useMemo(() => signals.filter(s => s.name.toLowerCase().includes(query.toLowerCase())), [query]);
  const active = signals.filter(s => selected.includes(s.name));
  const toggleSignal = (name: string) => setSelected(current => current.includes(name) ? current.filter(s => s !== name) : [...current, name]);
  const record = (message: string) => setLog(current => [`${new Date().toLocaleTimeString()}  ${message}`, ...current].slice(0, 30));
  const exportCsv = () => {
    const rows = [["sample", ...active.map(s => s.name + " (" + s.unit + ")")], ...Array.from({ length: 64 }, (_, i) =>
      [String(i), ...active.map(s => sample(s, tick - 63 + i).toFixed(s.precision))])];
    const blob = new Blob([rows.map(row => row.join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "xcp-studio-demo.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    record("Exported simulated signal samples as CSV");
  };
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">X</div><div><strong>XCP Studio</strong><small>ENGINEERING WORKSPACE</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Main navigation">{(Object.keys(icons) as Page[]).map(item =>
        <button key={item} className={page === item ? "nav-item active" : "nav-item"} onClick={() => setPage(item)}>
          <span className="nav-icon">{icons[item]}</span>{item}{item === "Measurements" && <span className="nav-count">{selected.length}</span>}
        </button>)}</nav>
      <div className="sidebar-bottom"><span className="status-dot" /> <span>Demo workspace</span><small>v0.1 · Development</small></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><div className="breadcrumbs">Workspace <span>/</span> <strong>{page}</strong></div>
        <div className="top-actions"><span className={health ? "api-status online" : "api-status"}><span className="status-dot" /> API {health ? "reachable" : "offline"}</span><button className="icon-button" onClick={() => void checkHealth()} disabled={checking} title="Refresh backend status">↻</button><div className="avatar">XS</div></div>
      </header>
      <main className="content">
        <div className="heading"><div><div className="eyebrow">XCP STUDIO / {page.toUpperCase()}</div><h1>{page}</h1><p className="subtitle">{page === "Overview" ? "Your measurement and calibration workspace at a glance." : page === "Measurements" ? "Explore simulated signal streams and export sample data." : page === "ELF Explorer" ? "Inspect ELF symbols, addresses and sizes." : page === "Connections" ? "Configure a CAN channel and inspect backend readiness." : page === "Calibration" ? "Calibration workspace and feature readiness." : "Backend connectivity and workspace event log."}</p></div><span className="demo-badge">● SIMULATED DATA</span></div>
        {page === "Overview" && <>
          <div className="metric-grid">
            <div className="metric"><span>BACKEND API</span><strong>{health ? "Online" : "Offline"}</strong><small>{health ? `Mode: ${health.mode}` : "Start xcp-server to connect"}</small></div>
            <div className="metric"><span>HARDWARE CONNECTION</span><strong>Not connected</strong><small>Simulator API available · PCAN pending</small></div>
            <div className="metric"><span>DEMO SIGNALS</span><strong>{selected.length} <em>/ {signals.length}</em></strong><small>Local signal generator</small></div>
            <div className="metric"><span>ACQUISITION</span><strong>{running ? "Running" : "Paused"}</strong><small>Demo only · no ECU traffic</small></div>
          </div>
          <div className="two-column">
            <section className="panel chart-panel"><div className="panel-head"><div><h2>Signal overview</h2><p>Live preview · synthetic samples</p></div><button className="secondary" onClick={() => setPage("Measurements")}>Open measurements →</button></div>
              <div className="chart-legend">{active.map(s => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>
              <div className="chart-stack">{active.length ? active.slice(0, 3).map(s => <div className="chart-row" key={s.name}><span>{s.name}</span><Sparkline signal={s} tick={tick} large /></div>) : <div className="empty">Select signals in Measurements to see trends.</div>}</div>
            </section>
            <section className="panel"><div className="panel-head"><div><h2>Quick actions</h2><p>Jump into your workflow</p></div></div>
              <button className="action-row" onClick={() => setPage("Connections")}><span className="action-symbol">⇄</span><span><strong>Configure CAN channel</strong><small>PCAN configuration preview</small></span><b>→</b></button>
              <button className="action-row" onClick={() => setPage("Measurements")}><span className="action-symbol">⌁</span><span><strong>Browse measurements</strong><small>Inspect and export demo signals</small></span><b>→</b></button>
              <button className="action-row" onClick={() => setPage("Diagnostics")}><span className="action-symbol">⊞</span><span><strong>Inspect diagnostics</strong><small>API status and activity</small></span><b>→</b></button>
              <div className="notice"><strong>Development mode</strong><p>The visualizations use generated data. Real ECU measurements require server-side CAN and XCP endpoints.</p></div>
            </section>
          </div>
        </>}
        {page === "Measurements" && <div className="measurement-layout">
          <section className="panel browser"><div className="panel-head"><div><h2>Signal browser</h2><p>{selected.length} selected</p></div></div><input className="search" placeholder="Search signals..." value={query} onChange={e => setQuery(e.target.value)} aria-label="Search signals" />
            <div className="signal-list">{visible.map(s => <label key={s.name} className="signal-option"><input type="checkbox" checked={selected.includes(s.name)} onChange={() => toggleSignal(s.name)} /><i style={{ background: s.color }} /><span>{s.name}<small>{s.unit}</small></span></label>)}{visible.length === 0 && <div className="empty">No matching signals.</div>}</div>
          </section>
          <section className="panel"><div className="panel-head"><div><h2>Live signals</h2><p>Generated locally · updates every 180 ms</p></div><div className="button-group"><button className="secondary" onClick={() => setRunning(r => !r)}>{running ? "Ⅱ Pause" : "▶ Resume"}</button><button className="primary" onClick={exportCsv} disabled={active.length === 0}>↓ Export CSV</button></div></div>
            <div className="signal-cards">{active.map(s => <div className="signal-card" key={s.name}><div className="signal-value"><span><i style={{ background: s.color }} />{s.name}</span><strong>{sample(s, tick).toFixed(s.precision)} <small>{s.unit}</small></strong></div><Sparkline signal={s} tick={tick} large /></div>)}{active.length === 0 && <div className="empty">Select a signal from the browser.</div>}</div>
          </section>
        </div>}
        {page === "ELF Explorer" && <section className="panel">
          <div className="panel-head"><div><h2>ELF symbol explorer</h2><p>Inspect .symtab and .dynsym via the Rust backend</p></div><span className="demo-badge">LINK-TIME ADDRESSES</span></div>
          <div className="elf-toolbar"><label className="upload-button">↑ Choose ELF file<input type="file" accept=".elf,.axf,.out,.bin" onChange={e => void loadElf(e.target.files?.[0])} /></label>
          <span className="muted">{elfLoading ? "Inspecting file..." : elfName || "No file selected"}</span>
          <input className="search" placeholder="Filter by symbol or address..." value={elfQuery} onChange={e => setElfQuery(e.target.value)} aria-label="Filter ELF symbols" /></div>
          {elfError && <p className="error-text">{elfError}</p>}
          <div className="elf-summary">{elfSymbols.length} symbols loaded · Showing {filteredElf.length} · Maximum 500 rows</div>
          <div className="elf-table-wrap"><table className="elf-table"><thead><tr><th>Symbol</th><th>Address</th><th>Size</th><th>Kind</th></tr></thead><tbody>
          {filteredElf.map((s, i) => <tr key={s.name + s.address_hex + i}><td title={s.name}>{s.name}</td><td><code>{s.address_hex}</code></td><td>{s.size} B</td><td>{s.kind} {s.kind === "data" && <button className="inline-read" disabled={!sessionConnected || s.address > 0xFFFFFFFF || s.size === 0} onClick={() => { setReadAddress(s.address_hex); setReadCount(Math.min(s.size, 64)); setPage("Connections"); }}>Read →</button>}</td></tr>)}
          </tbody></table>{filteredElf.length === 0 && <div className="empty">{elfSymbols.length ? "No matching symbols." : "Choose an ELF file to browse its symbols."}</div>}</div>
          <div className="notice"><strong>Symbol inspection only</strong><p>DWARF types, pointer chains, runtime relocation and live XCP reads are not implemented. Symbols are not live ECU values.</p></div>
        </section>}
        {page === "Connections" && <div className="two-column">
          <section className="panel form-panel"><div className="panel-head"><div><h2>CAN interface</h2><p>Local configuration preview</p></div></div><label className="field">Adapter<select value={channel} onChange={e => setChannel(e.target.value)}><option>PCAN-USB 1</option><option>PCAN-USB 2</option><option>Vector VN1640A</option></select></label><label className="field">Bitrate<select value={bitrate} onChange={e => setBitrate(e.target.value)}><option>125 kbit/s</option><option>250 kbit/s</option><option>500 kbit/s</option><option>1 Mbit/s</option></select></label><div className="field"><span>Command CAN ID</span><code>0x667</code></div><div className="field"><span>Response CAN ID</span><code>0x666</code></div><div className="notice"><strong>Hardware connection unavailable</strong><p>Adapter selection is local only. Connect simulator starts a simulated XCP session; hardware adapter connection is not yet supported.</p></div><div className="button-group"><button className="primary" disabled={sessionBusy || sessionConnected} onClick={() => void sessionAction("connect")}>Connect simulator</button><button className="secondary" disabled={sessionBusy || !sessionConnected} onClick={() => void sessionAction("disconnect")}>Disconnect</button></div>{sessionError && <p className="error-text">{sessionError}</p>}</section>
          <section className="panel"><div className="panel-head"><div><h2>Connection status</h2><p>Actual server status</p></div><button className="secondary" onClick={() => void checkHealth()} disabled={checking}>Refresh</button></div><div className="detail-line"><span>Backend</span><strong>{health ? "Reachable" : "Unavailable"}</strong></div><div className="detail-line"><span>Server mode</span><strong>{health?.mode ?? "—"}</strong></div><div className="detail-line"><span>Server version</span><strong>{health?.version ?? "—"}</strong></div><div className="detail-line"><span>CAN adapter</span><strong>Hardware disconnected</strong></div><div className="detail-line"><span>Simulator XCP session</span><strong>{sessionConnected ? "Connected" : "Disconnected"}</strong></div>{apiError && <p className="error-text">API error: {apiError}</p>}<div className="read-widget"><h3>Read simulated ECU memory</h3><label className="field">Address<input className="search" value={readAddress} onChange={e => setReadAddress(e.target.value)} /></label><label className="field">Bytes<input className="search" type="number" min="1" max="4096" value={readCount} onChange={e => setReadCount(Number(e.target.value))} /></label><button className="primary" disabled={!sessionConnected || sessionBusy} onClick={() => void readMemory()}>Read memory</button>{readResult && <pre className="read-result">{readResult}</pre>}</div></section>
        </div>}
        {page === "Calibration" && <div className="two-column"><section className="panel"><div className="panel-head"><div><h2>Calibration variables</h2><p>ECU memory access</p></div></div><div className="placeholder-icon">⚙</div><h3>Calibration not yet available</h3><p className="muted">The XCP core supports memory read/write operations, but the server does not expose calibration endpoints yet. No values are fabricated here.</p><button className="secondary" onClick={() => setPage("Connections")}>View connection setup →</button></section><section className="panel"><div className="panel-head"><div><h2>Planned workflow</h2><p>Integration roadmap</p></div></div><div className="roadmap"><div><b>01</b><span>Connect to CAN adapter</span></div><div><b>02</b><span>Establish XCP session</span></div><div><b>03</b><span>Load A2L variable definitions</span></div><div><b>04</b><span>Read, edit and verify calibration values</span></div></div></section></div>}
        {page === "Diagnostics" && <div className="two-column"><section className="panel"><div className="panel-head"><div><h2>Backend diagnostics</h2><p>Server health endpoint</p></div><button className="secondary" onClick={() => void checkHealth()} disabled={checking}>↻ Check now</button></div><div className="detail-line"><span>Endpoint</span><code>/api/health</code></div><div className="detail-line"><span>HTTP status</span><strong>{health ? "Healthy" : "Unavailable"}</strong></div><div className="detail-line"><span>Execution mode</span><strong>{health?.mode ?? "—"}</strong></div><div className="detail-line"><span>Version</span><strong>{health?.version ?? "—"}</strong></div>{apiError && <p className="error-text">{apiError}</p>}</section><section className="panel"><div className="panel-head"><div><h2>Workspace events</h2><p>Local UI activity</p></div><button className="secondary" onClick={() => setLog([])}>Clear</button></div><div className="event-list">{log.length ? log.map((entry, i) => <div key={i} className="event"><span className="status-dot" />{entry}</div>) : <div className="empty">No events recorded.</div>}</div></section></div>}
      </main>
      <footer className="footer"><span><span className="status-dot" /> {health ? "API connected" : "API disconnected"}</span><span>Demo mode · No live ECU data</span><span>XCP Studio v0.1</span></footer>
    </div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<App />);
