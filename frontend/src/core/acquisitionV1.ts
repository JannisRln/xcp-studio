import type { MeasurementSample, SignalType } from "./api";
import { parseErrorV1, VersionedApiError } from "./apiV1";

export type AcquisitionSignal = {
  name: string;
  address: number;
  value_type: SignalType;
};

export type AcquisitionStatus = {
  schema_version: 1;
  acquisition_id: string;
  state: "running" | "stopped" | "failed";
  sampling_mode: "polling";
  interval_ms: number;
  signal_count: number;
  signals: AcquisitionSignal[];
  sequence: number;
  subscriber_count: number;
  dropped_subscriber_frames: number;
  error: string | null;
};

export type AcquisitionMeasurementSample = MeasurementSample & {
  /** Optional v1 metadata; absent on older v1 producers. */
  value_type?: SignalType;
  quality?: "valid";
  address_origin?: "manual";
};

export type AcquisitionSamplesEvent = {
  type: "samples";
  schema_version: 1;
  acquisition_id: string;
  sequence: number;
  timestamp_ms: number;
  monotonic_elapsed_ms: number;
  dropped_since_previous: number;
  timestamp_origin?: "host_utc_after_reads";
  monotonic_clock?: "acquisition_elapsed";
  samples: AcquisitionMeasurementSample[];
};

export type AcquisitionGapEvent = {
  type: "gap";
  schema_version: 1;
  acquisition_id: string;
  dropped: number;
  scope?: "subscriber";
};

export type AcquisitionTerminalEvent = {
  type: "status";
  schema_version: 1;
  acquisition_id: string;
  state: "stopped" | "failed";
  reason: string;
};

export type AcquisitionEvent = AcquisitionSamplesEvent | AcquisitionGapEvent | AcquisitionTerminalEvent;

const TYPES: SignalType[] = ["u8", "i8", "u16", "i16", "u32", "i32", "f32", "f64"];

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function uint(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && new TextEncoder().encode(value).length <= 128;
}

const WIDTH: Record<SignalType, number> = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, f32: 4, f64: 8 };

