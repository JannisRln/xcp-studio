import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../core/api";
import type { Health, SignalType } from "../core/api";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { addWorkspaceSignal, initialSignalWorkspace, removeWorkspaceSignal, toggleWorkspaceSignal } from "./signalWorkspace";
import { OverviewPage } from "../features/overview/OverviewPage";
import { MeasurementsPage } from "../features/measurements/MeasurementsPage";
import { SymbolBrowser } from "../features/symbols/SymbolBrowser";
import { ConnectionsPage } from "../features/connections/ConnectionsPage";
import { DiagnosticsPage } from "../features/diagnostics/DiagnosticsPage";

type Page = "Overview" | "Measurements" | "Symbols" | "Connections" | "Diagnostics" | "Calibration";
const navigation: Array<{ page: Page; icon: string; description: string }> = [
  { page: "Overview", icon: "◫", description: "Workspace home" },
  { page: "Measurements", icon: "⌁", description: "Live acquisition" },
  { page: "Symbols", icon: "◇", description: "ELF variable explorer" },
  { page: "Connections", icon: "⇄", description: "XCP session" },
  { page: "Calibration", icon: "⚙", description: "Read/write planning" },
  { page: "Diagnostics", icon: "▤", description: "System health" },
];
const descriptions: Record<Page, string> = {
  Overview: "Your ECU measurement and calibration workspace.",
  Measurements: "Monitor ECU signals live. Charts and values take priority; export is optional.",
  Symbols: "Explore ELF symbols and configure acquisition channels.",
  Connections: "Manage the XCP session and inspect ECU memory.",
  Calibration: "Calibration operations require a verified write and readback API.",
  Diagnostics: "Backend health, session state and application activity.",
};

