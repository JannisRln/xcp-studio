import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import type { MeasurementFrame, SignalDefinition } from "../core/api";

/** Retained testable selector for a single signal series. */
export function chartPoints(frames: MeasurementFrame[], signal: SignalDefinition) {
  return frames.flatMap(frame => {
    const sample = frame.samples.find(item => item.name === signal.name && item.address === signal.address);
    return sample && Number.isFinite(sample.value)
      ? [{ t: frame.timestamp_ms, y: sample.value }] : [];
  });
}
import { chartViewport, groupSignalsByUnit } from "./chartMath";
import { alignedPlotData, cursorValue } from "./plotData";

type Props = {
  frames: MeasurementFrame[];
  signals: SignalDefinition[];
  height?: number;
  title?: string;
};

type Viewport = { start: number; end: number };
type Measurements = { a: number | null; b: number | null };
type LaneProps = {
  unit: string;
  signals: SignalDefinition[];
  frames: MeasurementFrame[];
  viewport: Viewport;
  markers: Measurements;
  onMeasure: (time: number) => void;
};

function ChartLane({ unit, signals, frames, viewport, markers, onMeasure }: LaneProps) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const onMeasureRef = useRef(onMeasure);
  const markersRef = useRef(markers);
  const seriesKey = signals.map(signal => signal.id + "/" + signal.color).join(",");
  const aligned = useMemo(() =>
    alignedPlotData(frames, signals, 1400) as uPlot.AlignedData,
    [frames, signals],
  );
  onMeasureRef.current = onMeasure;
  markersRef.current = markers;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const opts: uPlot.Options = {
      width: Math.max(320, element.clientWidth || 720),
      height: 242,
      padding: [12, 12, 4, 4],
      series: [
        {},
        ...signals.map(signal => ({
          label: signal.name,
          stroke: signal.color,
          width: 2,
          spanGaps: false,
        })),
      ],
      scales: { x: { time: false }, y: { auto: true } },
      axes: [
        {
          stroke: "#9bafc9",
          grid: { stroke: "#26394e" },
          values: (_u, ticks) => ticks.map(tick =>
            Number.isFinite(tick) ? new Date(tick).toLocaleTimeString() : ""),
        },
        {
          stroke: "#9bafc9",
          grid: { stroke: "#26394e" },
          label: unit === "raw" ? "Raw value" : unit,
          size: 72,
        },
      ],
      cursor: { drag: { x: false, y: false } },
      hooks: {
        draw: [(u) => {
          const ctx = u.ctx;
          const values = markersRef.current;
          for (const [name, time] of [["A", values.a], ["B", values.b]] as const) {
            if (time === null || time < u.scales.x.min! || time > u.scales.x.max!) continue;
            const x = u.valToPos(time, "x", true);
            ctx.save();
            ctx.strokeStyle = name === "A" ? "#70ecbd" : "#f7c67e";
            ctx.lineWidth = devicePixelRatio || 1;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.moveTo(x, u.bbox.top);
            ctx.lineTo(x, u.bbox.top + u.bbox.height);
            ctx.stroke();
            ctx.restore();
          }
        }],
      },
    };
    const instance = new uPlot(opts, aligned, element);
    plot.current = instance;
    const onClick = () => {
      const index = instance.cursor.idx;
      if (typeof index === "number" && index >= 0 && index < instance.data[0].length) {
        const value = instance.data[0][index];
        if (typeof value === "number") onMeasureRef.current(value);
      }
    };
    instance.over.addEventListener("click", onClick);
    const resize = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? element.clientWidth;
      if (width >= 200) instance.setSize({ width: Math.floor(width), height: 242 });
    });
    resize.observe(element);
    return () => {
      resize.disconnect();
      instance.over.removeEventListener("click", onClick);
      instance.destroy();
      plot.current = null;
    };
    // Chart object depends on series identity, NOT every incoming sample.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesKey, unit]);

  useEffect(() => {
    if (!plot.current) return;
    plot.current.setData(aligned);
    plot.current.setScale("x", { min: viewport.start, max: viewport.end });
  }, [aligned, viewport.start, viewport.end]);

  useEffect(() => { plot.current?.redraw(); }, [markers.a, markers.b]);

  return <div className="uplot-lane">
    <div className="uplot-lane-header">
      <strong>{unit === "raw" ? "Raw value" : unit}</strong>
      <span>{signals.map(signal => signal.name).join(" · ")}</span>
    </div>
    <div ref={host} className="uplot-host timeseries"
      role="img" aria-label={"Canvas live chart " + unit + " for " +
        signals.map(signal => signal.name).join(", ")} />
  </div>;
}

