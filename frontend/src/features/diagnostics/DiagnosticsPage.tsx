import type { Health } from "../../core/api";

type Props = { health: Health | null; connected: boolean; error: string; events: string[]; onRefresh: () => void };
export function DiagnosticsPage({ health, connected, error, events, onRefresh }: Props) {
  return <div className="workspace-stack">
    <div className="stats-row">
      <div className="stat-tile"><span>API STATUS</span><strong>{health?.status ?? "Unavailable"}</strong><small>HTTP health endpoint</small></div>
      <div className="stat-tile"><span>BACKEND MODE</span><strong>{health?.mode ?? "Unknown"}</strong><small>Reported by server</small></div>
      <div className="stat-tile"><span>SESSION</span><strong>{connected ? "Connected" : "Disconnected"}</strong><small>XCP simulator</small></div>
      <div className="stat-tile"><span>EVENTS</span><strong>{events.length}</strong><small>Current UI session</small></div>
    </div>
    <section className="panel">
      <div className="panel-heading"><div><h2>Backend diagnostics</h2><p>Health and session status</p></div>
        <button className="button" onClick={onRefresh}>Refresh</button></div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="inspector-grid"><div><span>SERVER VERSION</span><strong>{health?.version ?? "—"}</strong></div>
        <div><span>BACKEND REACHABLE</span><strong>{health ? "Yes" : "No"}</strong></div></div>
    </section>
    <section className="panel">
      <div className="panel-heading"><div><h2>Activity log</h2><p>Recent actions from this browser session</p></div></div>
      <div className="event-list">{events.map((event, index) => <div key={index} className="event-row"><span className="event-dot" />{event}</div>)}</div>
    </section>
  </div>;
}