function typedValue(value: number, type: SignalType): boolean {
  if (type === "f32" || type === "f64") return Number.isFinite(value);
  const ranges: Record<Exclude<SignalType, "f32" | "f64">, [number, number]> = {
    u8: [0, 255], i8: [-128, 127], u16: [0, 65535], i16: [-32768, 32767],
    u32: [0, 4294967295], i32: [-2147483648, 2147483647],
  };
  const [min, max] = ranges[type];
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function signal(value: unknown): value is AcquisitionSignal {
  return object(value) && identifier(value.name) && uint(value.address) &&
    value.address <= 0xffffffff && TYPES.includes(value.value_type as SignalType) &&
    value.address + WIDTH[value.value_type as SignalType] - 1 <= 0xffffffff;
}

function sample(value: unknown): value is AcquisitionMeasurementSample {
  if (!object(value) || !identifier(value.name) || !uint(value.address) ||
      value.address > 0xffffffff || typeof value.value !== "number" || !Number.isFinite(value.value)) return false;
  if (value.quality !== undefined && value.quality !== "valid") return false;
  if (value.address_origin !== undefined && value.address_origin !== "manual") return false;
  if (value.value_type !== undefined) {
    if (!TYPES.includes(value.value_type as SignalType)) return false;
    const type = value.value_type as SignalType;
    if (value.address + WIDTH[type] - 1 > 0xffffffff || !typedValue(value.value, type)) return false;
  }
  return true;
}

export function parseAcquisitionStatus(value: unknown): AcquisitionStatus {
  if (!object(value) || value.schema_version !== 1 || !identifier(value.acquisition_id) ||
      !["running", "stopped", "failed"].includes(String(value.state)) ||
      value.sampling_mode !== "polling" || !uint(value.interval_ms) ||
      value.interval_ms < 20 || value.interval_ms > 10000 ||
      !uint(value.signal_count) || value.signal_count < 1 || value.signal_count > 64 ||
      !Array.isArray(value.signals) || value.signals.length !== value.signal_count ||
      !value.signals.every((item: unknown) => signal(item)) ||
      !uint(value.sequence) || !uint(value.subscriber_count) ||
      !uint(value.dropped_subscriber_frames) ||
      (value.error !== null && typeof value.error !== "string")) {
    throw new Error("Malformed or unsupported v1 acquisition status");
  }
  return value as unknown as AcquisitionStatus;
}

export function parseAcquisitionEvent(value: unknown): AcquisitionEvent {
  if (!object(value) || value.schema_version !== 1 || !identifier(value.acquisition_id)) {
    throw new Error("Malformed or unsupported v1 acquisition event");
  }
  if (value.type === "samples") {
    if (!uint(value.sequence) || !uint(value.timestamp_ms) ||
        !uint(value.monotonic_elapsed_ms) || !uint(value.dropped_since_previous) ||
        (value.timestamp_origin !== undefined && value.timestamp_origin !== "host_utc_after_reads") ||
        (value.monotonic_clock !== undefined && value.monotonic_clock !== "acquisition_elapsed") ||
        !Array.isArray(value.samples) || value.samples.length > 64 ||
        !value.samples.every((item: unknown) => sample(item)))
      throw new Error("Invalid XCP sample event");
    return value as unknown as AcquisitionSamplesEvent;
  }
  if (value.type === "gap") {
    if (!uint(value.dropped) || value.dropped < 1 ||
        (value.scope !== undefined && value.scope !== "subscriber")) throw new Error("Invalid acquisition gap");
    return value as unknown as AcquisitionGapEvent;
  }
  if (value.type === "status") {
    if (value.state !== "stopped" && value.state !== "failed") throw new Error("Invalid acquisition state");
    if (value.reason !== "operator_stop" && value.reason !== "xcp_read_error")
      throw new Error("Invalid acquisition reason");
    return value as unknown as AcquisitionTerminalEvent;
  }
  throw new Error("Unsupported acquisition event type");
}

export function acquisitionWsUrl(protocol: string, host: string, id: string): string {
  return `${protocol === "https:" ? "wss:" : "ws:"}//${host}/api/v1/acquisitions/${encodeURIComponent(id)}/stream`;
}

async function apiCall<T>(path: string, decode: (payload: unknown) => T, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(10000),
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`API returned invalid JSON (HTTP ${response.status})`);
  }
  if (!response.ok) {
    try {
      const failure = parseErrorV1(payload);
      throw new VersionedApiError(
        response.status,
        failure.error.code,
        failure.error.request_id,
        failure.error.retryable,
        failure.error.message,
      );
    } catch (error) {
      if (error instanceof VersionedApiError) throw error;
      throw new Error(`Unrecognized API error (HTTP ${response.status})`);
    }
  }
  return decode(payload);
}

export const acquisitionApi = {
  create(intervalMs: number, signals: AcquisitionSignal[]) {
    if (!Number.isInteger(intervalMs) || intervalMs < 20 || intervalMs > 10000)
      throw new Error("Sample interval must be between 20 and 10000 ms");
    if (!signals.length || signals.length > 64 || !signals.every(signal))
      throw new Error("Select 1 to 64 signals with valid addresses and value types");
    if (new Set(signals.map(item => item.name)).size !== signals.length)
      throw new Error("Signal names must be unique");
    return apiCall("/api/v1/acquisitions", parseAcquisitionStatus, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interval_ms: intervalMs, signals }),
    });
  },
  current: () => apiCall("/api/v1/acquisitions/current", parseAcquisitionStatus),
  status: (id: string) => apiCall(`/api/v1/acquisitions/${encodeURIComponent(id)}`, parseAcquisitionStatus),
  stop: (id: string) => apiCall(`/api/v1/acquisitions/${encodeURIComponent(id)}/stop`, parseAcquisitionStatus, {
    method: "POST",
  }),
};
