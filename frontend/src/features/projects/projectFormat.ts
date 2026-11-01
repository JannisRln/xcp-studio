import {
  PROJECT_FORMAT, PROJECT_MAX_BYTES, PROJECT_SCHEMA_VERSION,
  type AcquisitionPreset, type ChartDefinition, type ChartLayout,
  type ConnectionProfile, type EcuFileReference, type LoadedProject,
  type MeasurementWindow, type ObservedEcuFile, type ProjectDocument,
  type ProjectWarning, type SignalDefinition,
} from "./model";

export class ProjectFileError extends Error {
  constructor(
    public readonly code: "INVALID_JSON" | "INVALID_SCHEMA" | "UNSUPPORTED_VERSION" | "FILE_TOO_LARGE" | "FILE_READ_FAILED" | "SENSITIVE_FIELD",
    message: string,
  ) {
    super(message);
    this.name = "ProjectFileError";
  }
}

function invalid(path: string, detail: string): never {
  throw new ProjectFileError("INVALID_SCHEMA", path + ": " + detail);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalid(path, "expected object");
  }
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalid(path + "." + key, "unknown field");
  }
}

function string(value: unknown, path: string, max = 256): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) {
    return invalid(path, "expected nonempty bounded text");
  }
  return value;
}

function id(value: unknown, path: string): string {
  const s = string(value, path, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(s)) invalid(path, "invalid identifier");
  return s;
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    return invalid(path, "integer out of range");
  }
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return invalid(path, "expected boolean");
  return value;
}

function choice<T extends string>(value: unknown, path: string, variants: readonly T[]): T {
  if (typeof value !== "string" || !variants.includes(value as T)) {
    return invalid(path, "unsupported value");
  }
  return value as T;
}

function optional<T>(value: unknown, parse: (value: unknown) => T): T | undefined {
  return value === undefined ? undefined : parse(value);
}

function list<T>(
  value: unknown, path: string, max: number,
  parse: (item: unknown, itemPath: string) => T,
): T[] {
  if (!Array.isArray(value) || value.length > max) return invalid(path, "expected bounded array");
  return value.map((item, index) => parse(item, path + "[" + index + "]"));
}

function unique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) invalid(path, "duplicate identifier");
}

function reference(value: unknown, path: string): EcuFileReference {
  const o = object(value, path);
  keys(o, ["id", "kind", "name", "sha256", "sizeBytes", "buildId"], path);
  const name = string(o.name, path + ".name");
  if (name === "." || name === ".." || /[/\\]/.test(name)) invalid(path + ".name", "expected a filename, not a path");
  const sha256 = string(o.sha256, path + ".sha256", 64);
  if (!/^[0-9a-f]{64}$/.test(sha256)) invalid(path + ".sha256", "expected lowercase SHA-256");
  return {
    id: id(o.id, path + ".id"),
    kind: choice(o.kind, path + ".kind", ["elf", "a2l"]),
    name, sha256,
    sizeBytes: integer(o.sizeBytes, path + ".sizeBytes", 0, Number.MAX_SAFE_INTEGER),
    ...optionalField("buildId", o.buildId, v => string(v, path + ".buildId", 128)),
  };
}

function optionalField<K extends string, V>(key: K, value: unknown, parse: (v: unknown) => V): Partial<Record<K, V>> {
  return value === undefined ? {} : { [key]: parse(value) } as Record<K, V>;
}

function signal(value: unknown, path: string): SignalDefinition {
  const o = object(value, path);
  keys(o, ["id", "name", "source", "fileId", "variablePath", "manualAddressHex", "valueType", "endianness", "unit", "enabled"], path);
  const source = choice(o.source, path + ".source", ["manual", "elf", "a2l"]);
  if (source === "manual") {
    if (o.fileId !== undefined || o.variablePath !== undefined) invalid(path, "manual signal cannot reference an ECU file");
  } else {
    if (o.fileId === undefined || o.variablePath === undefined || o.manualAddressHex !== undefined) {
      invalid(path, "file-backed signal requires fileId and variablePath, not a manual address");
    }
  }
  const manualAddressHex = optional(o.manualAddressHex, v => string(v, path + ".manualAddressHex", 18));
  if (manualAddressHex !== undefined && !/^0x[0-9a-fA-F]{1,16}$/.test(manualAddressHex)) {
    invalid(path + ".manualAddressHex", "expected an explicit hexadecimal manual address");
  }
  return {
    id: id(o.id, path + ".id"),
    name: string(o.name, path + ".name"),
    source,
    ...optionalField("fileId", o.fileId, v => id(v, path + ".fileId")),
    ...optionalField("variablePath", o.variablePath, v => string(v, path + ".variablePath", 1024)),
    ...optionalField("manualAddressHex", o.manualAddressHex, () => manualAddressHex!),
    valueType: choice(o.valueType, path + ".valueType", ["u8", "i8", "u16", "i16", "u32", "i32", "u64", "i64", "f32", "f64"]),
    endianness: choice(o.endianness, path + ".endianness", ["little", "big"]),
    ...optionalField("unit", o.unit, v => string(v, path + ".unit", 64)),
    enabled: bool(o.enabled, path + ".enabled"),
  };
}

