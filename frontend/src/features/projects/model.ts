/** Portable project-file model. No runtime ECU addresses or credentials are trusted on load. */
export const PROJECT_FORMAT = "xcp-studio-project";
export const PROJECT_SCHEMA_VERSION = 2;
export const PROJECT_MAX_BYTES = 2 * 1024 * 1024;

export type EcuFileReference = {
  id: string;
  kind: "elf" | "a2l";
  name: string;
  sha256: string;
  sizeBytes: number;
  buildId?: string;
};

export type SignalDefinition = {
  id: string;
  name: string;
  source: "manual" | "elf" | "a2l";
  fileId?: string;
  variablePath?: string;
  /** Explicit operator-entered address only; never an ELF link-time or trusted runtime address. */
  manualAddressHex?: string;
  valueType: "u8" | "i8" | "u16" | "i16" | "u32" | "i32" | "u64" | "i64" | "f32" | "f64";
  endianness: "little" | "big";
  unit?: string;
  enabled: boolean;
};

export type ChartDefinition = {
  id: string;
  title: string;
  signalIds: string[];
  timeRangeMs: number;
  showLegend: boolean;
};

export type MeasurementWindow = {
  id: string;
  title: string;
  chartIds: string[];
  visible: boolean;
  minimized: boolean;
};

export type ChartLayout = {
  columns: number;
  items: Array<{ windowId: string; x: number; y: number; w: number; h: number }>;
};

export type AcquisitionPreset = {
  id: string;
  name: string;
  signalIds: string[];
  samplingMode: "auto" | "polling" | "daq";
  intervalMs: number;
  recording: { enabled: boolean; maxBytes?: number };
};

export type ConnectionProfile = {
  id: string;
  name: string;
  transport: "simulation" | "pcan" | "vector";
  adapterId?: string;
  channel?: string;
  bitrate?: number;
  requestCanId: number;
  responseCanId: number;
};

export type ProjectDocument = {
  format: typeof PROJECT_FORMAT;
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  name: string;
  ecuFiles: EcuFileReference[];
  signals: SignalDefinition[];
  charts: ChartDefinition[];
  measurementWindows: MeasurementWindow[];
  chartLayout: ChartLayout;
  acquisitionPresets: AcquisitionPreset[];
  connectionProfiles: ConnectionProfile[];
};

export type ObservedEcuFile = Pick<EcuFileReference, "id" | "kind" | "sha256" | "sizeBytes">;

export type ProjectWarning = {
  code: "MIGRATED" | "UNVERIFIED_ECU_FILE" | "MISSING_ECU_FILE" | "CHANGED_ECU_FILE";
  fileId?: string;
  signalIds?: string[];
  message: string;
};

export type LoadedProject = {
  project: ProjectDocument;
  migration: { from: 1; to: 2 } | null;
  warnings: ProjectWarning[];
  /** Signals that must not be used for ECU reads until the operator reconciles their source. */
  blockedSignalIds: string[];
};
