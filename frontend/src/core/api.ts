import { apiV1 } from "./apiV1";

export type Health = { status: string; mode: string; version: string };
export type SessionStatus = { connected: boolean; transport: string };
export type ElfSymbol = { name: string; address: number; address_hex: string; size: number; kind: string };
export type ElfResult = { symbols: ElfSymbol[]; count: number };
export type ReadResult = { address: number; bytes: number[]; hex: string };
export type SignalType = "u8" | "i8" | "u16" | "i16" | "u32" | "i32" | "f32" | "f64";
export type SignalDefinition = { id: string; name: string; address: number; value_type: SignalType; unit: string; color: string };
export type MeasurementSample = { name: string; address: number; value: number };
export type MeasurementFrame = {
  timestamp_ms: number;
  samples: MeasurementSample[];
  acquisition_id?: string;
  sequence?: number;
  monotonic_elapsed_ms?: number;
  dropped_since_previous?: number;
};

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = "ApiError"; }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, signal: init.signal ?? AbortSignal.timeout(10000) });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = body && typeof body === "object" && "error" in body
      ? String(body.error) : `HTTP ${response.status}: ${response.statusText}`;
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => apiV1.health(),
  status: () => apiV1.status(),
  connect: () => request<SessionStatus>("/api/xcp/connect", { method: "POST" }),
  disconnect: () => request<SessionStatus>("/api/xcp/disconnect", { method: "POST" }),
  read: (address: number, count: number) => apiV1.read(address, count),
  inspectElf: (file: File) => request<ElfResult>("/api/elf/inspect", {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file,
    signal: AbortSignal.timeout(30000),
  }),
};

export function parseAddress(value: string): number {
  const text = value.trim();
  if (!/^(0x[0-9a-f]+|[0-9]+)$/i.test(text)) throw new Error("Enter a decimal or hexadecimal address");
  const address = Number(text);
  if (!Number.isSafeInteger(address) || address < 0 || address > 0xffffffff)
    throw new Error("Address must be a 32-bit unsigned integer");
  return address;
}

export function decodeValue(bytes: number[], type: SignalType): number {
  const size = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, f32: 4, f64: 8 }[type];
  if (bytes.length < size) throw new Error("Insufficient data for selected type");
  const view = new DataView(Uint8Array.from(bytes.slice(0, size)).buffer);
  switch (type) {
    case "u8": return view.getUint8(0);
    case "i8": return view.getInt8(0);
    case "u16": return view.getUint16(0, true);
    case "i16": return view.getInt16(0, true);
    case "u32": return view.getUint32(0, true);
    case "i32": return view.getInt32(0, true);
    case "f32": return view.getFloat32(0, true);
    case "f64": return view.getFloat64(0, true);
  }
}
