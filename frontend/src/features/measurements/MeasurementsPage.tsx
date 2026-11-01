import { useMemo, useState } from "react";
import type { SignalDefinition } from "../../core/api";
import { acquisitionCsv, downloadText } from "../../core/export";
import { formatAddress, palette } from "../../core/signals";
import { TimeSeriesChart } from "../../components/TimeSeriesChart";
import { useAcquisition } from "./useAcquisition";

type Props = {
  connected: boolean;
  signals: SignalDefinition[];
  onRemove: (id: string) => void;
  selectedIds: string[];
  onToggle: (id: string) => void;
};

export function MeasurementsPage({ connected, signals, onRemove, selectedIds, onToggle }: Props) {
  const [filter, setFilter] = useState("");
  const [intervalMs, setIntervalMs] = useState(100);
  const acquisition = useAcquisition(connected);
  const active = useMemo(() => signals.filter(s => selectedIds.includes(s.id)), [signals, selectedIds]);
  const visible = signals.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()) ||
    formatAddress(s.address).toLowerCase().includes(filter.toLowerCase()));
  const latest = acquisition.latest;
  const backendRunning = acquisition.status?.state === "running";
  const displaySignals = acquisition.status &&
    (backendRunning || acquisition.frames.length > 0)
    ? acquisition.status.signals.map((signal, index) => {
      const configured = signals.find(item => item.name === signal.name && item.address === signal.address);
      return configured ?? {
        id: `${signal.name}@${signal.address.toString(16)}`,
        name: signal.name,
        address: signal.address,
        value_type: signal.value_type,
        unit: "",
        color: palette[index % palette.length],
      };
    }) : active;
  const busy = acquisition.state === "connecting" || acquisition.state === "streaming";

  return <div className="workspace-stack">
    <div className="stats-row">
      <div className="stat-tile"><span>ACQUISITION</span><strong>{acquisition.state.toUpperCase()}</strong><small>{acquisition.status?.acquisition_id ?? "No active acquisition"}</small></div>
      <div className="stat-tile"><span>RECEIVED FRAMES</span><strong>{acquisition.received.toLocaleString()}</strong><small>From this browser connection</small></div>
      <div className="stat-tile"><span>BUFFERED</span><strong>{acquisition.frames.length}</strong><small>Browser preview, maximum 2,000</small></div>
      <div className="stat-tile"><span>GAP / LOST EVENTS</span><strong>{acquisition.dropped}</strong><small>Detected subscriber overflow</small></div>
    </div>
    <div className="toolbar panel">
      <div className="toolbar-group"><label htmlFor="interval">Sample interval</label>
        <select id="interval" value={intervalMs} disabled={backendRunning || busy}
          onChange={e => setIntervalMs(Number(e.target.value))}>
          {[20, 50, 100, 200, 500, 1000].map(ms => <option key={ms} value={ms}>{ms} ms</option>)}
        </select>
      </div>
      <div className="toolbar-actions">
        {backendRunning
          ? <>
              <button className="button danger" type="button" onClick={() => void acquisition.stop()}>Stop backend acquisition</button>
              {acquisition.state === "error" &&
                <button className="button primary" type="button" onClick={() => void acquisition.reattach()}>Reattach live view</button>}
            </>
          : <button className="button primary" type="button" disabled={!connected || !active.length || busy}
              onClick={() => void acquisition.start(active, intervalMs)}>Start backend acquisition</button>}
        <button className="button" type="button" disabled={!busy || acquisition.state !== "streaming"}
          onClick={acquisition.togglePause}>{acquisition.paused ? "Resume chart" : "Pause chart"}</button>
        <button className="button" type="button" disabled={!acquisition.frames.length} onClick={() =>
          downloadText("xcp-acquisition-preview.csv", acquisitionCsv(acquisition.frames, displaySignals))}>Export buffered CSV</button>
        <button className="button" type="button" disabled={!acquisition.frames.length} onClick={acquisition.clear}>Clear preview</button>
      </div>
    </div>
    {acquisition.error && <div className="error-banner" role="alert">{acquisition.error}</div>}
    <p className="muted" role="status">The backend owns one shared XCP polling acquisition. Closing this view does not stop it.
      Export contains only the bounded browser preview, not a complete durable recording.
      {acquisition.paused ? " Chart rendering is paused; backend acquisition continues." : ""}
      {acquisition.status?.state === "running"
        ? ` Acquisition sequence: ${acquisition.status.sequence}; interval: ${acquisition.status.interval_ms} ms.`
        : ""}
    </p>
    <div className="measure-grid">
      <section className="panel signal-browser">
        <div className="panel-heading"><div><h2>Signal selection</h2><p>{active.length} selected / {signals.length} configured</p></div></div>
        <input className="field" aria-label="Filter signals" placeholder="Search signals or address..." value={filter}
          onChange={e => setFilter(e.target.value)} />
        <div className="signal-rows">{visible.map(signal => <div className="signal-select-row" key={signal.id}>
          <label><input type="checkbox" checked={selectedIds.includes(signal.id)} disabled={backendRunning} onChange={() => onToggle(signal.id)} />
            <span className="signal-color" style={{ background: signal.color }} />
            <span><strong>{signal.name}</strong><small>{formatAddress(signal.address)} · {signal.value_type} {signal.unit}</small></span>
          </label>
          <button className="text-button" type="button" disabled={backendRunning} aria-label={`Remove ${signal.name}`} onClick={() => onRemove(signal.id)}>×</button>
        </div>)}
          {!visible.length && <p className="muted">No matching signals. Add variables from Symbol Browser.</p>}
        </div>
      </section>
      <div className="workspace-stack">
        <TimeSeriesChart frames={acquisition.frames} signals={displaySignals} title={acquisition.paused ? "Paused visualization" : "Live acquisition"} />
        <section className="panel">
          <div className="panel-heading"><div><h2>Latest values</h2><p>Decoded from XCP ECU memory</p></div>
            <span className="muted">{latest ? new Date(latest.timestamp_ms).toLocaleTimeString() : "No samples"}</span></div>
          <div className="value-grid">{displaySignals.map(signal => {
            const value = latest?.samples.find(sample => sample.name === signal.name && sample.address === signal.address)?.value;
            return <div className="value-tile" key={signal.id}>
              <span><i style={{ background: signal.color }} />{signal.name}</span>
              <strong>{value === undefined ? "—" : Number(value.toPrecision(7)).toLocaleString()} <small>{signal.unit}</small></strong>
              <small>{formatAddress(signal.address)} · {signal.value_type}</small>
            </div>;
          })}</div>
        </section>
      </div>
    </div>
  </div>;
}
