import type { MeasurementFrame } from "../core/api";

export type TimeDomain = { earliest: number; latest: number };
export type TimeViewport = { start: number; end: number };
export type ViewSettings = { rangeMs: number; panMs: number };
const MIN_WINDOW_MS = 20;

/** Ignore malformed host timestamps rather than deriving invalid chart scales. */
export function frameTimeDomain(frames: readonly MeasurementFrame[]): TimeDomain | null {
  let earliest = Infinity;
  let latest = -Infinity;
  for (const frame of frames) {
    if (!Number.isFinite(frame.timestamp_ms)) continue;
    earliest = Math.min(earliest, frame.timestamp_ms);
    latest = Math.max(latest, frame.timestamp_ms);
  }
  return earliest <= latest ? { earliest, latest } : null;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Zoom at the pointer's time, preserving its relative position in the viewport. */
export function zoomViewport(
  domain: TimeDomain, viewport: TimeViewport, factor: number, anchor: number,
): ViewSettings {
  const available = domain.latest - domain.earliest;
  if (!Number.isFinite(available) || available <= MIN_WINDOW_MS ||
      !Number.isFinite(factor) || factor <= 0 || !Number.isFinite(anchor))
    return { rangeMs: 0, panMs: 0 };

  const duration = clamp(viewport.end - viewport.start, MIN_WINDOW_MS, available);
  const nextRange = clamp(Math.round(duration * factor), MIN_WINDOW_MS, available);
  const fraction = clamp((anchor - viewport.start) / duration, 0, 1);
  const start = clamp(anchor - fraction * nextRange,
    domain.earliest, domain.latest - nextRange);
  return { rangeMs: nextRange, panMs: Math.max(0, domain.latest - start - nextRange) };
}

/** Positive horizontal drag pans toward older data without leaving the buffer. */
export function panViewport(
  domain: TimeDomain, viewport: TimeViewport, dragMs: number,
): ViewSettings {
  const available = domain.latest - domain.earliest;
  if (!Number.isFinite(available) || available <= 0 || !Number.isFinite(dragMs))
    return { rangeMs: 0, panMs: 0 };
  const duration = clamp(viewport.end - viewport.start, 1, available);
  const panMs = clamp(domain.latest - viewport.end + dragMs,
    0, available - duration);
  return { rangeMs: duration, panMs };
}

/** Frequency is the absolute reciprocal of cursor separation, never Infinity. */
export function cursorFrequencyHz(a: number | null, b: number | null): number | null {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const delta = Math.abs(b - a);
  return delta > 0 ? 1000 / delta : null;
}
