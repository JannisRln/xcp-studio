/**
 * Browser-only diagnostics projection. No backend event API is assumed.
 * Raw error strings, signal names and memory addresses are never exported.
 */
import type { Health } from "../../core/api";

export type DiagnosticSeverity = "info" | "warning" | "error";
export type DiagnosticSubsystem = "api" | "session" | "acquisition" | "websocket" | "data_quality" | "ui";

export type DiagnosticRow = {
  key: string;
  severity: DiagnosticSeverity;
  subsystem: DiagnosticSubsystem;
  code: string;
  message: string;
  timestamp: null;
  correlationId: null;
};

export type DiagnosticFilter = {
  severity: DiagnosticSeverity | "all";
  subsystem: DiagnosticSubsystem | "all";
};

export const MAX_BROWSER_EVENTS = 100;

function legacyEvent(raw: string, index: number): DiagnosticRow {
  // Existing App.log strings are unstructured and can contain sensitive text.
  // A whitelist of known, static actions is the only permitted projection.
  const connected = /(?:^|\s)XCP simulator connected$/.test(raw);
  const disconnected = /(?:^|\s)XCP simulator disconnected$/.test(raw);
  const configured = /(?:^|\s)Configured signal .+ at 0x[0-9a-f]+$/i.test(raw);
  const code = connected ? "session_connected"
    : disconnected ? "session_disconnected"
    : configured ? "signal_configured" : "activity_redacted";
  return {
    key: `legacy-${index}`,
    severity: disconnected ? "warning" : "info",
    subsystem: connected || disconnected ? "session" : "ui",
    code,
    message: connected ? "Simulator connected" : disconnected ? "Simulator disconnected"
      : configured ? "Signal configured (name and address omitted)" : "Browser activity (details withheld)",
    timestamp: null,
    correlationId: null,
  };
}

export function projectDiagnostics(
  health: Health | null,
  connected: boolean,
  error: string,
  events: string[],
): DiagnosticRow[] {
  const current: DiagnosticRow[] = [];
  if (!health) {
    current.push({
      key: "status-api", severity: "error", subsystem: "api",
      code: "backend_unreachable", message: "Backend health is unavailable",
      timestamp: null, correlationId: null,
    });
  } else if (!connected) {
    current.push({
      key: "status-session", severity: "warning", subsystem: "session",
      code: "session_disconnected", message: "XCP session is disconnected",
      timestamp: null, correlationId: null,
    });
  }
  if (error && health) {
    current.push({
      key: "status-error", severity: "error", subsystem: "api",
      code: "api_request_failed", message: "A backend request failed (details withheld)",
      timestamp: null, correlationId: null,
    });
  }
  return [...current, ...events.slice(0, MAX_BROWSER_EVENTS).map(legacyEvent)].slice(0, MAX_BROWSER_EVENTS + 2);
}

export function filterDiagnostics(rows: DiagnosticRow[], filter: DiagnosticFilter): DiagnosticRow[] {
  return rows.filter(row =>
    (filter.severity === "all" || row.severity === filter.severity) &&
    (filter.subsystem === "all" || row.subsystem === filter.subsystem));
}

/** Operator-initiated, browser-only export: never serializes arbitrary API error text. */
export function browserSupportBundle(
  health: Health | null,
  connected: boolean,
  error: string,
  events: string[],
): string {
  const version = health?.version ?? "";
  const safeVersion = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]{1,32})?$/.test(version)
    ? version : "unavailable";
  return JSON.stringify({
    format_version: 1,
    source: "browser_only",
    context: {
      application: "xcp-studio",
      backend_version: safeVersion,
      backend_reachable: health !== null,
      session_connected: connected,
    },
    limitations: "Local, sanitized browser observations only. Backend event history is not connected.",
    events: projectDiagnostics(health, connected, error, events),
  }, null, 2);
}
