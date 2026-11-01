/**
 * Browser-observed live telemetry helpers.
 *
 * We deliberately use the browser monotonic clock for data freshness/rate:
 * host epoch timestamps produced by the ECU proxy can jump when wall time is
 * adjusted and do not describe browser delivery latency.
 */

export type LiveIndicator = "disconnected" | "connecting" | "waiting" | "live" | "stale" | "error";

export function freshnessLimitMs(intervalMs: number): number {
  const configured = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 100;
  return Math.max(1500, Math.min(30000, configured * 4));
}

export function sampleAgeMs(now: number, receivedAt: number | null): number | null {
  if (receivedAt === null || !Number.isFinite(now) || !Number.isFinite(receivedAt)) return null;
  return Math.max(0, now - receivedAt);
}

export function liveIndicator(
  connected: boolean,
  state: "idle" | "connecting" | "streaming" | "error",
  backendRunning: boolean,
  ageMs: number | null,
  intervalMs: number,
): LiveIndicator {
  if (!connected) return "disconnected";
  if (state === "error") return "error";
  if (state === "connecting") return "connecting";
  if (state !== "streaming" || !backendRunning) return "disconnected";
  if (ageMs === null) return "waiting";
  return ageMs <= freshnessLimitMs(intervalMs) ? "live" : "stale";
}

/** Never count duplicate/out-of-order batches as newly lost samples. */
export function skippedSequences(previous: number | null, current: number): number {
  if (previous === null || !Number.isSafeInteger(current) || !Number.isSafeInteger(previous) ||
      current <= previous) return 0;
  return Math.max(0, current - previous - 1);
}

/** A bounded, five-second browser receive-rate estimate (not ECU sample rate). */
export function recentReceiveTimes(
  previous: readonly number[], now: number, windowMs = 5000, limit = 512,
): number[] {
  if (!Number.isFinite(now)) return [...previous];
  const minimum = now - windowMs;
  const result = previous.filter(value => Number.isFinite(value) && value >= minimum && value <= now);
  result.push(now);
  return result.slice(-limit);
}

export function measuredReceiveHz(times: readonly number[]): number {
  if (times.length < 2) return 0;
  const elapsed = times[times.length - 1] - times[0];
  return elapsed > 0 ? Math.round(((times.length - 1) * 10000) / elapsed) / 10 : 0;
}

/** Only reattach to an existing backend acquisition: never create a new one on reconnect. */
export function reconnectDelayMs(attempt: number): number {
  const exponent = Number.isFinite(attempt) ? Math.max(0, Math.min(5, Math.floor(attempt))) : 0;
  return Math.min(10000, 500 * 2 ** exponent);
}
