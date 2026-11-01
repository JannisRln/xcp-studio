import { useMemo, useState } from "react";
import type { SignalDefinition } from "../../core/api";
import { measurementCsv, downloadText } from "../../core/export";
import { formatAddress } from "../../core/signals";
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
  const latest = acquisition.frames.at(-1);

  return <div className="workspace-stack">
    <div className="stats-row">
      <div className="stat-tile"><span>ACQUISITION</span><strong>{acquisition.state.toUpperCase()}</strong><small>{connected ? "Simulator connected" : "Connect simulator first"}</small></div>
      <div className="stat-tile"><span>RECEIVED FRAMES</span><strong>{acquisition.received.toLocaleString()}</strong><small>Since buffer reset</small></div>
      <div className="stat-tile"><span>BUFFERED</span><strong>{acquisition.frames.length}</strong><small>Maximum 2,000 frames</small></div>
      <div className="stat-tile"><span>CHANNELS</span><strong>{active.length}</strong><small>Selected for acquisition</small></div>
    </div>
    <div className="toolbar panel">
      <div className="toolbar-group"><label htmlFor="interval">Sample interval</label>
        <select id="interval" value={intervalMs} disabled={acquisition.state === "streaming"}
          onChange={e => setIntervalMs(Number(e.target.value))}>
          {[20, 50, 100, 200, 500, 1000].map(ms => <option key={ms} value={ms}>{ms} ms</option>)}
        </select>
      </div>
      <div className="toolbar-actions">
        {acquisition.state === "streaming" || acquisition.state === "connecting"
          ? <button className="button danger" onClick={acquisition.stop}>Stop acquisition</button>
          : <button className="button primary" disabled={!connected || !active.length}
              onClick={() => acquisition.start(active, intervalMs)}>Start acquisition</button>}
        <button className="button" disabled={!acquisition.frames.length} onClick={() =>
          downloadText("xcp-measurement.csv", measurementCsv(acquisition.frames, active))}>Export CSV</button>
        <button className="button" disabled={!acquisition.frames.length} onClick={acquisition.clear}>Clear buffer</button>
      </div>
    </div>
    {acquisition.error && <div className="error-banner" role="alert">{acquisition.error}</div>}
    <div className="measure-grid">
      <section className="panel signal-browser">
        <div className="panel-heading"><div><h2>Signal selection</h2><p>{active.length} selected / {signals.length} configured</p></div></div>
        <input className="field" aria-label="Filter signals" placeholder="Search signals or address..." value={filter}
          onChange={e => setFilter(e.target.value)} />
        <div className="signal-rows">{visible.map(signal => <div className="signal-select-row" key={signal.id}>
          <label><input type="checkbox" checked={selectedIds.includes(signal.id)} onChange={() => onToggle(signal.id)} />
            <span className="signal-color" style={{ background: signal.color }} />
            <span><strong>{signal.name}</strong><small>{formatAddress(signal.address)} · {signal.value_type} {signal.unit}</small></span>
          </label>
          <button className="text-button" type="button" aria-label={`Remove ${signal.name}`} onClick={() => onRemove(signal.id)}>×</button>
        </div>)}
          {!visible.length && <p className="muted">No matching signals. Add variables from Symbol Browser.</p>}
        </div>
      </section>
      <div className="workspace-stack">
        <TimeSeriesChart frames={acquisition.frames} signals={active} title="Live acquisition" />
        <section className="panel">
          <div className="panel-heading"><div><h2>Latest values</h2><p>Decoded from XCP ECU memory</p></div>
            <span className="muted">{latest ? new Date(latest.timestamp_ms).toLocaleTimeString() : "No samples"}</span></div>
          <div className="value-grid">{active.map(signal => {
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
