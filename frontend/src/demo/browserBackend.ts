import type { AcquisitionSignal, AcquisitionStatus } from "../core/acquisitionV1";
import type { MeasurementSample, SignalType } from "../core/api";

/** Browser-only demo of the existing v1 REST/WS contract. No ECU access. */
const TYPES: SignalType[] = ["u8","i8","u16","i16","u32","i32","f32","f64"];
export function simulatedValue(signal: AcquisitionSignal, elapsedMs: number): number {
  const t = elapsedMs / 1000;
  const value = signal.address === 4096
    ? 2200 + 420 * Math.sin(t * .55) + 165 * Math.sin(t * 2.7)
    : signal.address === 4100
      ? 87 + 4.3 * Math.sin(t * .13) + .7 * Math.sin(t * .9)
      : 40 + 25 * Math.sin(t * (.5 + (signal.address % 11) * .04));
  switch (signal.value_type) {
    case "u8": return Math.max(0, Math.min(255, Math.round(value)));
    case "i8": return Math.max(-128, Math.min(127, Math.round(value)));
    case "u16": return Math.max(0, Math.min(65535, Math.round(value)));
    case "i16": return Math.max(-32768, Math.min(32767, Math.round(value)));
    case "u32": return Math.max(0, Math.round(value));
    case "i32": return Math.round(value);
    default: return value;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
let requestId = 0;
function failure(status: number, code: string, message: string): Response {
  return json({ schema_version: 1, error: {
    code, message, request_id: "demo-" + (++requestId), retryable: false,
  } }, status);
}

function demoCloseEvent(code: number, reason = ""): CloseEvent {
  // Node/Vitest lacks the browser-specific CloseEvent constructor.
  if (typeof CloseEvent === "function")
    return new CloseEvent("close", { code, reason, wasClean: true });
  return Object.assign(new Event("close"), { code, reason, wasClean: true }) as CloseEvent;
}

type DemoPacket = { type: string; schema_version: 1; acquisition_id: string;
  [key: string]: unknown };
type Run = {
  status: AcquisitionStatus;
  started: number;
  timer: number;
  sockets: Set<DemoSocket>;
};

class DemoSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readonly url: string;
  readonly protocol = "";
  readonly extensions = "";
  binaryType: BinaryType = "blob";
  bufferedAmount = 0;
  readyState = 0;
  onopen: WebSocket["onopen"] = null;
  onmessage: WebSocket["onmessage"] = null;
  onerror: WebSocket["onerror"] = null;
  onclose: WebSocket["onclose"] = null;
  private readonly id: string;

  constructor(url: string, private readonly owner: DemoBackend) {
    super();
    this.url = url;
    const match = new URL(url, window.location.href).pathname.match(
      /\/api\/v1\/acquisitions\/([^/]+)\/stream$/);
    this.id = match ? decodeURIComponent(match[1]) : "";
    queueMicrotask(() => {
      if (this.readyState !== 0) return;
      if (!owner.subscribe(this.id, this)) {
        this.readyState = 3;
        this.onerror?.call(this as unknown as WebSocket, new Event("error"));
        this.onclose?.call(this as unknown as WebSocket,
          demoCloseEvent(1008));
        return;
      }
      this.readyState = 1;
      const event = new Event("open");
      this.onopen?.call(this as unknown as WebSocket, event);
      this.dispatchEvent(event);
    });
  }

  deliver(packet: DemoPacket): void {
    if (this.readyState !== 1) return;
    const event = new MessageEvent("message", { data: JSON.stringify(packet) });
    this.onmessage?.call(this as unknown as WebSocket, event);
    this.dispatchEvent(event);
  }

  send(_data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== 1) throw new Error("Demo socket is closed");
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.owner.unsubscribe(this.id, this);
    const event = demoCloseEvent(code, reason);
    this.onclose?.call(this as unknown as WebSocket, event);
    this.dispatchEvent(event);
  }
}

/** A single in-tab acquisition shared by any number of demo subscribers. */
export class DemoBackend {
  private connected = false;
  private nextId = 0;
  private current: Run | null = null;

