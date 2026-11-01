/**
 * Browser-only simulator for the static GitHub Pages preview.
 *
 * This adapter intentionally implements the same versioned REST and WebSocket
 * message envelopes as the Rust backend. It never connects to an ECU, CAN
 * device, localhost server or external service. Only the dedicated Pages build
 * calls installBrowserDemo(); normal Vite and production desktop builds do not.
 */
import type { AcquisitionSignal, AcquisitionStatus, AcquisitionEvent } from "../core/acquisitionV1";

type Subscriber = DemoWebSocket;

interface DemoAcquisition {
  id: string;
  status: AcquisitionStatus;
  subscribers: Set<Subscriber>;
  started: number;
  timer: ReturnType<typeof setInterval> | null;
}

const demoMemory = new DataView(new ArrayBuffer(8));
const responses = {
  health: { schema_version: 1, status: "ok", mode: "browser-demo", version: "0.1.0-preview" },
  disconnected: {
    schema_version: 1,
    error: {
      code: "XCP_SESSION_DISCONNECTED",
      message: "Connect the browser-only simulated ECU first",
      request_id: "browser-demo",
      retryable: false,
    },
  },
};

let installed = false;
let connected = false;
let lastAcquisition: DemoAcquisition | null = null;
let nextAcquisition = 0;

function httpJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function error(code: string, message: string, status: number): Response {
  return httpJson({
    schema_version: 1,
    error: { code, message, request_id: "browser-demo", retryable: false },
  }, status);
}

function currentStatus(): AcquisitionStatus | null {
  if (!lastAcquisition) return null;
  return {
    ...lastAcquisition.status,
    subscriber_count: lastAcquisition.subscribers.size,
    signals: [...lastAcquisition.status.signals],
  };
}

/**
 * Deterministic, animated engineering values. The values are synthetic and
 * deliberately change so visitors can exercise cursor, zoom and delta tools.
 */
export function simulatedValue(address: number, seconds: number): number {
  if (address === 0x1000) {
    return Math.round(2100 + 420 * Math.sin(seconds * 0.9) +
      95 * Math.sin(seconds * 3.1));
  }
  if (address === 0x1004) {
    return Math.round((87 + 4.8 * Math.sin(seconds * 0.23)) * 10) / 10;
  }
  return Math.round((80 + 35 * Math.sin(seconds * 1.3 + address * 0.01)) * 100) / 100;
}

function encodeMemory(): void {
  const seconds = performance.now() / 1000;
  demoMemory.setUint32(0, simulatedValue(0x1000, seconds), true);
  demoMemory.setFloat32(4, simulatedValue(0x1004, seconds), true);
}

function stopAcquisition(): void {
  const run = lastAcquisition;
  if (!run || run.status.state !== "running") return;
  run.status.state = "stopped";
  if (run.timer !== null) clearInterval(run.timer);
  run.timer = null;
  const event: AcquisitionEvent = {
    type: "status", schema_version: 1, acquisition_id: run.id,
    state: "stopped", reason: "operator_stop",
  };
  for (const subscriber of [...run.subscribers]) {
    subscriber.deliver(event);
    subscriber.close();
  }
}

function sampleRun(run: DemoAcquisition): void {
  if (!connected || run.status.state !== "running") return;
  run.status.sequence++;
  const elapsed = performance.now() - run.started;
  const seconds = elapsed / 1000;
  const event: AcquisitionEvent = {
    type: "samples",
    schema_version: 1,
    acquisition_id: run.id,
    sequence: run.status.sequence,
    timestamp_ms: Date.now(),
    monotonic_elapsed_ms: Math.round(elapsed),
    dropped_since_previous: 0,
    samples: run.status.signals.map(signal => ({
      name: signal.name,
      address: signal.address,
      value: simulatedValue(signal.address, seconds),
    })),
  };
  for (const subscriber of run.subscribers) subscriber.deliver(event);
}

function validateSignals(input: unknown): input is AcquisitionSignal[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 64) return false;
  const seen = new Set<string>();
  const types = new Set(["u8", "i8", "u16", "i16", "u32", "i32", "f32", "f64"]);
  return input.every(item => {
    if (!item || typeof item !== "object") return false;
    const signal = item as Record<string, unknown>;
    if (typeof signal.name !== "string" || !signal.name.trim() ||
        signal.name.length > 128 || seen.has(signal.name) ||
        !Number.isSafeInteger(signal.address) ||
        (signal.address as number) < 0 ||
        (signal.address as number) > 0xffffffff ||
        !types.has(String(signal.value_type))) return false;
    seen.add(signal.name);
    return true;
  });
}

async function readBody(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  const content = init?.body === undefined && input instanceof Request
    ? await input.clone().text() : init?.body;
  if (typeof content !== "string") return null;
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}

