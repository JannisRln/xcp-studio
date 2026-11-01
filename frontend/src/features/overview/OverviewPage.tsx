import type { Health, SignalDefinition } from "../../core/api";
import { formatAddress } from "../../core/signals";

type Props = { health: Health | null; connected: boolean; signals: SignalDefinition[]; onNavigate: (page: string) => void };
export function OverviewPage({ health, connected, signals, onNavigate }: Props) {
  return <div className="workspace-stack">
    <div className="stats-row">
      <div className="stat-tile"><span>BACKEND API</span><strong>{health ? "Online" : "Offline"}</strong><small>{health ? `Version ${health.version}` : "Start xcp-server"}</small></div>
      <div className="stat-tile"><span>XCP SESSION</span><strong>{connected ? "Connected" : "Disconnected"}</strong><small>Simulation transport</small></div>
      <div className="stat-tile"><span>CONFIGURED SIGNALS</span><strong>{signals.length}</strong><small>Available for acquisition</small></div>
      <div className="stat-tile"><span>DATA SOURCE</span><strong>Simulator</strong><small>Hardware support pending</small></div>
    </div>
    <div className="overview-grid">
      <section className="panel">
        <div className="panel-heading"><div><h2>Quick start</h2><p>From ECU connection to recorded measurements</p></div></div>
        <div className="quick-steps">
          <button onClick={() => onNavigate("Connections")}><b>01</b><span><strong>Connect XCP simulator</strong><small>Open a session with the simulated ECU</small></span><span>→</span></button>
          <button onClick={() => onNavigate("Symbols")}><b>02</b><span><strong>Browse ECU symbols</strong><small>Load ELF metadata or configure a memory address</small></span><span>→</span></button>
          <button onClick={() => onNavigate("Measurements")}><b>03</b><span><strong>Start live acquisition</strong><small>WebSocket streaming and CSV export</small></span><span>→</span></button>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h2>Signal configuration</h2><p>Current measurement channels</p></div></div>
        <div className="overview-signals">{signals.map(signal => <div key={signal.id}>
          <i style={{ background: signal.color }} /><span>{signal.name}</span><code>{formatAddress(signal.address)}</code>
        </div>)}</div>
        <button className="button" onClick={() => onNavigate("Symbols")}>Manage signals</button>
      </section>
    </div>
    <section className="panel">
      <div className="panel-heading"><div><h2>System capabilities</h2><p>Implementation status and limitations</p></div></div>
      <div className="capability-grid">
        <div><strong>Ready</strong><span>ELF symbol inspection</span><span>XCP simulator connect / read</span><span>WebSocket polling stream</span><span>Browser CSV export</span></div>
        <div><strong>In development</strong><span>Typed DWARF variable resolution</span><span>ECU-side XCP DAQ</span><span>Backend recording</span><span>Hardware transport and calibration writes</span></div>
      </div>
    </section>
  </div>;
}
