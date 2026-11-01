import { useMemo, useState } from "react";
import type { SignalDefinition } from "../../core/api";
import { acquisitionCsv, downloadText } from "../../core/export";
import { formatAddress, palette } from "../../core/signals";
import { MemoTimeSeriesChart } from "../../components/TimeSeriesChart";
import { LiveWindows } from "../../components/LiveWindows";
import { useAcquisition } from "./useAcquisition";

type Props = {
  connected: boolean;
  connecting?: boolean;
  onConnect?: () => Promise<void>;
  signals: SignalDefinition[];
  onRemove: (id: string) => void;
  selectedIds: string[];
  onToggle: (id: string) => void;
};

const indicatorText = {
  live: "Receiving live samples",
  stale: "No recent samples",
  waiting: "Waiting for first sample",
  connecting: "Connecting live stream",
  disconnected: "Live view stopped",
  error: "Live connection interrupted",
} as const;

function formatAge(ageMs: number | null): string {
  if (ageMs === null) return "—";
  return ageMs < 1000 ? `${Math.floor(ageMs)} ms` : `${(ageMs / 1000).toFixed(1)} s`;
}

export function MeasurementsPage({
  connected, connecting = false, onConnect, signals, onRemove, selectedIds, onToggle,
}: Props) {
  const [filter, setFilter] = useState("");
  const [intervalMs, setIntervalMs] = useState(100);
  const acquisition = useAcquisition(connected);
  const active = useMemo(() => signals.filter(signal => selectedIds.includes(signal.id)),
    [signals, selectedIds]);
  const visible = useMemo(() => signals.filter(signal =>
    signal.name.toLowerCase().includes(filter.toLowerCase()) ||
    formatAddress(signal.address).toLowerCase().includes(filter.toLowerCase())),
  [signals, filter]);

  const backendRunning = acquisition.status?.state === "running";
  const busy = acquisition.state === "connecting";
  const latest = acquisition.latest;
  const hasBuffer = acquisition.frames.length > 0;
  const signalSet = useMemo(() => acquisition.status &&
    (backendRunning || hasBuffer)
    ? acquisition.status.signals.map((signal, index) => {
      const configured = signals.find(item => item.name === signal.name &&
        item.address === signal.address && item.value_type === signal.value_type);
      return configured ?? {
        id: signal.name + "@" + signal.address.toString(16),
        name: signal.name,
        address: signal.address,
        value_type: signal.value_type,
        unit: "",
        color: palette[index % palette.length],
      };
    }) : active, [acquisition.status?.signals, backendRunning, hasBuffer, signals, active]);

  const live = acquisition.indicator === "live";
  const showExisting = backendRunning && acquisition.state !== "streaming";

  return <div className="workspace-stack live-workspace">
    <section className={`panel live-hero live-hero--${acquisition.indicator}`} aria-label="Live measurement status">
      <div className="live-hero-heading">
        <div>
          <div className="live-hero-kicker"><span className="live-beacon" aria-hidden="true" />
            LIVE VIEW <span className="live-hero-mode">{import.meta.env.VITE_DEMO === "1"
              ? "BROWSER DEMO · SYNTHETIC SIGNALS" : "ECU SIMULATION · XCP polling"}</span></div>
          <h2>{indicatorText[acquisition.indicator]}</h2>
          <p>{!connected
            ? "Connect the ECU simulator to view measurements as they arrive."
            : backendRunning
              ? `Backend acquisition ${acquisition.status?.acquisition_id ?? ""} · ${acquisition.status?.interval_ms ?? intervalMs} ms requested interval`
              : "Choose your signals and start a live measurement. No recording is required."}
          </p>
        </div>
        <div className="live-hero-actions">
          {!connected
            ? <button className="button primary live-primary-action" type="button"
                disabled={connecting || !onConnect} onClick={() => void onConnect?.()}>
                {connecting ? "Connecting…" : "Connect simulator"}</button>
            : backendRunning
              ? <>
                  <button className="button danger" type="button"
                    onClick={() => void acquisition.stop()}>Stop acquisition</button>
                  {showExisting && <button className="button primary live-primary-action"
                    type="button" disabled={busy} onClick={() => void acquisition.reattach()}>
                    {busy ? "Reconnecting…" : "Reconnect Live View"}</button>}
                </>
              : <button className="button primary live-primary-action" type="button"
                  disabled={!active.length || busy}
                  onClick={() => void acquisition.start(active, intervalMs)}>
                  {busy ? "Starting…" : "Start Live View"}</button>}
        </div>
      </div>
      <div className="live-metrics" aria-label="Live stream metrics">
        <div><span>STREAM</span><strong className={live ? "live-metric-good" : ""}>
          {acquisition.indicator.toUpperCase()}</strong><small>{connected ? "XCP simulator connected" : "ECU disconnected"}</small></div>
        <div><span>RECEIVED RATE</span><strong>{acquisition.receiveHz.toFixed(1)} <em>Hz</em></strong>
          <small>Measured in this browser</small></div>
        <div><span>LAST SAMPLE</span><strong>{formatAge(acquisition.sampleAge)}</strong>
          <small>{acquisition.indicator === "stale" ? "Stream is stalled" : "Age since browser receipt"}</small></div>
        <div><span>MISSING EVENTS</span><strong>{acquisition.dropped.toLocaleString()}</strong>
          <small>Subscriber gaps detected</small></div>
      </div>
      <div className="live-toolbar">
        <label htmlFor="live-sample-interval">Requested update interval
          <select id="live-sample-interval" value={intervalMs} disabled={backendRunning || busy}
            onChange={event => setIntervalMs(Number(event.target.value))}>
            {[20, 50, 100, 200, 500, 1000].map(ms =>
              <option key={ms} value={ms}>{ms} ms</option>)}
          </select>
        </label>
        <button className="button small" type="button"
          disabled={acquisition.state !== "streaming"}
          onClick={acquisition.togglePause}>
          {acquisition.paused ? "Resume chart" : "Pause chart"}</button>
        <span className="muted">{acquisition.paused
          ? "Chart frozen; latest values continue updating."
          : "Live chart and values update from the backend."}</span>
      </div>
    </section>

    {acquisition.error && <div className="error-banner" role="alert">
      {acquisition.error}
      {connected && acquisition.status?.state !== "failed" &&
        <button className="button small" type="button"
          disabled={busy} onClick={() => void acquisition.reattach()}>
          Retry connection now</button>}
    </div>}

    <LiveWindows
      chart={<MemoTimeSeriesChart frames={acquisition.frames} signals={signalSet}
        title={acquisition.paused ? "Live chart · paused" : "Live signal trends"} />}
      values={<>
    <section className="panel" aria-label="Latest ECU values">
      <div className="panel-heading">
        <div><h2>Live signal values</h2>
          <p>{import.meta.env.VITE_DEMO === "1"
            ? "Synthesized signals for browser-only demonstration"
            : "Values decoded from XCP memory · no synthetic frontend data"}</p></div>
        <span className="muted">{latest
          ? `Last XCP batch · ${new Date(latest.timestamp_ms).toLocaleTimeString()}`
          : "Waiting for measurements"}</span>
      </div>
      <div className="value-grid">{signalSet.map(signal => {
        const sample = latest?.samples.find(item => item.name === signal.name &&
          item.address === signal.address);
        const stale = !live || !sample;
        return <div className={stale ? "value-tile live-value-stale" : "value-tile live-value-fresh"}
          key={signal.id}>
          <span><i style={{ background: signal.color }} />{signal.name}
            <small className="live-value-quality">{!connected ? "DISCONNECTED"
              : !sample ? "NO DATA" : !live ? "STALE" : "LIVE"}</small></span>
          <strong>{sample ? Number(sample.value.toPrecision(7)).toLocaleString() : "—"}
            <small> {signal.unit}</small></strong>
          <small>{formatAddress(signal.address)} · {signal.value_type}</small>
        </div>;
      })}
        {!signalSet.length && <div className="empty-state">
          No signals selected. Choose signals below or import an ELF in Symbol Browser.
        </div>}
      </div>
    </section>
      </>}
    />

    <section className="panel signal-browser" aria-label="Live signal configuration">
      <div className="panel-heading">
        <div><h2>Signal selection</h2>
          <p>{active.length} selected / {signals.length} configured · can be changed between acquisitions</p></div>
        <span className="muted">{backendRunning ? "Locked while acquiring" : "Ready to configure"}</span>
      </div>
      <input className="field" aria-label="Filter signals" placeholder="Filter signal names or addresses…"
        value={filter} onChange={event => setFilter(event.target.value)} />
      <div className="live-signal-list">{visible.map(signal =>
        <div className="signal-select-row" key={signal.id}>
          <label><input type="checkbox" checked={selectedIds.includes(signal.id)}
              disabled={backendRunning} onChange={() => onToggle(signal.id)} />
            <span className="signal-color" style={{ background: signal.color }} />
            <span><strong>{signal.name}</strong>
              <small>{formatAddress(signal.address)} · {signal.value_type} {signal.unit}</small></span>
          </label>
          <button className="text-button" type="button" disabled={backendRunning}
            aria-label={`Remove ${signal.name}`} onClick={() => onRemove(signal.id)}>×</button>
        </div>)}
        {!visible.length && <p className="muted">No matching signals. Add variables from Symbol Browser.</p>}
      </div>
    </section>

    <details className="panel live-secondary">
      <summary>Optional: export recent live samples</summary>
      <p className="muted">Export contains only the {acquisition.frames.length} recent frames retained
        by this browser (maximum 2,000). It is not a full backend recording.</p>
      <div className="toolbar-actions">
        <button className="button" type="button" disabled={!acquisition.frames.length}
          onClick={() => downloadText("xcp-live-preview.csv",
            acquisitionCsv(acquisition.frames, signalSet))}>Export recent CSV</button>
        <button className="button" type="button" disabled={!acquisition.frames.length}
          onClick={acquisition.clear}>Clear chart preview</button>
      </div>
    </details>
  </div>;
}
