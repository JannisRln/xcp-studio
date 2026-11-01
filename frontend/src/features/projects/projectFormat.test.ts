import { describe, expect, it } from "vitest";
import { PROJECT_FORMAT, PROJECT_MAX_BYTES, type ProjectDocument } from "./model";
import {
  exportProject, importProject, importProjectFile, ProjectFileError, reconcileEcuFiles,
} from "./projectFormat";

const ELF_HASH = "a".repeat(64);
const A2L_HASH = "b".repeat(64);

function fixture(): ProjectDocument {
  return {
    format: PROJECT_FORMAT,
    schemaVersion: 2,
    name: "Engine calibration workspace",
    ecuFiles: [
      { id: "ecu-elf", kind: "elf", name: "engine.elf", sha256: ELF_HASH, sizeBytes: 2400, buildId: "build-42" },
      { id: "ecu-a2l", kind: "a2l", name: "engine.a2l", sha256: A2L_HASH, sizeBytes: 800 },
    ],
    signals: [
      { id: "rpm", name: "Engine speed", source: "elf", fileId: "ecu-elf", variablePath: "Engine.RPM", valueType: "u32", endianness: "little", unit: "rpm", enabled: true },
      { id: "temp", name: "Coolant temperature", source: "a2l", fileId: "ecu-a2l", variablePath: "Coolant", valueType: "f32", endianness: "big", unit: "deg C", enabled: true },
      { id: "manual", name: "Manual signal", source: "manual", manualAddressHex: "0x1000", valueType: "u16", endianness: "little", enabled: false },
    ],
    charts: [
      { id: "rpm-chart", title: "RPM", signalIds: ["rpm", "manual"], timeRangeMs: 10_000, showLegend: true },
      { id: "temp-chart", title: "Temperature", signalIds: ["temp"], timeRangeMs: 30_000, showLegend: false },
    ],
    measurementWindows: [
      { id: "main", title: "Live traces", chartIds: ["rpm-chart", "temp-chart"], visible: true, minimized: false },
    ],
    chartLayout: { columns: 12, items: [{ windowId: "main", x: 2, y: 1, w: 8, h: 6 }] },
    acquisitionPresets: [
      { id: "capture", name: "Road test", signalIds: ["rpm", "temp"], samplingMode: "polling", intervalMs: 100, recording: { enabled: true, maxBytes: 2_000_000 } },
    ],
    connectionProfiles: [
      { id: "sim", name: "Local simulator", transport: "simulation", adapterId: "builtin-simulator", requestCanId: 0x667, responseCanId: 0x666 },
      { id: "bench", name: "Bench CAN", transport: "pcan", adapterId: "pcan-usb", channel: "CAN1", bitrate: 500_000, requestCanId: 0x600, responseCanId: 0x601 },
    ],
  };
}

function mutate(change: (project: ProjectDocument) => void): string {
  const project = fixture();
  change(project);
  return JSON.stringify(project);
}

function legacyV1(): Record<string, unknown> {
  const { measurementWindows, chartLayout, schemaVersion: _version, ...rest } = fixture();
  const windows = measurementWindows.map(w => ({
    ...w,
    ...chartLayout.items.find(item => item.windowId === w.id)!,
  }));
  return { ...rest, schemaVersion: 1, columns: chartLayout.columns, windows };
}

