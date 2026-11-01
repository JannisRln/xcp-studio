import type { MeasurementFrame, SignalDefinition } from "./api";

export function measurementCsv(frames: MeasurementFrame[], signals: SignalDefinition[]): string {
  const header = ["timestamp_ms", ...signals.map(signal => signal.name)];
  const escape = (value: string) => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const rows = frames.map(frame => [
    String(frame.timestamp_ms),
    ...signals.map(signal => {
      const value = frame.samples.find(sample => sample.name === signal.name && sample.address === signal.address)?.value;
      return value === undefined ? "" : String(value);
    }),
  ]);
  return [header, ...rows].map(row => row.map(escape).join(",")).join("\r\n") + "\r\n";
}

export function downloadText(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