function chart(value: unknown, path: string): ChartDefinition {
  const o = object(value, path);
  keys(o, ["id", "title", "signalIds", "timeRangeMs", "showLegend"], path);
  const signalIds = list(o.signalIds, path + ".signalIds", 256, id);
  unique(signalIds, path + ".signalIds");
  return {
    id: id(o.id, path + ".id"),
    title: string(o.title, path + ".title"),
    signalIds,
    timeRangeMs: integer(o.timeRangeMs, path + ".timeRangeMs", 100, 86_400_000),
    showLegend: bool(o.showLegend, path + ".showLegend"),
  };
}

function window(value: unknown, path: string): MeasurementWindow {
  const o = object(value, path);
  keys(o, ["id", "title", "chartIds", "visible", "minimized"], path);
  const chartIds = list(o.chartIds, path + ".chartIds", 128, id);
  unique(chartIds, path + ".chartIds");
  return {
    id: id(o.id, path + ".id"),
    title: string(o.title, path + ".title"),
    chartIds,
    visible: bool(o.visible, path + ".visible"),
    minimized: bool(o.minimized, path + ".minimized"),
  };
}

function layout(value: unknown, path: string): ChartLayout {
  const o = object(value, path);
  keys(o, ["columns", "items"], path);
  const columns = integer(o.columns, path + ".columns", 1, 64);
  const items = list(o.items, path + ".items", 128, (value, itemPath) => {
    const item = object(value, itemPath);
    keys(item, ["windowId", "x", "y", "w", "h"], itemPath);
    const x = integer(item.x, itemPath + ".x", 0, columns - 1);
    const w = integer(item.w, itemPath + ".w", 1, columns);
    if (x + w > columns) invalid(itemPath, "window exceeds layout columns");
    return {
      windowId: id(item.windowId, itemPath + ".windowId"), x,
      y: integer(item.y, itemPath + ".y", 0, 100_000), w,
      h: integer(item.h, itemPath + ".h", 1, 1000),
    };
  });
  unique(items.map(item => item.windowId), path + ".items");
  return { columns, items };
}

function preset(value: unknown, path: string): AcquisitionPreset {
  const o = object(value, path);
  keys(o, ["id", "name", "signalIds", "samplingMode", "intervalMs", "recording"], path);
  const signalIds = list(o.signalIds, path + ".signalIds", 256, id);
  unique(signalIds, path + ".signalIds");
  const recording = object(o.recording, path + ".recording");
  keys(recording, ["enabled", "maxBytes"], path + ".recording");
  return {
    id: id(o.id, path + ".id"),
    name: string(o.name, path + ".name"),
    signalIds,
    samplingMode: choice(o.samplingMode, path + ".samplingMode", ["auto", "polling", "daq"]),
    intervalMs: integer(o.intervalMs, path + ".intervalMs", 20, 10_000),
    recording: {
      enabled: bool(recording.enabled, path + ".recording.enabled"),
      ...optionalField("maxBytes", recording.maxBytes, v => integer(v, path + ".recording.maxBytes", 1, Number.MAX_SAFE_INTEGER)),
    },
  };
}

function profile(value: unknown, path: string): ConnectionProfile {
  const o = object(value, path);
  keys(o, ["id", "name", "transport", "adapterId", "channel", "bitrate", "requestCanId", "responseCanId"], path);
  const requestCanId = integer(o.requestCanId, path + ".requestCanId", 0, 0x1fffffff);
  const responseCanId = integer(o.responseCanId, path + ".responseCanId", 0, 0x1fffffff);
  if (requestCanId === responseCanId) invalid(path, "request and response CAN IDs must differ");
  return {
    id: id(o.id, path + ".id"),
    name: string(o.name, path + ".name"),
    transport: choice(o.transport, path + ".transport", ["simulation", "pcan", "vector"]),
    ...optionalField("adapterId", o.adapterId, v => string(v, path + ".adapterId", 128)),
    ...optionalField("channel", o.channel, v => string(v, path + ".channel", 128)),
    ...optionalField("bitrate", o.bitrate, v => integer(v, path + ".bitrate", 1, 10_000_000)),
    requestCanId, responseCanId,
  };
}

