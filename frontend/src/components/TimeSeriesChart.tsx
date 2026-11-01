import { useMemo, useState } from "react";
import type { MeasurementFrame, SignalDefinition } from "../core/api";

type Props = {
  frames: MeasurementFrame[];
  signals: SignalDefinition[];
  height?: number;
  title?: string;
};

export function chartPoints(frames: MeasurementFrame[], signal: SignalDefinition): Array<{ t: number; y: number }> {
  return frames.flatMap(frame => {
    const sample = frame.samples.find(value => value.name === signal.name && value.address === signal.address);
    return sample ? [{ t: frame.timestamp_ms, y: sample.value }] : [];
  });
}

export function TimeSeriesChart({ frames, signals, height = 320, title = "Time series" }: Props) {
  const [hidden, setHidden] = useState<string[]>([]);
  const series = useMemo(() => signals.filter(s => !hidden.includes(s.id)).map(signal =>
    ({ signal, points: chartPoints(frames, signal) })), [frames, signals, hidden]);
  const all = series.flatMap(item => item.points);
  const minTime = all.length ? Math.min(...all.map(p => p.t)) : 0;
  const maxTime = all.length ? Math.max(...all.map(p => p.t)) : 1;
  const minValue = all.length ? Math.min(...all.map(p => p.y)) : 0;
  const maxValue = all.length ? Math.max(...all.map(p => p.y)) : 1;
  const spanTime = Math.max(1, maxTime - minTime);
  const spanValue = Math.max(0.0001, maxValue - minValue);
  const low = minValue - spanValue * 0.1;
  const high = maxValue + spanValue * 0.1;
  const x = (t: number) => 58 + ((t - minTime) / spanTime) * 824;
  const y = (v: number) => 270 - ((v - low) / (high - low)) * 240;
  const ticks = Array.from({ length: 5 }, (_, i) => low + ((high - low) * i) / 4);
  return <section className="panel plot-panel" aria-label={title}>
    <div className="panel-heading"><div><h2>{title}</h2><p>Time-aligned XCP samples · shared linear value axis</p></div>
      <span className="muted">{frames.length} frames</span></div>
    <div className="plot-legend">{signals.map(signal =>
      <button key={signal.id} className={hidden.includes(signal.id) ? "legend-item disabled" : "legend-item"}
        onClick={() => setHidden(previous => previous.includes(signal.id)
          ? previous.filter(id => id !== signal.id) : [...previous, signal.id])}
        aria-pressed={!hidden.includes(signal.id)}>
        <i style={{ background: signal.color }} />{signal.name}{signal.unit ? ` (${signal.unit})` : ""}
      </button>)}</div>
    <svg className="timeseries" viewBox="0 0 920 320" style={{ height }} role="img" aria-label={`${title}, ${all.length} samples`}>
      {ticks.map((value, i) => <g key={i}>
        <line x1="58" x2="882" y1={y(value)} y2={y(value)} stroke="#2c3d54" strokeDasharray="4 5" />
        <text x="49" y={y(value) + 4} textAnchor="end" fill="#8799b0" fontSize="12">{Number(value.toPrecision(4))}</text>
      </g>)}
      {Array.from({ length: 5 }, (_, i) => {
        const t = minTime + (spanTime * i) / 4;
        return <text key={i} x={58 + i * 206} y="304" textAnchor="middle" fill="#8799b0" fontSize="12">
          {all.length ? new Date(t).toLocaleTimeString() : "—"}
        </text>;
      })}
      {series.map(({ signal, points }) => <polyline key={signal.id}
        points={points.map(point => `${x(point.t)},${y(point.y)}`).join(" ")}
        fill="none" stroke={signal.color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round"
        vectorEffect="non-scaling-stroke" />)}
      {!all.length && <text x="460" y="155" textAnchor="middle" fill="#8799b0" fontSize="17">Start acquisition to see ECU samples</text>}
    </svg>
    <p className="muted chart-note">Signals with different units share a value axis. Individual axes and zoom are planned.</p>
  </section>;
}
