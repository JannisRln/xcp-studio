import type { MeasurementFrame, SignalDefinition } from "../core/api";

/** Compact aligned arrays for uPlot; do not send one React element per sample. */
export function alignedPlotData(
  frames: readonly MeasurementFrame[],
  signals: readonly SignalDefinition[],
  maxPoints = 1200,
): number[][] {
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 8)
    throw new Error("Minimum chart capacity is eight points");
  if (!signals.length || !frames.length) return [[], ...signals.map(() => [])];

  // uPlot requires ascending X. Duplicate host timestamps are merged.
  const ordered = [...frames].filter(frame => Number.isFinite(frame.timestamp_ms))
    .sort((a, b) => a.timestamp_ms - b.timestamp_ms);
  const x: number[] = [];
  const ys = signals.map(() => [] as number[]);
  for (const frame of ordered) {
    if (x.length && x[x.length - 1] === frame.timestamp_ms) {
      // A later sequence for the same host millisecond wins.
      x.pop();
      for (const y of ys) y.pop();
    }
    x.push(frame.timestamp_ms);
    for (let index = 0; index < signals.length; index++) {
      const signal = signals[index];
      const value = frame.samples.find(sample => sample.address === signal.address &&
        sample.name === signal.name)?.value;
      ys[index].push(value !== undefined && Number.isFinite(value) ? value : NaN);
    }
  }

  if (x.length <= maxPoints) return [x, ...ys];

  // Keep the first/last frame, plus min/max of each signal in every bucket.
  // A single shared index set preserves proper time alignment for all series.
  const selected = new Set<number>([0, x.length - 1]);
  const interior = x.length - 2;
  const lanes = Math.max(1, signals.length);
  const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / (2 * lanes)));
  const bucketSize = Math.ceil(interior / bucketCount);
  for (let from = 1; from < x.length - 1; from += bucketSize) {
    const to = Math.min(x.length - 1, from + bucketSize);
    for (const y of ys) {
      let min = -1, max = -1;
      for (let i = from; i < to; i++) {
        if (!Number.isFinite(y[i])) continue;
        if (min === -1 || y[i] < y[min]) min = i;
        if (max === -1 || y[i] > y[max]) max = i;
      }
      if (min !== -1) selected.add(min);
      if (max !== -1) selected.add(max);
    }
  }
  const indices = [...selected].sort((a, b) => a - b);
  return [indices.map(i => x[i]), ...ys.map(y => indices.map(i => y[i]))];
}

export type PlotCursor = { time: number; value: number | null };

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
  return { time: nearest.timestamp_ms, value: sample?.value ?? null };
}
