export type Sample = { name: string; address: number; value: number };
export type Frame = { timestamp_ms: number; samples: Sample[] };

export function parseFrame(text: string): Frame {
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== "object") throw new Error("Invalid frame");
  const frame = data as Partial<Frame> & { error?: string };
  if (frame.error) throw new Error(frame.error);
  if (!Number.isFinite(frame.timestamp_ms) || !Array.isArray(frame.samples) ||
    !frame.samples.every(s => typeof s.name === "string" && Number.isFinite(s.value))) {
    throw new Error("Invalid frame");
  }
  return frame as Frame;
}

export function websocketUrl(protocol: string, host: string): string {
  return `${protocol === "https:" ? "wss:" : "ws:"}//${host}/api/xcp/stream`;
}
