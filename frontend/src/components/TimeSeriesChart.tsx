import { useMemo, useState, type PointerEvent } from "react";
import type { MeasurementFrame, SignalDefinition } from "../core/api";
import {
  chartAxis, chartViewport, decimateExtrema, groupSignalsByUnit,
  nearestChartFrame, type ChartPoint,
} from "./chartMath";

type Props = {
  frames: MeasurementFrame[];
  signals: SignalDefinition[];
  height?: number;
  title?: string;
};

const WIDTH = 930;
const LEFT = 70;
const RIGHT = 900;
const LANE_HEIGHT = 177;

export function chartPoints(frames: MeasurementFrame[], signal: SignalDefinition): ChartPoint[] {
  return frames.flatMap(frame => {
    const sample = frame.samples.find(value => value.name === signal.name && value.address === signal.address);
    return sample && Number.isFinite(sample.value) ? [{ t: frame.timestamp_ms, y: sample.value }] : [];
  });
}

export function TimeSeriesChart({
  frames, signals, height = 320, title = "Time series",
}: Props) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [rangeMs, setRangeMs] = useState(0);
  const [panMs, setPanMs] = useState(0);
  const [cursor, setCursor] = useState<MeasurementFrame | null>(null);

  const viewport = useMemo(
    () => chartViewport(frames, rangeMs, panMs), [frames, rangeMs, panMs],
  );
  const visibleFrames = useMemo(
    () => frames.filter(frame => frame.timestamp_ms >= viewport.start && frame.timestamp_ms <= viewport.end),
    [frames, viewport.start, viewport.end],
  );
  const lanes = useMemo(() => groupSignalsByUnit(signals.filter(signal =>
    !hidden.includes(signal.id))).map(group => {
    const series = group.signals.map(signal => ({
      signal,
      points: chartPoints(visibleFrames, signal),
    }));
    const values = series.flatMap(item => item.points);
    return {
      unit: group.unit,
      series,
      axis: chartAxis(values),
    };
  }), [signals, hidden, visibleFrames]);

  const canvasHeight = Math.max(height, lanes.length * LANE_HEIGHT + 55);
  const timeSpan = Math.max(1, viewport.end - viewport.start);
  const x = (timestamp: number) => LEFT + ((timestamp - viewport.start) / timeSpan) * (RIGHT - LEFT);
  const frameCount = visibleFrames.length;

  const cursorMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width < 1 || !frameCount) return;
    const coordinate = (event.clientX - rect.left) / rect.width * WIDTH;
    const ratio = Math.max(0, Math.min(1, (coordinate - LEFT) / (RIGHT - LEFT)));
    const timestamp = viewport.start + ratio * timeSpan;
    setCursor(nearestChartFrame(visibleFrames, timestamp));
  };

  const panStep = Math.max(1000, rangeMs / 2);
  const oldest = frames.length ? Math.min(...frames.map(frame => frame.timestamp_ms)) : 0;

  return <section className="panel plot-panel" aria-label={title}>
    <div className="panel-heading"><div><h2>{title}</h2>
      <p>Backend XCP polling · per-unit Y axes · host timestamps</p></div>
      <span className="muted">{frameCount} / {frames.length} frames</span>
    </div>
    <div className="toolbar chart-controls">
      <label className="field-group" htmlFor="chart-time-range">Time range
        <select id="chart-time-range" value={rangeMs} onChange={event => {
          setRangeMs(Number(event.target.value));
          setPanMs(0);
        }}>
          <option value={0}>All buffered</option>
          <option value={5000}>Last 5 seconds</option>
          <option value={15000}>Last 15 seconds</option>
          <option value={60000}>Last minute</option>
          <option value={300000}>Last 5 minutes</option>
        </select>
      </label>
      <button className="button small" type="button" disabled={!rangeMs || viewport.start <= oldest}
        onClick={() => setPanMs(value => value + panStep)}>← Earlier</button>
      <button className="button small" type="button" disabled={!rangeMs || panMs <= 0}
        onClick={() => setPanMs(value => Math.max(0, value - panStep))}>Later →</button>
      <button className="button small" type="button" disabled={!panMs}
        onClick={() => setPanMs(0)}>Live edge</button>
    </div>

    <div className="plot-legend">{signals.map(signal =>
      <button key={signal.id} type="button"
        className={hidden.includes(signal.id) ? "legend-item disabled" : "legend-item"}
        onClick={() => setHidden(previous => previous.includes(signal.id)
          ? previous.filter(id => id !== signal.id) : [...previous, signal.id])}
        aria-pressed={!hidden.includes(signal.id)}>
        <i style={{ background: signal.color }} />{signal.name}{signal.unit ? ` (${signal.unit})` : ""}
      </button>)}</div>

    <div className="chart-scroll" style={{ maxHeight: 640, overflowY: "auto" }}>
      <svg className="timeseries" viewBox={`0 0 ${WIDTH} ${canvasHeight}`}
        style={{ width: "100%", height: canvasHeight, minHeight: canvasHeight }}
        role="img" aria-label={`${title}; ${lanes.length} unit axes; ${frameCount} visible sample frames`}
        onPointerMove={cursorMove} onPointerLeave={() => setCursor(null)}>
        {lanes.map((lane, index) => {
          const top = 22 + index * LANE_HEIGHT;
          const yTop = top + 25;
          const yBottom = top + 140;
          const y = (value: number) => yBottom -
            ((value - lane.axis.low) / (lane.axis.high - lane.axis.low)) * (yBottom - yTop);
          const ticks = Array.from({ length: 5 }, (_, i) =>
            lane.axis.low + (lane.axis.high - lane.axis.low) * i / 4);
          return <g key={lane.unit}>
            <text x={LEFT} y={top + 12} fill="#b9cde6" fontSize="13">
              {lane.unit === "raw" ? "Raw value" : `Unit: ${lane.unit}`}
            </text>
            {ticks.map((value, tick) => <g key={tick}>
              <line x1={LEFT} x2={RIGHT} y1={y(value)} y2={y(value)}
                stroke="#2c3d54" strokeDasharray="4 5" />
              <text x={LEFT - 10} y={y(value) + 4} textAnchor="end" fill="#8799b0" fontSize="11">
                {Number(value.toPrecision(4))}
              </text>
            </g>)}
            {lane.series.map(({ signal, points }) => <polyline key={signal.id}
              points={decimateExtrema(points, 600).map(point =>
                `${x(point.t)},${y(point.y)}`).join(" ")}
              fill="none" stroke={signal.color} strokeWidth="2.2" strokeLinejoin="round"
              strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
          </g>;
        })}

        {Array.from({ length: 5 }, (_, i) => {
          const timestamp = viewport.start + (timeSpan * i / 4);
          return <text key={i} x={LEFT + i * (RIGHT - LEFT) / 4}
            y={canvasHeight - 12} textAnchor="middle" fill="#8799b0" fontSize="11">
            {frameCount ? new Date(timestamp).toLocaleTimeString() : "—"}
          </text>;
        })}
        {cursor && <line x1={x(cursor.timestamp_ms)} x2={x(cursor.timestamp_ms)}
          y1="18" y2={canvasHeight - 32} stroke="#c6daef"
          strokeDasharray="3 3" strokeWidth="1.2" />}
        {!frameCount && <text x={WIDTH / 2} y={canvasHeight / 2} textAnchor="middle"
          fill="#8799b0" fontSize="17">No samples in the selected time range</text>}
      </svg>
    </div>

    <div className="chart-cursor-values" role="status" aria-live="off">
      {cursor ? <>
        <strong>{new Date(cursor.timestamp_ms).toLocaleString()}</strong>
        {signals.filter(signal => !hidden.includes(signal.id)).map(signal => {
          const value = cursor.samples.find(sample => sample.name === signal.name &&
            sample.address === signal.address)?.value;
          return <span key={signal.id}><i style={{ background: signal.color }} />
            {signal.name}: {value === undefined ? "—" : Number(value.toPrecision(7))} {signal.unit}</span>;
        })}
      </> : <span className="muted">Move the pointer across the chart to inspect recorded values.</span>}
    </div>
    <p className="muted chart-note">Time windows and panning affect the chart only. Every physical unit
      has its own Y axis; downsampling preserves local minimum/maximum spikes. The backend
      acquisition continues independently of this view.</p>
  </section>;
}
