import type { MeasurementFrame, SignalDefinition } from "../core/api";

export type ChartPoint = { t: number; y: number };
export type ChartAxis = { low: number; high: number };
export type ChartViewport = { start: number; end: number };

/** Choose an explicit wall-clock window. Zero means all buffered frames. */
export function chartViewport(
  frames: readonly MeasurementFrame[],
  rangeMs: number,
  panMs: number,
): ChartViewport {
  if (!frames.length) return { start: 0, end: 1 };
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const frame of frames) {
    if (!Number.isFinite(frame.timestamp_ms)) continue;
    minimum = Math.min(minimum, frame.timestamp_ms);
    maximum = Math.max(maximum, frame.timestamp_ms);
  }
  if (!Number.isFinite(minimum)) return { start: 0, end: 1 };
  if (rangeMs <= 0) return { start: minimum, end: Math.max(maximum, minimum + 1) };

  const duration = Math.max(1, rangeMs);
  const latest = maximum - Math.max(0, panMs);
  const start = Math.max(minimum, latest - duration);
  const end = Math.max(start + 1, Math.min(maximum, start + duration));
  return { start, end };
}

export function chartAxis(points: readonly ChartPoint[]): ChartAxis {
  if (!points.length) return { low: 0, high: 1 };
  let lowest = Infinity;
  let highest = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.y)) continue;
    lowest = Math.min(lowest, point.y);
    highest = Math.max(highest, point.y);
  }
  if (!Number.isFinite(lowest)) return { low: 0, high: 1 };
  const range = highest - lowest;
  const margin = range > 0 ? range * 0.1 : Math.max(1, Math.abs(highest) * 0.05);
  return { low: lowest - margin, high: highest + margin };
}

/**
 * Preserve first/last and both extrema in each interior bucket.
 * Bounded vertices avoid feeding tens of thousands of values to SVG.
 */
export function decimateExtrema(points: readonly ChartPoint[], limit = 600): ChartPoint[] {
  if (!Number.isInteger(limit) || limit < 4) throw new Error("Chart vertex limit must be at least 4");
  if (points.length <= limit) return [...points];

  const inner = points.slice(1, -1);
  const buckets = Math.floor((limit - 2) / 2);
  const size = Math.ceil(inner.length / buckets);
  const reduced: ChartPoint[] = [points[0]];

  for (let begin = 0; begin < inner.length; begin += size) {
    const end = Math.min(inner.length, begin + size);
    let minIndex = begin;
    let maxIndex = begin;
    for (let i = begin + 1; i < end; i++) {
      if (inner[i].y < inner[minIndex].y) minIndex = i;
      if (inner[i].y > inner[maxIndex].y) maxIndex = i;
    }
    if (minIndex < maxIndex) {
      reduced.push(inner[minIndex]);
      reduced.push(inner[maxIndex]);
    } else if (maxIndex < minIndex) {
      reduced.push(inner[maxIndex]);
      reduced.push(inner[minIndex]);
    } else {
      reduced.push(inner[minIndex]);
    }
  }
  reduced.push(points[points.length - 1]);
  return reduced;
}

export function nearestChartFrame(
  frames: readonly MeasurementFrame[],
  timestamp: number,
): MeasurementFrame | null {
  if (!frames.length || !Number.isFinite(timestamp)) return null;
  let nearest: MeasurementFrame | null = null;
  let distance = Infinity;
  for (const frame of frames) {
    const delta = Math.abs(frame.timestamp_ms - timestamp);
    if (delta < distance) {
      nearest = frame;
      distance = delta;
    }
  }
  return nearest;
}

/** Multiple physical units must not be placed on one unlabelled Y axis. */
export function groupSignalsByUnit(signals: readonly SignalDefinition[]): Array<{
  unit: string;
  signals: SignalDefinition[];
}> {
  const groups = new Map<string, SignalDefinition[]>();
  for (const signal of signals) {
    const unit = signal.unit.trim() || "raw";
    const members = groups.get(unit) ?? [];
    members.push(signal);
    groups.set(unit, members);
  }
  return [...groups].map(([unit, members]) => ({ unit, signals: members }));
}
