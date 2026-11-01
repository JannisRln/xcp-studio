import { useCallback, useEffect, useRef, useState } from "react";
import type { MeasurementFrame, SignalDefinition } from "../../core/api";
import {
  acquisitionApi, acquisitionWsUrl, parseAcquisitionEvent,
  type AcquisitionSamplesEvent, type AcquisitionStatus,
} from "../../core/acquisitionV1";
import { VersionedApiError } from "../../core/apiV1";

export type AcquisitionState = "idle" | "connecting" | "streaming" | "error";
export const MAX_BUFFER = 2000;

/** Keep rendering/export preview bounded; persistent capture is a backend concern. */
export function appendFrame(previous: MeasurementFrame[], frame: MeasurementFrame): MeasurementFrame[] {
  return [...previous.slice(-(MAX_BUFFER - 1)), frame];
}

export function eventFrame(event: AcquisitionSamplesEvent): MeasurementFrame {
  return {
    timestamp_ms: event.timestamp_ms, samples: event.samples,
    acquisition_id: event.acquisition_id, sequence: event.sequence,
    monotonic_elapsed_ms: event.monotonic_elapsed_ms,
    dropped_since_previous: event.dropped_since_previous,
  };
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function useAcquisition(connected: boolean) {
  const [state, setState] = useState<AcquisitionState>("idle");
  const [status, setStatus] = useState<AcquisitionStatus | null>(null);
  const [frames, setFrames] = useState<MeasurementFrame[]>([]);
  const [latest, setLatest] = useState<MeasurementFrame | null>(null);
  const [error, setError] = useState("");
  const [received, setReceived] = useState(0);
  const [dropped, setDropped] = useState(0);
  const [paused, setPaused] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const mounted = useRef(false);
  const pausedRef = useRef(false);
  const activeId = useRef<string | null>(null);
  const pendingDrops = useRef(0);

  const detach = useCallback(() => {
    const current = socket.current;
    socket.current = null;
    current?.close();
  }, []);

  const attach = useCallback((acquisition: AcquisitionStatus) => {
    if (acquisition.state !== "running") {
      setStatus(acquisition);
      setState("idle");
      return;
    }
    detach();
    activeId.current = acquisition.acquisition_id;
    setStatus(acquisition);
    setError("");
    setState("connecting");
    const ws = new WebSocket(acquisitionWsUrl(
      window.location.protocol, window.location.host, acquisition.acquisition_id,
    ));
    socket.current = ws;
    ws.onopen = () => {
      if (socket.current === ws) setState("streaming");
    };
    ws.onmessage = (message) => {
      if (socket.current !== ws) return;
      try {
        const event = parseAcquisitionEvent(JSON.parse(String(message.data)) as unknown);
        if (event.acquisition_id !== acquisition.acquisition_id)
          throw new Error("Acquisition ID mismatch in WebSocket message");
        if (event.type === "samples") {
          const frame = eventFrame(event);
          frame.dropped_since_previous = (frame.dropped_since_previous ?? 0) + pendingDrops.current;
          pendingDrops.current = 0;
          setLatest(frame);
          setReceived(count => count + 1);
          setStatus(previous => previous?.acquisition_id === event.acquisition_id
            ? { ...previous, sequence: event.sequence } : previous);
          if (!pausedRef.current) setFrames(previous => appendFrame(previous, frame));
        } else if (event.type === "gap") {
          pendingDrops.current += event.dropped;
          setDropped(count => count + event.dropped);
        } else {
          setStatus(previous => previous?.acquisition_id === event.acquisition_id
            ? { ...previous, state: event.state, error: event.state === "failed" ? event.reason : null }
            : previous);
          setState(event.state === "failed" ? "error" : "idle");
          if (event.state === "failed")
            setError("XCP acquisition stopped due to a backend read error");
          detach();
        }
      } catch (cause) {
        setError(describeError(cause));
        setState("error");
        detach();
      }
    };
    ws.onerror = () => {
      if (socket.current === ws) {
        setError("WebSocket transport error; backend acquisition may still be active");
        setState("error");
      }
    };
    ws.onclose = () => {
      if (socket.current !== ws) return;
      socket.current = null;
      setError("Live view disconnected; reattach to the existing backend acquisition");
      setState("error");
    };
  }, [detach]);

  const reattach = useCallback(async () => {
    if (!connected) return;
    try {
      const existing = await acquisitionApi.current();
      if (!mounted.current) return;
      setStatus(existing);
      if (existing.state === "running") attach(existing);
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof VersionedApiError && cause.code === "ACQUISITION_NOT_FOUND") {
        setStatus(null);
        setState("idle");
        return;
      }
      setError(describeError(cause));
      setState("error");
    }
  }, [attach, connected]);

  useEffect(() => {
    mounted.current = true;
    if (connected) void reattach();
    else {
      detach();
      setState("idle");
    }
    // Detach the UI only; do not stop the backend-owned acquisition.
    return () => {
      mounted.current = false;
      detach();
    };
  }, [connected, detach, reattach]);

  const start = useCallback(async (signals: SignalDefinition[], intervalMs: number) => {
    if (!connected) {
      setError("Connect the simulator before starting acquisition");
      setState("error");
      return;
    }
    detach();
    setError("");
    setState("connecting");
    try {
      const created = await acquisitionApi.create(
        intervalMs,
        signals.map(({ name, address, value_type }) => ({ name, address, value_type })),
      );
      if (!mounted.current) return;
      setFrames([]);
      setLatest(null);
      setReceived(0);
      setDropped(0);
      pendingDrops.current = 0;
      pausedRef.current = false;
      setPaused(false);
      attach(created);
    } catch (cause) {
      if (!mounted.current) return;
      setError(describeError(cause));
      setState("error");
    }
  }, [attach, connected, detach]);

  const stop = useCallback(async () => {
    const id = activeId.current ?? status?.acquisition_id;
    if (!id) return;
    try {
      const stopped = await acquisitionApi.stop(id);
      if (!mounted.current) return;
      detach();
      setStatus(stopped);
      setState("idle");
      setError("");
    } catch (cause) {
      if (!mounted.current) return;
      setError(describeError(cause));
      setState("error");
    }
  }, [detach, status?.acquisition_id]);

  const togglePause = useCallback(() => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  }, []);

  const clear = useCallback(() => {
    setFrames([]);
    setReceived(0);
    setDropped(0);
    pendingDrops.current = 0;
    setLatest(null);
  }, []);

  return {
    state, status, frames, latest, error, received, dropped, paused,
    start, stop, reattach, togglePause, clear,
  };
}
