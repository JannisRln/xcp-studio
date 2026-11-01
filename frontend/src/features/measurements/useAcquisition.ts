import { useCallback, useEffect, useRef, useState } from "react";
import type { MeasurementFrame, SignalDefinition } from "../../core/api";

export type AcquisitionState = "idle" | "connecting" | "streaming" | "error";
const MAX_BUFFER = 2000;

export function streamEndpoint(protocol: string, host: string): string {
  return `${protocol === "https:" ? "wss:" : "ws:"}//${host}/api/xcp/stream`;
}

export function validateFrame(value: unknown): MeasurementFrame {
  if (!value || typeof value !== "object") throw new Error("Malformed stream message");
  const frame = value as Partial<MeasurementFrame> & { error?: string };
  if (typeof frame.error === "string") throw new Error(frame.error);
  if (typeof frame.timestamp_ms !== "number" || !Number.isFinite(frame.timestamp_ms) ||
      !Array.isArray(frame.samples) || !frame.samples.every(sample =>
        typeof sample.name === "string" && typeof sample.address === "number" &&
        typeof sample.value === "number" && Number.isFinite(sample.value)))
    throw new Error("Invalid measurement frame");
  return frame as MeasurementFrame;
}

export function useAcquisition(connected: boolean) {
  const [state, setState] = useState<AcquisitionState>("idle");
  const [frames, setFrames] = useState<MeasurementFrame[]>([]);
  const [error, setError] = useState("");
  const [received, setReceived] = useState(0);
  const socket = useRef<WebSocket | null>(null);
  const lastTime = useRef(0);

  const stop = useCallback(() => {
    socket.current?.close();
    socket.current = null;
    setState("idle");
  }, []);

  const start = useCallback((signals: SignalDefinition[], intervalMs: number) => {
    stop();
    setError("");
    if (!connected) { setError("Connect the XCP simulator first"); setState("error"); return; }
    if (signals.length < 1 || signals.length > 64) { setError("Select 1–64 signals"); setState("error"); return; }
    if (!Number.isInteger(intervalMs) || intervalMs < 20 || intervalMs > 10000) {
      setError("Interval must be between 20 and 10000 ms"); setState("error"); return;
    }
    const ws = new WebSocket(streamEndpoint(window.location.protocol, window.location.host));
    socket.current = ws;
    setState("connecting");
    ws.onopen = () => {
      ws.send(JSON.stringify({ interval_ms: intervalMs, signals: signals.map(({ name, address, value_type }) =>
        ({ name, address, value_type })) }));
      setState("streaming");
    };
    ws.onmessage = event => {
      try {
        const frame = validateFrame(JSON.parse(String(event.data)) as unknown);
        lastTime.current = frame.timestamp_ms;
        setFrames(previous => [...previous.slice(-(MAX_BUFFER - 1)), frame]);
        setReceived(count => count + 1);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setState("error");
        ws.close();
      }
    };
    ws.onerror = () => { setError("WebSocket transport error"); setState("error"); };
    ws.onclose = () => {
      if (socket.current === ws) {
        socket.current = null;
        setState(current => current === "error" ? current : "idle");
      }
    };
  }, [connected, stop]);

  useEffect(() => { if (!connected) stop(); }, [connected, stop]);
  useEffect(() => () => { socket.current?.close(); }, []);
  const clear = useCallback(() => { setFrames([]); setReceived(0); lastTime.current = 0; }, []);
  return { state, frames, error, received, lastTime: lastTime.current, start, stop, clear };
}
