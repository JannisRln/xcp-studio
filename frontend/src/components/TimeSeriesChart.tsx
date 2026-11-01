import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import type { MeasurementFrame, SignalDefinition } from "../core/api";
import { groupSignalsByUnit } from "./chartMath";
import { LiveRingBuffer } from "./liveRingBuffer";

type Props = {
  frames: MeasurementFrame[];
  signals: SignalDefinition[];
  height?: number;
  title?: string;
};

type Marker = { time: number; position: number };
type Range = { start: number; end: number };
const MARGIN_LEFT = 75;
const MARGIN_RIGHT = 22;
const TOP = 27;
const LANE_HEIGHT = 160;
const BOTTOM = 36;
const MIN_WINDOW_MS = 20;

function formatTime(time: number, monotonic: boolean): string {
  return monotonic ? `${(time / 1000).toFixed(3)} s`
    : new Date(time).toLocaleTimeString();
}
function valueLabel(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(7)).toLocaleString() : "—";
}

export function TimeSeriesChart({
  frames, signals, height = 320, title = "Live signal trends",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef(new LiveRingBuffer(32768));
  const consumedRef = useRef<MeasurementFrame | null>(null);
  const previousLengthRef = useRef(0);
  const lastAcquisitionRef = useRef<string | undefined>(undefined);
  const [revision, setRevision] = useState(0);
  const [hidden, setHidden] = useState<string[]>([]);
  const [rangeMs, setRangeMs] = useState(15000);
  const [panMs, setPanMs] = useState(0);
  const [width, setWidth] = useState(800);
  const [markerA, setMarkerA] = useState<Marker | null>(null);
  const [markerB, setMarkerB] = useState<Marker | null>(null);
  const [cursor, setCursor] = useState<Marker | null>(null);
  const [activeMarker, setActiveMarker] = useState<"A" | "B">("A");
  const [showTools, setShowTools] = useState(true);
  const dragRef = useRef<{ x: number; pan: number } | null>(null);
  const rafRef = useRef(0);

  // Consume only newly appended frames. A bounded preview can shift without
  // reallocating the underlying time-series arrays.
  useEffect(() => {
    const buffer = bufferRef.current;
    const first = frames[0];
    const last = frames[frames.length - 1];
    const acquisitionId = first?.acquisition_id;
    if (!frames.length || (lastAcquisitionRef.current !== undefined &&
        acquisitionId !== lastAcquisitionRef.current) ||
        (previousLengthRef.current > frames.length && last === consumedRef.current)) {
      buffer.reset();
      consumedRef.current = null;
      previousLengthRef.current = 0;
    }
    lastAcquisitionRef.current = acquisitionId;
    if (!frames.length) { setRevision(v => v + 1); return; }

    const lastConsumed = consumedRef.current;
    let start = lastConsumed ? frames.indexOf(lastConsumed) + 1 : 0;
    if (lastConsumed && start === 0) {
      // Browser preview shifted by MAX_BUFFER, or acquisition was reset.
      if (last?.sequence !== undefined && lastConsumed.sequence !== undefined &&
          last.sequence <= lastConsumed.sequence) {
        buffer.reset();
        start = 0;
      } else {
        start = frames.findIndex(frame =>
          (frame.monotonic_elapsed_ms ?? frame.timestamp_ms) > buffer.newest);
        if (start < 0) start = frames.length;
      }
    }
    for (let i = start; i < frames.length; i++) buffer.append(frames[i], signals);
    consumedRef.current = last;
    previousLengthRef.current = frames.length;
    setRevision(v => v + 1);
  }, [frames, signals]);

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    const resize = new ResizeObserver(entries => {
      const size = entries[0]?.contentRect.width;
      if (size && size > 0) setWidth(Math.round(size));
    });
    resize.observe(element);
    return () => resize.disconnect();
  }, []);

  const buffer = bufferRef.current;
  const monotonic = frames.length > 0 && frames[0].monotonic_elapsed_ms !== undefined;
  const lanes = useMemo(() => groupSignalsByUnit(
    signals.filter(signal => !hidden.includes(signal.id))), [signals, hidden]);
  const canvasHeight = Math.max(height, TOP + lanes.length * LANE_HEIGHT + BOTTOM);
  const plotWidth = Math.max(1, width - MARGIN_LEFT - MARGIN_RIGHT);
  const end = Math.max(buffer.oldest + 1, buffer.newest - panMs);
  const start = rangeMs <= 0 ? buffer.oldest : Math.max(buffer.oldest, end - rangeMs);
  const viewport: Range = { start, end };
  const xFor = useCallback((time: number) =>
    MARGIN_LEFT + (time - viewport.start) / Math.max(1, viewport.end - viewport.start) * plotWidth,
    [viewport.start, viewport.end, plotWidth]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pixelsWide = Math.max(1, Math.round(width * dpr));
    const pixelsHigh = Math.max(1, Math.round(canvasHeight * dpr));
    if (canvas.width !== pixelsWide || canvas.height !== pixelsHigh) {
      canvas.width = pixelsWide;
      canvas.height = pixelsHigh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#111d2e";
    ctx.fillRect(0, 0, width, canvasHeight);
    ctx.font = "11px system-ui, sans-serif";
    const span = Math.max(1, viewport.end - viewport.start);

    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex++) {
      const lane = lanes[laneIndex];
      const yTop = TOP + laneIndex * LANE_HEIGHT + 20;
      const yBottom = yTop + 105;
      const keys = lane.signals.map(LiveRingBuffer.key);
      const axis = buffer.extent(keys, viewport.start, viewport.end);
      const yFor = (value: number) =>
        yBottom - (value - axis.low) / (axis.high - axis.low) * (yBottom - yTop);

      ctx.fillStyle = "#b9cde6";
      ctx.fillText(lane.unit === "raw" ? "Raw value" : `Unit: ${lane.unit}`, MARGIN_LEFT, yTop - 9);
      for (let i = 0; i < 5; i++) {
        const value = axis.low + (axis.high - axis.low) * i / 4;
        const y = yFor(value);
        ctx.strokeStyle = "#2c3d54";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(MARGIN_LEFT, y);
        ctx.lineTo(width - MARGIN_RIGHT, y);
        ctx.stroke();
        ctx.fillStyle = "#92a6bf";
        ctx.textAlign = "right";
        ctx.fillText(Number(value.toPrecision(4)).toString(), MARGIN_LEFT - 10, y + 4);
        ctx.textAlign = "left";
      }

      for (const signal of lane.signals) {
        const points = buffer.extrema(LiveRingBuffer.key(signal),
          viewport.start, viewport.end, plotWidth);
        if (!points.length) continue;
        ctx.strokeStyle = signal.color;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
          const point = points[i];
          const x = MARGIN_LEFT + (point.t - viewport.start) / span * plotWidth;
          const y = yFor(point.y);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    ctx.fillStyle = "#92a6bf";
    ctx.textAlign = "center";
    for (let i = 0; i <= 4; i++) {
      const time = viewport.start + span * i / 4;
      ctx.fillText(buffer.length ? formatTime(time, monotonic) : "—",
        MARGIN_LEFT + plotWidth * i / 4, canvasHeight - 13);
    }
    const drawMarker = (marker: Marker | null, color: string, label: string) => {
      if (!marker || marker.time < viewport.start || marker.time > viewport.end) return;
      const x = xFor(marker.time);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x, TOP);
      ctx.lineTo(x, canvasHeight - BOTTOM);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.fillText(label, x + 4, TOP - 10);
    };
    drawMarker(markerA, "#f4c26d", "A");
    drawMarker(markerB, "#83e7ff", "B");
    drawMarker(cursor, "#c7d8eb", "↕");
    ctx.textAlign = "left";
    if (!buffer.length) {
      ctx.fillStyle = "#92a6bf";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for live samples", width / 2, canvasHeight / 2);
    }
  }, [buffer, canvasHeight, lanes, monotonic, viewport.start, viewport.end, width, plotWidth, xFor]);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(redraw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [redraw, revision]);

  const timeFromPointer = (event: PointerEvent<HTMLCanvasElement>): Marker => {
    const rect = event.currentTarget.getBoundingClientRect();
    const position = Math.max(0, Math.min(1,
      (event.clientX - rect.left - MARGIN_LEFT) / plotWidth));
    const time = viewport.start + position * (viewport.end - viewport.start);
    const index = buffer.nearest(time);
    return { time: index < 0 ? time : buffer.at(index, LiveRingBuffer.key(signals[0] ?? {
      name: "", address: -1,
    }))?.t ?? time, position };
  };
  const markerValues = (marker: Marker | null) => {
    if (!marker) return null;
    const index = buffer.nearest(marker.time);
    if (index < 0) return null;
    return signals.filter(signal => !hidden.includes(signal.id)).map(signal => ({
      signal,
      value: buffer.at(index, LiveRingBuffer.key(signal))?.y ?? Number.NaN,
    }));
  };
  const valuesA = markerValues(markerA);
  const valuesB = markerValues(markerB);
  const onWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    if (!buffer.length) return;
    const total = Math.max(MIN_WINDOW_MS, buffer.newest - buffer.oldest);
    const current = rangeMs <= 0 ? total : rangeMs;
    const next = Math.max(MIN_WINDOW_MS, Math.min(total, current * (event.deltaY > 0 ? 1.3 : 0.77)));
    setRangeMs(next);
    setPanMs(value => Math.min(Math.max(0, total - next), value));
  };
  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.shiftKey) {
      dragRef.current = { x: event.clientX, pan: panMs };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const marker = timeFromPointer(event);
    if (activeMarker === "A") setMarkerA(marker);
    else setMarkerB(marker);
    setActiveMarker(activeMarker === "A" ? "B" : "A");
  };
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      const duration = viewport.end - viewport.start;
      const delta = (event.clientX - dragRef.current.x) / plotWidth * duration;
      const maximum = Math.max(0, buffer.newest - buffer.oldest - duration);
      setPanMs(Math.max(0, Math.min(maximum, dragRef.current.pan + delta)));
    } else setCursor(timeFromPointer(event));
  };

  return <section className="panel plot-panel" aria-label={title}>
    <div className="panel-heading">
      <div><h2>{title}</h2><p>Canvas measurement scope · bounded typed-array history · min/max spike preservation</p></div>
      <span className="muted">{buffer.length.toLocaleString()} buffered frames</span>
    </div>
    <div className="toolbar chart-controls">
      <label className="field-group" htmlFor="chart-time-range">Time range
        <select id="chart-time-range" value={rangeMs}
          onChange={event => { setRangeMs(Number(event.target.value)); setPanMs(0); }}>
          <option value={0}>All buffered</option>
          <option value={5000}>Last 5 seconds</option>
          <option value={15000}>Last 15 seconds</option>
          <option value={60000}>Last minute</option>
          <option value={300000}>Last 5 minutes</option>
        </select>
      </label>
      <button className="button small" type="button" disabled={!panMs}
        onClick={() => setPanMs(0)}>Live edge</button>
      <button className="button small" type="button"
        onClick={() => { setMarkerA(null); setMarkerB(null); }}>Clear cursors</button>
      <button className="button small" type="button"
        aria-pressed={showTools} onClick={() => setShowTools(value => !value)}>
        {showTools ? "Hide tools" : "Measurement tools"}</button>
    </div>
    <div className="plot-legend">{signals.map(signal =>
      <button key={signal.id} type="button"
        className={hidden.includes(signal.id) ? "legend-item disabled" : "legend-item"}
        onClick={() => setHidden(previous => previous.includes(signal.id)
          ? previous.filter(id => id !== signal.id) : [...previous, signal.id])}
        aria-pressed={!hidden.includes(signal.id)}>
        <i style={{ background: signal.color }} />{signal.name}{signal.unit ? ` (${signal.unit})` : ""}
      </button>)}</div>
    <div ref={hostRef} className="chart-scroll">
      <canvas ref={canvasRef} className="timeseries live-canvas"
        style={{ width: "100%", height: canvasHeight, display: "block", touchAction: "pan-y" }}
        role="img" aria-label={`${title}; ${lanes.length} unit axes; ${buffer.length} sample frames`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
        onPointerLeave={() => { if (!dragRef.current) setCursor(null); }}
        onWheel={onWheel} />
    </div>
    {showTools && <div className="live-measure-tools" role="region" aria-label="Measurement cursor tools">
      <div><strong>Cursor A</strong><span>{markerA ? formatTime(markerA.time, monotonic) : "Click plot to set"}</span></div>
      <div><strong>Cursor B</strong><span>{markerB ? formatTime(markerB.time, monotonic) : "Click again to set"}</span></div>
      <div><strong>Δt</strong><span>{markerA && markerB
        ? `${Math.abs(markerB.time - markerA.time).toFixed(2)} ms` : "—"}</span></div>
      <div><strong>1 / Δt</strong><span>{markerA && markerB && markerA.time !== markerB.time
        ? `${(1000 / Math.abs(markerB.time - markerA.time)).toFixed(2)} Hz` : "—"}</span></div>
      {valuesA && valuesB && valuesA.map(({ signal, value }, i) =>
        <div key={signal.id}><strong>Δ {signal.name}</strong>
          <span>{valueLabel(valuesB[i].value - value)} {signal.unit}</span></div>)}
    </div>}
    <div className="chart-cursor-values" role="status" aria-live="off">
      {cursor ? <>
        <strong>{formatTime(cursor.time, monotonic)}</strong>
        {markerValues(cursor)?.map(({ signal, value }) =>
          <span key={signal.id}><i style={{ background: signal.color }} />
            {signal.name}: {valueLabel(value)} {signal.unit}</span>)}
      </> : <span className="muted">Click to place A/B cursors · Shift+drag to pan · mouse wheel to zoom.</span>}
    </div>
    <p className="muted chart-note">Each physical unit has its own Y axis. Rendering is
      Canvas-based and peak-preserving; the backend acquisition remains independent
      of display refresh. Cursor readings are nearest stored samples.</p>
  </section>;
}