export function App() {
  const [page, setPage] = useState<Page>("Measurements");
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(true);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [workspace, setWorkspace] = useState(() => {
    const initial = initialSignalWorkspace();
    if (import.meta.env.MODE !== "pages") return initial;
    const extra = [
      { id: "demo-torque", name: "Torque", address: 0x1008,
        value_type: "f32" as const, unit: "Nm", color: "#8ce0bd" },
      { id: "demo-throttle", name: "Throttle", address: 0x100c,
        value_type: "f32" as const, unit: "%", color: "#c4a0ff" },
    ];
    return {
      signals: [...initial.signals, ...extra],
      selectedIds: [...initial.selectedIds, ...extra.map(item => item.id)],
    };
  });
  const { signals, selectedIds } = workspace;
  const [events, setEvents] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const initialRoute = useRef(true);

  const record = useCallback((message: string) =>
    setEvents(previous => [`${new Date().toLocaleTimeString()}  ${message}`, ...previous].slice(0, 100)), []);
  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const [server, session] = await Promise.all([api.health(), api.status()]);
      setHealth(server); setConnected(session.connected); setError("");
    } catch (cause) {
      setHealth(null); setConnected(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!sidebarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [sidebarOpen]);

  useEffect(() => {
    if (initialRoute.current) {
      initialRoute.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [page]);

  const sessionAction = async (action: "connect" | "disconnect") => {
    setBusy(true); setError("");
    try {
      const status = action === "connect" ? await api.connect() : await api.disconnect();
      setConnected(status.connected);
      record(`XCP simulator ${action === "connect" ? "connected" : "disconnected"}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const addSignal = (name: string, address: number, type: SignalType) => {
    const updated = addWorkspaceSignal(workspace, name, address, type);
    if (updated === workspace) return;
    setWorkspace(updated);
    record(`Configured signal ${name} at 0x${address.toString(16)}`);
  };
  const navigate = (target: string) => {
    setPage(target as Page);
    setSidebarOpen(false);
  };

  return <div className="studio-shell">
    <aside className={sidebarOpen ? "studio-sidebar open" : "studio-sidebar"}>
      <div className="studio-brand"><div className="brand-emblem">X</div>
        <div><strong>XCP Studio</strong><span>ENGINEERING WORKSPACE</span></div></div>
      <div className="sidebar-caption">WORKSPACE</div>
      <nav id="studio-navigation" aria-label="Main navigation">{navigation.map(item =>
        <button key={item.page} className={page === item.page ? "sidebar-link active" : "sidebar-link"}
          onClick={() => navigate(item.page)} title={item.description} aria-current={page === item.page ? "page" : undefined}>
          <span className="sidebar-icon">{item.icon}</span><span>{item.page === "Measurements" ? "Live View" : item.page}</span>
          {item.page === "Measurements" && <small>{signals.length}</small>}
        </button>)}</nav>
      <div className="sidebar-footer"><div><span className={connected ? "connection-light on" : "connection-light"} />
        <strong>{connected ? "XCP connected" : "XCP disconnected"}</strong></div>
        <p>{import.meta.env.MODE === "pages" ? "Browser demo · synthetic data" : "Simulation mode · v0.1"}</p></div>
    </aside>
    <div className="studio-main">
      <header className="studio-topbar">
        <div className="topbar-left"><button className="menu-toggle" onClick={() => setSidebarOpen(value => !value)}
          aria-label="Toggle navigation" aria-expanded={sidebarOpen} aria-controls="studio-navigation">☰</button>
          <span>Workspace</span><span className="breadcrumb-separator">/</span><strong>{page === "Measurements" ? "Live View" : page}</strong></div>
        <div className="topbar-right"><span className={health ? "health-indicator online" : "health-indicator"} role="status" aria-live="polite">
          <span className="connection-light" />API {checking ? "Checking" : health ? "Online" : "Offline"}</span>
          <button className="button small" disabled={checking} onClick={() => void refresh()} title="Refresh connection status">↻ Refresh</button>
          <span className="user-monogram">XS</span></div>
      </header>
      <main className="studio-content">
        <div className="page-heading"><div><div className="eyebrow">XCP STUDIO / {page.toUpperCase()}</div>
          <h1 ref={headingRef} tabIndex={-1}>{page === "Measurements" ? "Live View" : page === "Symbols" ? "Symbol Browser" : page}</h1><p>{descriptions[page]}</p></div>
          <span className="mode-badge">{import.meta.env.MODE === "pages"
            ? "BROWSER DEMO · NO REAL ECU" : "SIMULATION MODE"}</span></div>
        {import.meta.env.MODE === "pages" && <div className="demo-notice" role="status">
          <strong>Interactive browser preview</strong> — all live signals are generated locally.
          No Rust server, CAN interface or physical ECU is connected.
          Changes remain in this browser tab.
        </div>}
        {error && <div className="error-banner" role="alert">{error} <button type="button" className="button small" onClick={() => void refresh()}>Retry API</button></div>}
        <AppErrorBoundary key={page} onRecover={() => void refresh()}>
        {page === "Overview" && <OverviewPage health={health} connected={connected} signals={signals} onNavigate={navigate} />}
        {page === "Measurements" && <MeasurementsPage connected={connected} connecting={busy}
          onConnect={() => sessionAction("connect")} signals={signals}
          selectedIds={selectedIds}
          onToggle={id => setWorkspace(previous => toggleWorkspaceSignal(previous, id))}
          onRemove={id => setWorkspace(previous => removeWorkspaceSignal(previous, id))} />}
        {page === "Symbols" && <SymbolBrowser signals={signals} onAdd={addSignal} />}
        {page === "Connections" && <ConnectionsPage connected={connected} busy={busy}
          onConnect={() => sessionAction("connect")} onDisconnect={() => sessionAction("disconnect")} />}
        {page === "Diagnostics" && <DiagnosticsPage health={health} connected={connected} error={error}
          events={events} onRefresh={() => void refresh()} />}
        {page === "Calibration" && <section className="panel">
          <div className="panel-heading"><div><h2>Calibration workspace</h2><p>Safety-first ECU parameter editing</p></div>
            <span className="state-pill">NOT AVAILABLE</span></div>
          <div className="empty-state">The backend currently supports read-only XCP API operations.
            Calibration writes, range validation, readback verification and rollback protection must be implemented before editing is enabled.</div>
          <button className="button" onClick={() => navigate("Connections")}>Inspect ECU memory</button>
        </section>}
        </AppErrorBoundary>
      </main>
    </div>
  </div>;
}