export function TimeSeriesChart({ frames, signals, title = "Time series" }: Props) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [rangeMs, setRangeMs] = useState(15000);
  const [panMs, setPanMs] = useState(0);
  const [target, setTarget] = useState<"a" | "b">("a");
  const [markers, setMarkers] = useState<Measurements>({ a: null, b: null });
  const [signalId, setSignalId] = useState("");

  const viewport = useMemo(() => chartViewport(frames, rangeMs, panMs), [frames, rangeMs, panMs]);
  const visible = useMemo(() =>
    frames.filter(frame => frame.timestamp_ms >= viewport.start &&
      frame.timestamp_ms <= viewport.end), [frames, viewport.start, viewport.end]);
  const visibleSignals = useMemo(() => signals.filter(signal =>
    !hidden.includes(signal.id)), [signals, hidden]);
  const lanes = useMemo(() => groupSignalsByUnit(visibleSignals), [visibleSignals]);
  const measured = signals.find(signal => signal.id === signalId) ?? signals[0];
  const a = measured ? cursorValue(frames, measured, markers.a) : null;
  const b = measured ? cursorValue(frames, measured, markers.b) : null;

  const measure = useCallback((time: number) => {
    setMarkers(previous => ({ ...previous, [target]: time }));
    setTarget(previous => previous === "a" ? "b" : "a");
  }, [target]);

  const oldest = frames.length ? frames[0].timestamp_ms : 0;
  const panStep = Math.max(1000, rangeMs / 2);

  return <section className="panel plot-panel" aria-label={title}>
    <div className="panel-heading">
      <div><h2>{title}</h2>
        <p>uPlot Canvas · independent unit axes · browser-capped render updates</p></div>
      <span className="muted">{visible.length} / {frames.length} frames</span>
    </div>
    <div className="toolbar chart-controls">
      <label className="field-group" htmlFor="chart-time-range">Time range
        <select id="chart-time-range" value={rangeMs} onChange={event => {
          setRangeMs(Number(event.target.value)); setPanMs(0);
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
        <i style={{ background: signal.color }} />{signal.name}
        {signal.unit ? " (" + signal.unit + ")" : ""}
      </button>)}</div>

    <div className="measurement-cursors">
      <strong>Measurement cursors</strong>
      <label>Signal <select aria-label="Measurement signal" value={measured?.id ?? ""}
        onChange={event => setSignalId(event.target.value)}>
        {signals.map(signal => <option key={signal.id} value={signal.id}>
          {signal.name}</option>)}
      </select></label>
      <button className={target === "a" ? "button small primary" : "button small"}
        type="button" onClick={() => setTarget("a")}>Set cursor A</button>
      <button className={target === "b" ? "button small primary" : "button small"}
        type="button" onClick={() => setTarget("b")}>Set cursor B</button>
      <button className="button small" type="button" onClick={() => setMarkers({ a: null, b: null })}>
        Clear cursors</button>
      <span className="muted">Click a chart point to place the selected cursor.</span>
    </div>

    <div className="uplot-lanes">
      {lanes.map(group => <ChartLane key={group.unit}
        unit={group.unit} signals={group.signals} frames={visible}
        viewport={viewport} markers={markers} onMeasure={measure} />)}
      {!lanes.length && <div className="empty-state">Select a signal to show its live trend.</div>}
    </div>
    <div className="measurement-readout" role="status">
      <span>A: {a ? new Date(a.time).toLocaleTimeString() : "—"}
        {a?.value !== null && a?.value !== undefined ? " / " + a.value.toFixed(3) : ""}
      </span>
      <span>B: {b ? new Date(b.time).toLocaleTimeString() : "—"}
        {b?.value !== null && b?.value !== undefined ? " / " + b.value.toFixed(3) : ""}
      </span>
      <strong>Δt: {a && b ? ((b.time - a.time) / 1000).toFixed(3) + " s" : "—"}</strong>
      <strong>ΔY: {a?.value !== null && a?.value !== undefined &&
        b?.value !== null && b?.value !== undefined
          ? (b.value - a.value).toFixed(3) + " " + (measured?.unit ?? "")
          : "—"}</strong>
    </div>
    <p className="muted chart-note">Rendering is decoupled from XCP acquisition. Chart data is
      bounded and reduced to extrema-preserving points per unit; no physical ECU performance
      is implied by the browser demo.</p>
  </section>;
}

export const MemoTimeSeriesChart = memo(TimeSeriesChart);
