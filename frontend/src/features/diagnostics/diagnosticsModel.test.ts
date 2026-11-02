import { describe, expect, it } from "vitest";
import {
  browserSupportBundle, filterDiagnostics, MAX_BROWSER_EVENTS, projectDiagnostics,
} from "./diagnosticsModel";

const health = { status: "ok", mode: "simulation", version: "0.1.0" };

describe("browser diagnostics (no backend event contract)", () => {
  it("classifies known activity without exporting signal names or memory addresses", () => {
    const rows = projectDiagnostics(health, true, "", [
      "12:00:00  XCP simulator connected",
      "12:00:01  Configured signal SecretName at 0x1234",
      "12:00:02  XCP simulator disconnected",
    ]);
    expect(rows.map(row => row.code)).toEqual([
      "session_connected", "signal_configured", "session_disconnected",
    ]);
    expect(rows[1].message).not.toContain("SecretName");
    expect(rows[1].message).not.toContain("0x1234");
    expect(rows.every(row => row.timestamp === null && row.correlationId === null)).toBe(true);
  });

  it("distinguishes API failure, XCP disconnected, and filtered severity", () => {
    const offline = projectDiagnostics(null, false, "password=hunter2", []);
    expect(offline[0].code).toBe("backend_unreachable");
    const disconnected = projectDiagnostics(health, false, "", []);
    expect(disconnected[0].code).toBe("session_disconnected");
    const filtered = filterDiagnostics(disconnected, { severity: "warning", subsystem: "session" });
    expect(filtered).toHaveLength(1);
    expect(filterDiagnostics(disconnected, { severity: "error", subsystem: "all" })).toHaveLength(0);
  });

  it("redacts passwords, Unix and Windows paths, raw bytes and arbitrary errors from bundle", () => {
    const secrets = [
      "password=hunter2",
      "C:\\Users\\private\\secret.elf",
      "/home/alice/firmware.elf",
      "secret_token=AbCdEf",
      "Raw ECU bytes: DE AD BE EF",
      "Configured signal AlicePrivate at 0xDEADBEEF",
    ];
    const bundle = browserSupportBundle(
      { ...health, version: "/home/alice/bin/backend" },
      false,
      secrets[0],
      secrets,
    );
    for (const value of ["hunter2", "private", "firmware.elf", "AbCdEf", "DE AD BE EF", "AlicePrivate", "DEADBEEF"]) {
      expect(bundle).not.toContain(value);
    }
    expect(JSON.parse(bundle).context.backend_version).toBe("unavailable");
    expect(JSON.parse(bundle).source).toBe("browser_only");
  });

  it("caps the projected event list without unbounded growth", () => {
    const events = Array.from({ length: 10000 }, (_, index) => `secret-${index}`);
    const rows = projectDiagnostics(health, false, "", events);
    expect(rows.length).toBeLessThanOrEqual(MAX_BROWSER_EVENTS + 2);
    expect(rows.filter(row => row.code === "activity_redacted")).toHaveLength(MAX_BROWSER_EVENTS);
    expect(browserSupportBundle(health, false, "", events)).not.toContain("secret-9999");
  });
});