/** Reject secret-shaped fields before migration; no ignored fields are silently dropped. */
function rejectSecrets(value: unknown, depth = 0): void {
  if (depth > 32) invalid("project", "nesting too deep");
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) rejectSecrets(item, depth + 1);
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (/(password|passwd|secret|token|credential|api[_-]?key|private[_-]?key|auth(?:entication|orization)?)/i.test(key)) {
        throw new ProjectFileError("SENSITIVE_FIELD", "Project contains a forbidden secret field");
      }
      rejectSecrets(item, depth + 1);
    }
  }
}

function parseV2(value: unknown): ProjectDocument {
  const o = object(value, "project");
  keys(o, ["format", "schemaVersion", "name", "ecuFiles", "signals", "charts", "measurementWindows", "chartLayout", "acquisitionPresets", "connectionProfiles"], "project");
  if (o.format !== PROJECT_FORMAT || o.schemaVersion !== PROJECT_SCHEMA_VERSION) invalid("project", "invalid format or schema version");
  const ecuFiles = list(o.ecuFiles, "ecuFiles", 128, reference);
  const signals = list(o.signals, "signals", 2048, signal);
  const charts = list(o.charts, "charts", 128, chart);
  const measurementWindows = list(o.measurementWindows, "measurementWindows", 128, window);
  const chartLayout = layout(o.chartLayout, "chartLayout");
  const acquisitionPresets = list(o.acquisitionPresets, "acquisitionPresets", 128, preset);
  const connectionProfiles = list(o.connectionProfiles, "connectionProfiles", 64, profile);
  for (const [name, entries] of [
    ["ecuFiles", ecuFiles], ["signals", signals], ["charts", charts],
    ["measurementWindows", measurementWindows], ["acquisitionPresets", acquisitionPresets],
    ["connectionProfiles", connectionProfiles],
  ] as const) unique(entries.map(entry => entry.id), name);
  const fileById = new Map(ecuFiles.map(file => [file.id, file]));
  const signalIds = new Set(signals.map(item => item.id));
  const chartIds = new Set(charts.map(item => item.id));
  const windowIds = new Set(measurementWindows.map(item => item.id));
  for (const s of signals) {
    if (s.fileId && (!fileById.has(s.fileId) || fileById.get(s.fileId)!.kind !== s.source)) {
      invalid("signals." + s.id, "source file missing or kind mismatch");
    }
  }
  for (const c of charts) {
    for (const sid of c.signalIds) if (!signalIds.has(sid)) invalid("charts." + c.id, "unknown signal " + sid);
  }
  for (const w of measurementWindows) {
    for (const cid of w.chartIds) if (!chartIds.has(cid)) invalid("measurementWindows." + w.id, "unknown chart " + cid);
  }
  for (const item of chartLayout.items) {
    if (!windowIds.has(item.windowId)) invalid("chartLayout", "unknown window " + item.windowId);
  }
  for (const p of acquisitionPresets) {
    for (const sid of p.signalIds) if (!signalIds.has(sid)) invalid("acquisitionPresets." + p.id, "unknown signal " + sid);
  }
  return {
    format: PROJECT_FORMAT, schemaVersion: PROJECT_SCHEMA_VERSION,
    name: string(o.name, "project.name"),
    ecuFiles, signals, charts, measurementWindows, chartLayout,
    acquisitionPresets, connectionProfiles,
  };
}

/** Version 1 stored window coordinates inline; version 2 splits content and layout. */
function migrateV1(value: unknown): ProjectDocument {
  const old = object(value, "project");
  keys(old, ["format", "schemaVersion", "name", "ecuFiles", "signals", "charts", "windows", "columns", "acquisitionPresets", "connectionProfiles"], "project");
  if (old.format !== PROJECT_FORMAT || old.schemaVersion !== 1) invalid("project", "invalid legacy format");
  const columns = integer(old.columns, "project.columns", 1, 64);
  const windows = list(old.windows, "project.windows", 128, (raw, path) => {
    const w = object(raw, path);
    keys(w, ["id", "title", "chartIds", "visible", "minimized", "x", "y", "w", "h"], path);
    const x = integer(w.x, path + ".x", 0, columns - 1);
    const width = integer(w.w, path + ".w", 1, columns);
    if (x + width > columns) invalid(path, "window exceeds layout columns");
    return {
      id: id(w.id, path + ".id"),
      title: string(w.title, path + ".title"),
      chartIds: w.chartIds,
      visible: w.visible,
      minimized: w.minimized,
      x, y: integer(w.y, path + ".y", 0, 100_000),
      w: width, h: integer(w.h, path + ".h", 1, 1000),
    };
  });
  return parseV2({
    format: PROJECT_FORMAT, schemaVersion: 2, name: old.name,
    ecuFiles: old.ecuFiles, signals: old.signals, charts: old.charts,
    measurementWindows: windows.map(({ id, title, chartIds, visible, minimized }) => ({ id, title, chartIds, visible, minimized })),
    chartLayout: { columns, items: windows.map(({ id, x, y, w, h }) => ({ windowId: id, x, y, w, h })) },
    acquisitionPresets: old.acquisitionPresets, connectionProfiles: old.connectionProfiles,
  });
}

