import { useMemo, useState } from "react";
import type { Health } from "../../core/api";
import {
  browserSupportBundle, filterDiagnostics, projectDiagnostics,
} from "./diagnosticsModel";
import type { DiagnosticSeverity, DiagnosticSubsystem } from "./diagnosticsModel";

type Props = { health: Health | null; connected: boolean; error: string; events: string[]; onRefresh: () => void };

export function DiagnosticsPage({ health, connected, error, events, onRefresh }: Props) {
  const [severity, setSeverity] = useState<DiagnosticSeverity | "all">("all");
  const [subsystem, setSubsystem] = useState<DiagnosticSubsystem | "all">("all");
  const rows = useMemo(() => projectDiagnostics(health, connected, error, events),
    [health, connected, error, events]);
  const visible = useMemo(() => filterDiagnostics(rows, { severity, subsystem }),
    [rows, severity, subsystem]);

  const exportBrowserDiagnostics = () => {
    // Clicking explicitly authorizes a *local* browser-only download.
    const json = browserSupportBundle(health, connected, error, events);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "xcp-studio-browser-diagnostics.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return <div className="workspace-stack">
    <div className="stats-row">
      <div className="stat-tile"><span>API STATUS</span><strong>{health ? "Reachable" : "Offline"}</strong><small>Existing health endpoint</small></div>
      <div className="stat-tile"><span>BACKEND MODE</span><strong>{health?.mode === "simulation" ? "Simulation" : "Unknown"}</strong><small>Not a hardware diagnosis</small></div>
      <div className="stat-tile"><span>SESSION</span><strong>{health ? (connected ? "Connected" : "Disconnected") : "Unknown"}</strong><small>Last UI observation</small></div>
      <div className="stat-tile"><span>LOCAL EVENTS</span><strong>{rows.length}</strong><small>Browser-only, bounded history</small></div>
    </div>
    <section className="panel">
      <div className="panel-heading"><div><h2>System diagnostics</h2><p>Current health and observed session state</p></div>
        <button className="button" type="button" onClick={onRefresh}>Refresh</button></div>
      {error && <div className="error-banner" role="alert">Backend request failed; sensitive error details are withheld from diagnostics.</div>}
      <div className="inspector-grid"><div><span>SERVER VERSION</span><strong>{/^\d+\.\d+\.\d+$/.test(health?.version ?? "") ? health?.version : "Unavailable"}</strong></div>
        <div><span>BACKEND REACHABLE</span><strong>{health ? "Yes" : "No"}</strong></div></div>
    </section>
    <section className="panel">
      <div className="panel-heading"><div><h2>Diagnostic timeline</h2>
        <p>Sanitized browser activity; backend-structured events, correlation IDs and original timestamps are not connected yet.</p></div>
        <button className="button" type="button" onClick={exportBrowserDiagnostics}>Export browser-only support bundle</button></div>
      <div className="toolbar" style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <label className="field-group">Severity
          <select aria-label="Filter diagnostics by severity" value={severity}
            onChange={event => setSeverity(event.target.value as DiagnosticSeverity | "all")}>
            <option value="all">All</option><option value="info">Info</option>
            <option value="warning">Warning</option><option value="error">Error</option>
          </select>
        </label>
        <label className="field-group">Subsystem
          <select aria-label="Filter diagnostics by subsystem" value={subsystem}
            onChange={event => setSubsystem(event.target.value as DiagnosticSubsystem | "all")}>
            <option value="all">All</option><option value="api">API</option><option value="session">Session</option>
            <option value="acquisition">Acquisition</option><option value="websocket">WebSocket</option>
            <option value="data_quality">Data quality</option><option value="ui">Browser UI</option>
          </select>
        </label>
      </div>
      <div className="event-list" role="log" aria-label="Sanitized diagnostic events">
        {visible.length === 0 && <p className="empty-state">No observations match these filters.</p>}
        {visible.map(row => <div key={row.key} className="event-row">
          <strong>{row.severity.toUpperCase()}</strong>{" · "}{row.subsystem}{" · "}
          <code>{row.code}</code>
          <div>{row.message}</div>
          <small>Timestamp and correlation: not available from the current browser log</small>
        </div>)}
      </div>
      <p className="muted">This panel does not collect or upload telemetry. The manual export excludes arbitrary error text, signal names, memory addresses and local paths. A backend support-bundle endpoint requires separate contract review.</p>
    </section>
  </div>;
}