async function demoFetch(path: string, method: string, input: RequestInfo | URL,
  init?: RequestInit): Promise<Response> {
  if (path === "/api/v1/health" && method === "GET") return httpJson(responses.health);
  if ((path === "/api/v1/sessions/current" || path === "/api/xcp/status") &&
      method === "GET") {
    return httpJson({
      schema_version: 1, connected, transport: "browser-demo",
    });
  }
  if (path === "/api/xcp/connect" && method === "POST") {
    connected = true;
    return httpJson({ connected: true, transport: "browser-demo" });
  }
  if (path === "/api/xcp/disconnect" && method === "POST") {
    stopAcquisition();
    connected = false;
    return httpJson({ connected: false, transport: "browser-demo" });
  }
  if (path === "/api/v1/sessions/current/reads" && method === "POST") {
    if (!connected) return httpJson(responses.disconnected, 409);
    const body = await readBody(input, init);
    if (!body || typeof body !== "object") return error("INVALID_JSON", "Invalid read request", 400);
    const { address, count } = body as Record<string, unknown>;
    if (!Number.isInteger(address) || !Number.isInteger(count) ||
        (count as number) < 1 || (count as number) > 8 ||
        (address as number) < 0x1000 ||
        (address as number) + (count as number) > 0x1008) {
      return error("INVALID_ADDRESS_RANGE", "Demo memory contains bytes at 0x1000–0x1007", 422);
    }
    encodeMemory();
    const bytes = [...new Uint8Array(demoMemory.buffer,
      (address as number) - 0x1000, count as number)];
    return httpJson({
      schema_version: 1, address, bytes,
      hex: bytes.map(byte => byte.toString(16).toUpperCase().padStart(2, "0")).join(" "),
    });
  }
  if (path === "/api/v1/acquisitions/current" && method === "GET") {
    const status = currentStatus();
    return status ? httpJson(status) :
      error("ACQUISITION_NOT_FOUND", "No acquisition exists in this browser", 404);
  }
  if (path === "/api/v1/acquisitions" && method === "POST") {
    if (!connected) return httpJson(responses.disconnected, 409);
    if (lastAcquisition?.status.state === "running") {
      return error("ACQUISITION_ALREADY_RUNNING", "Stop the existing demo measurement first", 409);
    }
    const body = await readBody(input, init);
    if (!body || typeof body !== "object")
      return error("INVALID_JSON", "Invalid acquisition request", 400);
    const { interval_ms, signals } = body as Record<string, unknown>;
    if (!Number.isInteger(interval_ms) || (interval_ms as number) < 20 ||
        (interval_ms as number) > 10000) {
      return error("INVALID_SAMPLE_INTERVAL", "Interval must be between 20 and 10000 ms", 422);
    }
    if (!validateSignals(signals)) return error("INVALID_SIGNALS", "Select 1–64 valid signals", 422);
    const id = `demo-acq-${++nextAcquisition}`;
    const status: AcquisitionStatus = {
      schema_version: 1,
      acquisition_id: id,
      state: "running",
      sampling_mode: "polling",
      interval_ms: interval_ms as number,
      signal_count: signals.length,
      signals: [...signals],
      sequence: 0,
      subscriber_count: 0,
      dropped_subscriber_frames: 0,
      error: null,
    };
    const run: DemoAcquisition = {
      id, status, started: performance.now(), subscribers: new Set(), timer: null,
    };
    lastAcquisition = run;
    run.timer = setInterval(() => sampleRun(run), status.interval_ms);
    return httpJson(currentStatus(), 201);
  }
  const match = /^\/api\/v1\/acquisitions\/([^/]+)(\/stop)?$/.exec(path);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (!lastAcquisition || lastAcquisition.id !== id)
      return error("ACQUISITION_NOT_FOUND", "Unknown browser-demo acquisition", 404);
    if (method === "POST" && match[2] === "/stop") {
      stopAcquisition();
      return httpJson(currentStatus());
    }
    if (method === "GET" && !match[2]) return httpJson(currentStatus());
  }
  if (path === "/api/elf/inspect" && method === "POST") {
    return error("DEMO_UNSUPPORTED", "ELF parsing needs the real Rust backend; add a manual signal", 501);
  }
  return error("DEMO_UNSUPPORTED", "This endpoint is not implemented in the browser demo", 501);
}

/** Only a single stream scheduler exists per browser-demo acquisition. */
class DemoWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = DemoWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private run: DemoAcquisition | null = null;

  constructor(url: string | URL) {
    const pathname = new URL(String(url), location.href).pathname;
    const match = /^\/api\/v1\/acquisitions\/([^/]+)\/stream$/.exec(pathname);
    // Delay the first callback until the React hook assigns event handlers.
    queueMicrotask(() => {
      const run = lastAcquisition;
      if (!match || !run || !connected || run.status.state !== "running" ||
          decodeURIComponent(match[1]) !== run.id) {
        this.readyState = DemoWebSocket.CLOSED;
        this.onerror?.(new Event("error"));
        this.onclose?.(new CloseEvent("close", { code: 1006 }));
        return;
      }
      this.run = run;
      this.readyState = DemoWebSocket.OPEN;
      run.subscribers.add(this);
      this.onopen?.(new Event("open"));
    });
  }

  deliver(event: AcquisitionEvent): void {
    if (this.readyState !== DemoWebSocket.OPEN) return;
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) }));
  }

  close(): void {
    if (this.readyState === DemoWebSocket.CLOSED) return;
    this.readyState = DemoWebSocket.CLOSED;
    this.run?.subscribers.delete(this);
    this.run = null;
    queueMicrotask(() => this.onclose?.(new CloseEvent("close", { code: 1000 })));
  }
}

/** Intercept only /api paths in the dedicated static-site build. */
export function installBrowserDemo(): void {
  if (installed) return;
  installed = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) {
      return originalFetch(input, init);
    }
    const method = (init?.method ??
      (input instanceof Request ? input.method : "GET")).toUpperCase();
    return demoFetch(url.pathname, method, input, init);
  };
  window.WebSocket = DemoWebSocket as unknown as typeof WebSocket;
}