/** Compare exact file fingerprints. A matching basename is never enough to unblock a signal. */
export function reconcileEcuFiles(project: ProjectDocument, observed: readonly ObservedEcuFile[]): {
  warnings: ProjectWarning[];
  blockedSignalIds: string[];
} {
  const seen = new Map<string, ObservedEcuFile>();
  const ambiguous = new Set<string>();
  for (const item of observed) {
    if (seen.has(item.id)) ambiguous.add(item.id);
    seen.set(item.id, item);
  }
  const warnings: ProjectWarning[] = [];
  const blocked = new Set<string>();
  for (const expected of project.ecuFiles) {
    const current = seen.get(expected.id);
    const code = !current ? "MISSING_ECU_FILE"
      : ambiguous.has(expected.id) || current.kind !== expected.kind || current.sha256 !== expected.sha256 || current.sizeBytes !== expected.sizeBytes
        ? "CHANGED_ECU_FILE" : null;
    if (code !== null) {
      const signalIds = project.signals.filter(s => s.fileId === expected.id).map(s => s.id);
      for (const signalId of signalIds) blocked.add(signalId);
      warnings.push({
        code, fileId: expected.id, signalIds,
        message: code === "MISSING_ECU_FILE" ? "Referenced ECU file is not available"
          : "ECU file fingerprint differs; manual reconciliation required",
      });
    }
  }
  return { warnings, blockedSignalIds: [...blocked] };
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** Strict import: parse and migrate in memory only. Neither disk nor live acquisition is modified. */
export function importProject(json: string, observed?: readonly ObservedEcuFile[]): LoadedProject {
  if (byteLength(json) > PROJECT_MAX_BYTES) {
    throw new ProjectFileError("FILE_TOO_LARGE", "Project exceeds the 2 MiB limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ProjectFileError("INVALID_JSON", "Project is not valid JSON");
  }
  rejectSecrets(parsed);
  const header = object(parsed, "project");
  if (header.format !== PROJECT_FORMAT) invalid("project.format", "unknown file format");
  if (header.schemaVersion !== 1 && header.schemaVersion !== 2) {
    throw new ProjectFileError("UNSUPPORTED_VERSION", "Unsupported project schema version");
  }
  const migration = header.schemaVersion === 1 ? { from: 1 as const, to: 2 as const } : null;
  const project = migration ? migrateV1(parsed) : parseV2(parsed);
  const checked = observed ? reconcileEcuFiles(project, observed) : { warnings: [], blockedSignalIds: [] };
  return {
    project, migration,
    warnings: [
      ...(migration ? [{ code: "MIGRATED" as const, message: "Version 1 was migrated in memory; review before exporting" }] : []),
      ...checked.warnings,
    ],
    blockedSignalIds: checked.blockedSignalIds,
  };
}

/** Deterministic canonical export; rejects unknown fields rather than silently losing them. */
export function exportProject(value: unknown): string {
  rejectSecrets(value);
  const project = parseV2(value);
  const json = JSON.stringify(project, null, 2) + "\n";
  if (byteLength(json) > PROJECT_MAX_BYTES) {
    throw new ProjectFileError("FILE_TOO_LARGE", "Project exceeds the 2 MiB limit");
  }
  return json;
}

/** Bounded File/Blob import; does not save, connect, resolve addresses or start acquisition. */
export async function importProjectFile(
  file: Pick<File, "size" | "text">, observed?: readonly ObservedEcuFile[],
): Promise<LoadedProject> {
  if (file.size > PROJECT_MAX_BYTES) {
    throw new ProjectFileError("FILE_TOO_LARGE", "Project exceeds the 2 MiB limit");
  }
  let json: string;
  try {
    json = await file.text();
  } catch {
    throw new ProjectFileError("FILE_READ_FAILED", "Unable to read project file");
  }
  return importProject(json, observed);
}