  constructor(autoStart = false) {
    // The public preview opens with moving sample data already visible.
    // It never connects to real CAN/XCP hardware.
    if (autoStart) {
      this.connected = true;
      const signals: AcquisitionSignal[] = [
        { name: "Engine speed", address: 4096, value_type: "u32" },
        { name: "Coolant temperature", address: 4100, value_type: "f32" },
      ];
      const status: AcquisitionStatus = {
        schema_version: 1, acquisition_id: "demo-acq-" + (++this.nextId),
        state: "running", sampling_mode: "polling", interval_ms: 100,
        signal_count: signals.length, signals, sequence: 0,
        subscriber_count: 0, dropped_subscriber_frames: 0, error: null,
      };
      const run: Run = { status, started: performance.now(), timer: 0, sockets: new Set() };
      this.current = run;
      run.timer = window.setInterval(() => this.emit(), 100);
    }
  }

  openSocket(url: string): WebSocket {
    return new DemoSocket(url, this) as unknown as WebSocket;
  }

  subscribe(id: string, socket: DemoSocket): boolean {
    const run = this.current;
    if (!run || run.status.acquisition_id !== id || run.status.state !== "running" ||
        run.sockets.size >= 16) return false;
    run.sockets.add(socket);
    run.status.subscriber_count = run.sockets.size;
    return true;
  }

  unsubscribe(id: string, socket: DemoSocket): void {
    const run = this.current;
    if (!run || run.status.acquisition_id !== id) return;
    run.sockets.delete(socket);
    run.status.subscriber_count = run.sockets.size;
  }

  private emit(): void {
    const run = this.current;
    if (!run || run.status.state !== "running") return;
    const elapsed = performance.now() - run.started;
    run.status.sequence++;
    const samples: MeasurementSample[] = run.status.signals.map(signal => ({
      name: signal.name, address: signal.address,
      value: simulatedValue(signal, elapsed),
    }));
    const packet: DemoPacket = {
      type: "samples", schema_version: 1, acquisition_id: run.status.acquisition_id,
      sequence: run.status.sequence, timestamp_ms: Date.now(),
      monotonic_elapsed_ms: Math.round(elapsed), dropped_since_previous: 0, samples,
    };
    for (const socket of run.sockets) socket.deliver(packet);
  }

  stop(): void {
    const run = this.current;
    if (!run || run.status.state !== "running") return;
    run.status.state = "stopped";
    window.clearInterval(run.timer);
    const packet: DemoPacket = { type: "status", schema_version: 1,
      acquisition_id: run.status.acquisition_id, state: "stopped", reason: "operator_stop" };
    for (const socket of [...run.sockets]) {
      socket.deliver(packet);
      socket.close();
    }
  }

