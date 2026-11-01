import type { MeasurementFrame, SignalDefinition } from "../core/api";

/** Local visualization-only discontinuity; not an invented wire-contract field. */
export type ChartFrame = MeasurementFrame & { gapBefore?: number };
export type PlotColumn = Array<number | null>;

/**
 * Keep every physical sample at its original host timestamp.
 * A null-only midpoint is a Canvas line break, never a fabricated ECU value.
 * uPlot requires null (rather than NaN) to interrupt spanGaps:false series.
 */
export function alignedPlotData(
  frames: readonly ChartFrame[],
  signals: readonly SignalDefinition[],
  maxPoints = 1200,
): PlotColumn[] {
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 8)
    throw new Error("Minimum chart capacity is eight points");
  if (!signals.length || !frames.length) return [[], ...signals.map(() => [])];

  const ordered = [...frames].filter(frame => Number.isFinite(frame.timestamp_ms))
    .sort((a, b) => a.timestamp_ms - b.timestamp_ms ||
      (a.sequence ?? 0) - (b.sequence ?? 0));
  const x: number[] = [];
  const ys: PlotColumn[] = signals.map(() => []);
  const boundaries = new Set<number>();
  let previous: ChartFrame | undefined;
  for (const frame of ordered) {
    const time = frame.timestamp_ms;
    if (previous && frame.gapBefore !== undefined && time > previous.timestamp_ms) {
      x.push(previous.timestamp_ms + (time - previous.timestamp_ms) / 2);
      for (const y of ys) y.push(null);
      boundaries.add(x.length - 1);
    }
    const last = x.length - 1;
    if (last >= 0 && x[last] === time) {
      // A later backend sequence supersedes the same host millisecond.
      x.pop();
      for (const y of ys) y.pop();
      boundaries.delete(last);
    }
    x.push(time);
    const lookup = new Map(frame.samples.map(sample =>
      [sample.address + ":" + sample.name, sample.value] as const));
    for (let index = 0; index < signals.length; index++) {
      const signal = signals[index];
      const value = lookup.get(signal.address + ":" + signal.name);
      const valid = value !== undefined && Number.isFinite(value);
      ys[index].push(valid ? value : null);
      if (!valid) boundaries.add(x.length - 1);
    }
    previous = frame;
  }

  if (x.length <= maxPoints) return [x, ...ys];

  // Preserve all visible gaps before extrema so decimation never joins across
  // a missing/invalid interval. In gap-dense data, show the newest contiguous
  // source window instead of exceeding the Canvas vertex budget.
  const mandatory = new Set<number>([0, x.length - 1]);
  for (const boundary of boundaries) mandatory.add(boundary);
  if (mandatory.size > maxPoints) {
    const from = x.length - maxPoints;
    return [x.slice(from), ...ys.map(y => y.slice(from))];
  }

  const selected = new Set(mandatory);
  const lanes = Math.max(1, signals.length);
  const buckets = Math.floor((maxPoints - mandatory.size) / (2 * lanes));
  if (buckets > 0) {
    const size = Math.ceil((x.length - 2) / buckets);
    for (let from = 1; from < x.length - 1; from += size) {
      const to = Math.min(x.length - 1, from + size);
      for (const y of ys) {
        let min = -1, max = -1;
        for (let i = from; i < to; i++) {
          if (y[i] === null) continue;
          if (min === -1 || y[i]! < y[min]!) min = i;
          if (max === -1 || y[i]! > y[max]!) max = i;
        }
        if (min !== -1) selected.add(min);
        if (max !== -1) selected.add(max);
      }
    }
  }
  const indices = [...selected].sort((a, b) => a - b);
  return [indices.map(i => x[i]), ...ys.map(y => indices.map(i => y[i]))];
}

export type PlotCursor = { time: number; value: number | null };

/** Cursors always report actual received values, never gap placeholders. */
export function cursorValue(
  frames: readonly MeasurementFrame[],
  signal: SignalDefinition,
  time: number | null,
): PlotCursor | null {
  if (time === null || !frames.length) return null;
  let nearest: MeasurementFrame | null = null;
  let best = Infinity;
  for (const frame of frames) {
    const distance = Math.abs(frame.timestamp_ms - time);
    if (distance < best) { best = distance; nearest = frame; }
  }
  if (!nearest) return null;
  const sample = nearest.samples.find(s => s.address === signal.address && s.name === signal.name);
  return { time: nearest.timestamp_ms,
    value: sample && Number.isFinite(sample.value) ? sample.value : null };
}