describe("T-0010 project file codec", () => {
  it("roundtrips all project configuration without loss and exports reproducibly", () => {
    const initial = fixture();
    const encoded = exportProject(initial);
    const loaded = importProject(encoded);
    expect(loaded.project).toEqual(initial);
    expect(loaded.migration).toBeNull();
    expect(loaded.warnings).toEqual([]);
    expect(loaded.blockedSignalIds).toEqual([]);
    expect(exportProject(loaded.project)).toBe(encoded);
    expect(encoded).not.toMatch(/password|accessToken|credentials/i);
  });

  it("migrates v1 windows and positions into v2 without rewriting its input", () => {
    const legacy = legacyV1();
    const json = JSON.stringify(legacy);
    const loaded = importProject(json);
    expect(JSON.stringify(legacy)).toBe(json);
    expect(loaded.migration).toEqual({ from: 1, to: 2 });
    expect(loaded.warnings.map(w => w.code)).toEqual(["MIGRATED"]);
    expect(loaded.project).toEqual(fixture());
    expect(importProject(exportProject(loaded.project)).migration).toBeNull();
  });

  it("keeps stale ELF/A2L references unsafe until separately reconciled", () => {
    const project = fixture();
    const observed = [
      { id: "ecu-elf", kind: "elf" as const, sha256: "c".repeat(64), sizeBytes: 2400 },
    ];
    const { warnings, blockedSignalIds } = reconcileEcuFiles(project, observed);
    expect(warnings.map(w => [w.code, w.fileId])).toEqual([
      ["CHANGED_ECU_FILE", "ecu-elf"], ["MISSING_ECU_FILE", "ecu-a2l"],
    ]);
    expect(blockedSignalIds).toEqual(["rpm", "temp"]);
    expect(blockedSignalIds).not.toContain("manual");
    expect(importProject(exportProject(project), observed).blockedSignalIds).toEqual(["rpm", "temp"]);
    expect(importProject(exportProject(project)).warnings).toEqual([]);
  });

  it("accepts files only if SHA-256, byte count and kind match", () => {
    const expected = fixture();
    const observed = expected.ecuFiles.map(({ id, kind, sha256, sizeBytes }) => ({ id, kind, sha256, sizeBytes }));
    expect(reconcileEcuFiles(expected, observed).warnings).toEqual([]);
    observed[0] = { ...observed[0], kind: "a2l" };
    expect(reconcileEcuFiles(expected, observed).blockedSignalIds).toEqual(["rpm"]);
  });

  it.each([
    ["truncated JSON", "{"],
    ["wrong root", "[]"],
    ["wrong format", JSON.stringify({ ...fixture(), format: "unknown" })],
    ["unsupported future version", JSON.stringify({ ...fixture(), schemaVersion: 3 })],
    ["unsupported old version", JSON.stringify({ ...fixture(), schemaVersion: 0 })],
  ])("rejects %s safely", (_name, json) => {
    expect(() => importProject(json)).toThrow(ProjectFileError);
  });

  it("reports unsupported newer versions explicitly", () => {
    try {
      importProject(JSON.stringify({ ...fixture(), schemaVersion: 999 }));
      throw new Error("Expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectFileError);
      expect((error as ProjectFileError).code).toBe("UNSUPPORTED_VERSION");
    }
  });

  it.each([
    ["unknown top-level field", (p: ProjectDocument) => Object.assign(p, { futureField: 123 })],
    ["secret in connection profile", (p: ProjectDocument) => Object.assign(p.connectionProfiles[0], { password: "no" })],
    ["API key in nested object", (p: ProjectDocument) => Object.assign(p.acquisitionPresets[0].recording, { apiKey: "no" })],
    ["unknown nested field", (p: ProjectDocument) => Object.assign(p.chartLayout.items[0], { z: 7 })],
    ["duplicate IDs", (p: ProjectDocument) => p.signals.push({ ...p.signals[0] })],
    ["unknown chart signal", (p: ProjectDocument) => p.charts[0].signalIds.push("nonexistent")],
    ["unknown window chart", (p: ProjectDocument) => p.measurementWindows[0].chartIds.push("nonexistent")],
    ["unknown layout window", (p: ProjectDocument) => { p.chartLayout.items[0].windowId = "nonexistent"; }],
    ["unknown preset signal", (p: ProjectDocument) => p.acquisitionPresets[0].signalIds.push("nonexistent")],
    ["wrong ECU source kind", (p: ProjectDocument) => { p.signals[0].fileId = "ecu-a2l"; }],
    ["bad SHA", (p: ProjectDocument) => { p.ecuFiles[0].sha256 = "wrong"; }],
    ["absolute ECU reference path", (p: ProjectDocument) => { p.ecuFiles[0].name = "C:\\secret\\engine.elf"; }],
    ["bogus sample rate", (p: ProjectDocument) => { p.acquisitionPresets[0].intervalMs = 0; }],
    ["layout overflow", (p: ProjectDocument) => { p.chartLayout.items[0].x = 11; }],
    ["unsupported signal type", (p: ProjectDocument) => Object.assign(p.signals[0], { valueType: "object" })],
    ["nonfinite interval", (p: ProjectDocument) => { p.acquisitionPresets[0].intervalMs = Number.NaN; }],
    ["ELF runtime address injection", (p: ProjectDocument) => Object.assign(p.signals[0], { runtimeAddressHex: "0x1000" })],
  ])("rejects %s rather than silently dropping it", (_name, change) => {
    const json = mutate(change);
    expect(() => importProject(json)).toThrow(ProjectFileError);
    expect(() => exportProject(JSON.parse(json))).toThrow(ProjectFileError);
  });

  it("rejects malformed legacy structures rather than losing positions", () => {
    const legacy = legacyV1();
    const windows = legacy.windows as Array<Record<string, unknown>>;
    windows[0].futureField = "would be lost";
    expect(() => importProject(JSON.stringify(legacy))).toThrow(ProjectFileError);
  });

  it("enforces UTF-8 byte limits for both import and export", () => {
    const tooLarge = "x".repeat(PROJECT_MAX_BYTES + 1);
    expect(() => importProject(tooLarge)).toThrow(ProjectFileError);
    const project = fixture();
    project.name = "ü".repeat(PROJECT_MAX_BYTES / 2);
    expect(() => exportProject(project)).toThrow(ProjectFileError);
  });

  it("checks File size before reading, and rechecks declared sizes after reading", async () => {
    let called = false;
    await expect(importProjectFile({
      size: PROJECT_MAX_BYTES + 1,
      text: async () => { called = true; return ""; },
    })).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    expect(called).toBe(false);
    await expect(importProjectFile({
      size: 1, text: async () => "x".repeat(PROJECT_MAX_BYTES + 1),
    })).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("returns a sanitized read failure without touching project state", async () => {
    await expect(importProjectFile({
      size: 12, text: async () => { throw new Error("private path /credentials"); },
    })).rejects.toMatchObject({ code: "FILE_READ_FAILED", message: "Unable to read project file" });
  });

  it("reads a real Blob using the same parser", async () => {
    const json = exportProject(fixture());
    const blob = new Blob([json], { type: "application/json" });
    expect((await importProjectFile(blob)).project).toEqual(fixture());
  });
});