  async handle(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const original = typeof input === "string" ? input
      : input instanceof URL ? input.href : input.url;
    const path = new URL(original, window.location.href).pathname;
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

    if (path === "/api/v1/health" && method === "GET")
      return json({ schema_version: 1, status: "ok",
        mode: "browser-demo", version: "0.1.0-demo" });
    if (path === "/api/v1/sessions/current" && method === "GET")
      return json({ schema_version: 1, connected: this.connected, transport: "browser-demo" });
    if (path === "/api/xcp/connect" && method === "POST") {
      this.connected = true;
      return json({ connected: true, transport: "browser-demo" });
    }
    if (path === "/api/xcp/disconnect" && method === "POST") {
      this.stop();
      this.connected = false;
      return json({ connected: false, transport: "browser-demo" });
    }

    if (path === "/api/v1/acquisitions/current" && method === "GET")
      return this.current ? json(this.current.status)
        : failure(404, "ACQUISITION_NOT_FOUND", "No demo acquisition exists");

    if (path === "/api/v1/acquisitions" && method === "POST") {
      if (!this.connected) return failure(409, "XCP_SESSION_DISCONNECTED", "Connect demo simulator first");
      if (this.current?.status.state === "running") return failure(409,
        "ACQUISITION_ALREADY_RUNNING", "A demo acquisition is running");
      let payload: { interval_ms: number; signals: AcquisitionSignal[] };
      try { payload = JSON.parse(String(init.body ?? "{}")); }
      catch { return failure(400, "INVALID_JSON", "Invalid acquisition JSON"); }
      if (!Number.isInteger(payload.interval_ms) || payload.interval_ms < 20 ||
          payload.interval_ms > 10000)
        return failure(422, "INVALID_SAMPLE_INTERVAL", "Interval must be 20–10000ms");
      if (!Array.isArray(payload.signals) || payload.signals.length === 0 ||
          payload.signals.length > 64 ||
          payload.signals.some(signal => !signal || typeof signal.name !== "string" ||
            signal.name.trim().length === 0 || signal.name.length > 128 ||
            !Number.isSafeInteger(signal.address) || signal.address < 0 ||
            signal.address > 0xffffffff || !TYPES.includes(signal.value_type)) ||
          new Set(payload.signals.map(signal => signal.name)).size !== payload.signals.length)
        return failure(422, "INVALID_SIGNALS", "Invalid demo signal selection");

      const id = "demo-acq-" + (++this.nextId);
      const status: AcquisitionStatus = {
        schema_version: 1, acquisition_id: id, state: "running",
        sampling_mode: "polling", interval_ms: payload.interval_ms,
        signal_count: payload.signals.length, signals: payload.signals,
        sequence: 0, subscriber_count: 0, dropped_subscriber_frames: 0, error: null,
      };
      this.current = { status, started: performance.now(), timer: 0, sockets: new Set() };
      this.current.timer = window.setInterval(() => this.emit(), payload.interval_ms);
      return json(status, 201);
    }

    const match = path.match(/^\/api\/v1\/acquisitions\/([^/]+)(\/stop)?$/);
    if (match && this.current && decodeURIComponent(match[1]) === this.current.status.acquisition_id) {
      if (match[2] === "/stop" && method === "POST") this.stop();
      if ((method === "GET" && !match[2]) || (method === "POST" && match[2])) {
        return json(this.current.status);
      }
    }
    if (match) return failure(404, "ACQUISITION_NOT_FOUND", "Unknown demo acquisition");

    if (path === "/api/v1/sessions/current/reads" && method === "POST") {
      if (!this.connected) return failure(409, "XCP_SESSION_DISCONNECTED", "Connect demo first");
      let payload: {address: number; count: number};
      try { payload = JSON.parse(String(init.body ?? "{}")); }
      catch { return failure(400, "INVALID_JSON", "Malformed read JSON"); }
      if (!Number.isSafeInteger(payload.address) || payload.address < 0 ||
          payload.address > 0xffffffff || !Number.isSafeInteger(payload.count) ||
          payload.count < 1 || payload.count > 4096 ||
          payload.address + payload.count - 1 > 0xffffffff)
        return failure(422, "INVALID_ADDRESS_RANGE", "Invalid read length or address");
      const bytes = new Uint8Array(payload.count);
      if (payload.address === 4096 && payload.count >= 4)
        new DataView(bytes.buffer).setUint32(0, Math.round(simulatedValue(
          { name: "Engine speed", address: 4096, value_type: "u32" }, performance.now())), true);
      if (payload.address === 4100 && payload.count >= 4)
        new DataView(bytes.buffer).setFloat32(0, simulatedValue(
          { name: "Coolant", address: 4100, value_type: "f32" }, performance.now()), true);
      return json({ schema_version: 1, address: payload.address, bytes: [...bytes],
        hex: [...bytes].map(b => b.toString(16).toUpperCase().padStart(2, "0")).join(" ") });
    }
    if (path === "/api/elf/inspect")
      return json({ error: "ELF parsing requires native Rust backend, unavailable in static demo" }, 501);
    return failure(404, "DEMO_ROUTE_UNAVAILABLE", "Unavailable in browser demo");
  }
}

export function installBrowserDemo(): () => void {
  const backend = new DemoBackend(true);
  const originalFetch = window.fetch;
  const originalWebSocket = window.WebSocket;
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input
      : input instanceof URL ? input.href : input.url;
    if (new URL(raw, window.location.href).pathname.startsWith("/api/"))
      return backend.handle(input, init);
    return originalFetch.call(window, input, init);
  }) as typeof fetch;
  window.WebSocket = class extends DemoSocket {
    constructor(url: string | URL) { super(String(url), backend); }
  } as unknown as typeof WebSocket;
  return () => {
    backend.stop();
    window.fetch = originalFetch;
    window.WebSocket = originalWebSocket;
  };
}
