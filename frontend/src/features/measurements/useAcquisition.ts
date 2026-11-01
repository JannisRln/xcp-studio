import { useCallback, useEffect, useRef, useState } from "react";
import type { MeasurementFrame, SignalDefinition } from "../../core/api";
import {
  acquisitionApi, acquisitionWsUrl, parseAcquisitionEvent,
  type AcquisitionSamplesEvent, type AcquisitionStatus,
} from "../../core/acquisitionV1";
import { VersionedApiError } from "../../core/apiV1";
import {
  freshnessLimitMs, liveIndicator, measuredReceiveHz, recentReceiveTimes,
  reconnectDelayMs, sampleAgeMs, skippedSequences,
} from "./liveTelemetry";

export type AcquisitionState = "idle" | "connecting" | "streaming" | "error";
export const MAX_BUFFER = 2000;

/** Bound the visualization preview without implying a complete recording. */
export function appendFrame(previous: MeasurementFrame[], frame: MeasurementFrame): MeasurementFrame[] {
  return [...previous.slice(-(MAX_BUFFER - 1)), frame];
}

export function eventFrame(event: AcquisitionSamplesEvent): MeasurementFrame {
  return {
    timestamp_ms: event.timestamp_ms,
    samples: event.samples,
    acquisition_id: event.acquisition_id,
    sequence: event.sequence,
    monotonic_elapsed_ms: event.monotonic_elapsed_ms,
    dropped_since_previous: event.dropped_since_previous,
  };
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * A live view subscribes to an existing backend acquisition. Reconnects must
 * never start another polling job on the ECU, even after a browser reload.
 */
export function useAcquisition(connected: boolean) {
  const [state, setState] = useState<AcquisitionState>("idle");
  const [status, setStatus] = useState<AcquisitionStatus | null>(null);
  const [frames, setFrames] = useState<MeasurementFrame[]>([]);
  const [latest, setLatest] = useState<MeasurementFrame | null>(null);
  const [error, setError] = useState("");
  const [received, setReceived] = useState(0);
  const [dropped, setDropped] = useState(0);
  const [paused, setPaused] = useState(false);
  const [receiveHz, setReceiveHz] = useState(0);
  const [lastReceivedAt, setLastReceivedAt] = useState<number | null>(null);
  const [observedNow, setObservedNow] = useState(0);
  const [retryAttempt, setRetryAttempt] = useState(0);

  const socket = useRef<WebSocket | null>(null);
  const mounted = useRef(false);
  const pausedRef = useRef(false);
  const activeId = useRef<string | null>(null);
  const lastSequence = useRef<number | null>(null);
  const pendingDrops = useRef(0);
  const rateTimes = useRef<number[]>([]);
  const lastReceivedAtRef = useRef<number | null>(null);
  const connectionOpenedAt = useRef<number | null>(null);
  const requestVersion = useRef(0);

  const detach = useCallback(() => {
    const previous = socket.current;
    socket.current = null;
    if (previous) {
      // Closing a view is not a backend stop, and must not trigger a retry.
      previous.onopen = null;
      previous.onmessage = null;
      previous.onerror = null;
      previous.onclose = null;
      previous.close();
    }
  }, []);

  const resetForAcquisition = useCallback((id: string) => {
    if (activeId.current === id) return;
    activeId.current = id;
    lastSequence.current = null;
    pendingDrops.current = 0;
    rateTimes.current = [];
    lastReceivedAtRef.current = null;
    connectionOpenedAt.current = null;
    pausedRef.current = false;
    setPaused(false);
    setFrames([]);
    setLatest(null);
    setReceived(0);
    setDropped(0);
    setReceiveHz(0);
    setLastReceivedAt(null);
  }, []);

  const attach = useCallback((acquisition: AcquisitionStatus) => {
    detach();
    if (!mounted.current) return;
    resetForAcquisition(acquisition.acquisition_id);
    setStatus(acquisition);
    if (acquisition.state !== "running") {
      setState(acquisition.state === "failed" ? "error" : "idle");
      if (acquisition.state === "failed")
        setError(acquisition.error ?? "Backend acquisition failed");
      return;
    }

    setState("connecting");
    setError("");
    // A reattached socket has no proven new data until its first sample arrives.
    lastReceivedAtRef.current = null;
    connectionOpenedAt.current = performance.now();
    rateTimes.current = [];
    setLastReceivedAt(null);
    setReceiveHz(0);
    let ws: WebSocket;
    try {
      ws = new WebSocket(acquisitionWsUrl(
        window.location.protocol, window.location.host, acquisition.acquisition_id,
      ));
    } catch (cause) {
      setError(describeError(cause));
      setState("error");
      setRetryAttempt(count => count + 1);
      return;
    }
    socket.current = ws;

    ws.onopen = () => {
      if (socket.current !== ws) return;
      connectionOpenedAt.current = performance.now();
      setState("streaming");
      setRetryAttempt(0);
      setError("");
    };

    ws.onmessage = message => {
      if (socket.current !== ws) return;
      try {
        const event = parseAcquisitionEvent(JSON.parse(String(message.data)) as unknown);
        if (event.acquisition_id !== acquisition.acquisition_id)
          throw new Error("Acquisition ID mismatch in live data");

        if (event.type === "samples") {
          if (lastSequence.current !== null && event.sequence <= lastSequence.current)
            return; // Ignore duplicated or reordered batches after reconnect.

          const sequenceGap = skippedSequences(lastSequence.current, event.sequence);
          const missing = Math.max(sequenceGap, pendingDrops.current, event.dropped_since_previous);
          const notAlreadyCounted = Math.max(0, missing - pendingDrops.current);
          if (notAlreadyCounted) setDropped(count => count + notAlreadyCounted);
          pendingDrops.current = 0;
          lastSequence.current = event.sequence;

          const frame = eventFrame(event);
          frame.dropped_since_previous = missing;
          const now = performance.now();
          lastReceivedAtRef.current = now;
          rateTimes.current = recentReceiveTimes(rateTimes.current, now);
          setReceiveHz(measuredReceiveHz(rateTimes.current));
          setLastReceivedAt(now);
          setObservedNow(now);
          setLatest(frame);
          setReceived(count => count + 1);
          setStatus(previous => previous?.acquisition_id === event.acquisition_id
            ? { ...previous, sequence: event.sequence } : previous);
          if (!pausedRef.current)
            setFrames(previous => appendFrame(previous, frame));
        } else if (event.type === "gap") {
          pendingDrops.current += event.dropped;
          setDropped(count => count + event.dropped);
        } else {
          setStatus(previous => previous?.acquisition_id === event.acquisition_id
            ? {
              ...previous, state: event.state,
              error: event.state === "failed" ? event.reason : null,
            } : previous);
          if (event.state === "failed")
            setError("Backend XCP read failed; reconnect the ECU session before restarting.");
          setState(event.state === "failed" ? "error" : "idle");
          detach();
        }
      } catch (cause) {
        setError(`Invalid live data: ${describeError(cause)}`);
        setState("error");
        setRetryAttempt(count => count + 1);
        detach();
      }
    };

    ws.onerror = () => {
      if (socket.current !== ws) return;
      setError("Live stream transport error; attempting to reattach to the backend.");
      setState("error");
      // onclose performs retry bookkeeping.
      ws.close();
    };

    ws.onclose = () => {
      if (socket.current !== ws) return;
      socket.current = null;
      setError("Live view disconnected; trying to reattach without restarting ECU polling.");
      setState("error");
      setRetryAttempt(count => count + 1);
    };
  }, [detach, resetForAcquisition]);

  const reattach = useCallback(async () => {
    if (!mounted.current || !connected) return;
    const version = ++requestVersion.current;
    detach();
    setState("connecting");
    try {
      const existing = await acquisitionApi.current();
      if (!mounted.current || version !== requestVersion.current) return;
      attach(existing);
    } catch (cause) {
      if (!mounted.current || version !== requestVersion.current) return;
      if (cause instanceof VersionedApiError && cause.code === "ACQUISITION_NOT_FOUND") {
        setStatus(null);
        setState("idle");
        setError("");
        return;
      }
      setError(describeError(cause));
      setState("error");
      setRetryAttempt(count => count + 1);
    }
  }, [attach, connected, detach]);

  useEffect(() => {
    mounted.current = true;
    if (connected) void reattach();
    else {
      ++requestVersion.current;
      detach();
      activeId.current = null;
      setStatus(null);
      setLatest(null);
      setFrames([]);
      setState("idle");
      setError("");
      setLastReceivedAt(null);
      lastReceivedAtRef.current = null;
      connectionOpenedAt.current = null;
    }
    return () => {
      mounted.current = false;
      ++requestVersion.current;
      detach();
    };
  }, [connected, detach, reattach]);

  // Recover the VIEW with capped retries. Never call acquisitionApi.create here.
  useEffect(() => {
    if (!connected || state !== "error" || status?.state === "failed") return;
    const retry = window.setTimeout(() => void reattach(), reconnectDelayMs(retryAttempt));
    return () => window.clearTimeout(retry);
  }, [connected, state, status?.state, retryAttempt, reattach]);

  // Also recover a socket that stays open but stops delivering samples.
  // This is a VIEW watchdog; it never creates another backend acquisition.
  useEffect(() => {
    if (!connected || !status || status.state !== "running" ||
        (state !== "streaming" && state !== "connecting")) return;
    const timer = window.setInterval(() => {
      const now = performance.now();
      setObservedNow(now);
      rateTimes.current = rateTimes.current.filter(time => now - time <= 5000);
      setReceiveHz(measuredReceiveHz(rateTimes.current));
      const lastActivity = lastReceivedAtRef.current ?? connectionOpenedAt.current;
      if (lastActivity !== null &&
          now - lastActivity > freshnessLimitMs(status.interval_ms) * 2) {
        detach();
        setError("No recent XCP samples; reattaching to the existing acquisition.");
        setState("error");
        setRetryAttempt(count => count + 1);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [connected, state, status, detach]);

  const start = useCallback(async (signals: SignalDefinition[], intervalMs: number) => {
    if (!connected || !mounted.current) {
      setError("Connect the simulator before starting Live View");
      setState("error");
      return;
    }
    const version = ++requestVersion.current;
    detach();
    setError("");
    setState("connecting");
    try {
      const created = await acquisitionApi.create(
        intervalMs,
        signals.map(({ name, address, value_type }) => ({ name, address, value_type })),
      );
      if (!mounted.current || version !== requestVersion.current) return;
      attach(created);
    } catch (cause) {
      if (!mounted.current || version !== requestVersion.current) return;
      if (cause instanceof VersionedApiError && cause.code === "ACQUISITION_ALREADY_RUNNING") {
        // The backend already owns the ECU schedule; join it instead of duplicating it.
        await reattach();
        return;
      }
      setError(describeError(cause));
      setState("error");
      setRetryAttempt(count => count + 1);
    }
  }, [attach, connected, detach, reattach]);

  const stop = useCallback(async () => {
    const id = activeId.current ?? status?.acquisition_id;
    if (!id) return;
    const version = ++requestVersion.current;
    try {
      const stopped = await acquisitionApi.stop(id);
      if (!mounted.current || version !== requestVersion.current) return;
      detach();
      setStatus(stopped);
      setState("idle");
      setError("");
      setRetryAttempt(0);
    } catch (cause) {
      if (!mounted.current || version !== requestVersion.current) return;
      setError(describeError(cause));
      setState("error");
      setRetryAttempt(count => count + 1);
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

  const sampleAge = sampleAgeMs(observedNow, lastReceivedAt);
  const indicator = liveIndicator(
    connected, state, status?.state === "running", sampleAge, status?.interval_ms ?? 100,
  );
  return {
    state, status, frames, latest, error, received, dropped, paused,
    receiveHz, sampleAge, indicator, retryAttempt,
    start, stop, reattach, togglePause, clear,
  };
}
