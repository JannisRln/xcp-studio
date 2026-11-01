import { useEffect, useState } from "react";
import { Frame, parseFrame, websocketUrl } from "./xcpStream";

const signals = [
  { name: "Engine speed", address: 4096, value_type: "u32" },
  { name: "Coolant temperature", address: 4100, value_type: "f32" },
];

export function LiveXcpMeasurement({ connected }: { connected: boolean }) {
  const [running, setRunning] = useState(false);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!running || !connected) return;
    const socket = new WebSocket(websocketUrl(window.location.protocol, window.location.host));
    socket.onopen = () => socket.send(JSON.stringify({ interval_ms: 100, signals }));
    socket.onmessage = event => {
      try {
        const frame = parseFrame(String(event.data));
        setFrames(current => [...current.slice(-499), frame]);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setRunning(false);
      }
    };
    socket.onerror = () => { setError("WebSocket error"); setRunning(false); };
    socket.onclose = () => setRunning(false);
    return () => socket.close();
  }, [running, connected]);

  const exportCsv = () => {
    const rows = [["timestamp_ms", ...signals.map(s => s.name)],
      ...frames.map(frame => [String(frame.timestamp_ms),
        ...signals.map(s => String(frame.samples.find(v => v.name === s.name)?.value ?? ""))])];
    const blob = new Blob([rows.map(row => row.join(",")).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "xcp-live.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <section className="panel">
    <div className="panel-head"><div><h2>Live XCP simulator</h2><p>Actual XCP reads every 100 ms, up to 500 buffered frames</p></div>
      <div className="button-group">
        <button className="secondary" disabled={!connected} onClick={() => { setError(""); setRunning(value => !value); }}>{running ? "Stop" : "Start"}</button>
        <button className="primary" disabled={!frames.length} onClick={exportCsv}>Export XCP CSV</button>
      </div></div>
    {!connected && <p className="muted">Connect the simulator under Connections first.</p>}
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="detail-line"><span>State</span><strong>{running && connected ? "Streaming" : "Stopped"}</strong></div>
    <div className="detail-line"><span>Buffered frames</span><strong>{frames.length}</strong></div>
    {signals.map(signal => <div className="detail-line" key={signal.name}>
      <span>{signal.name}</span>
      <strong>{frames.at(-1)?.samples.find(sample => sample.name === signal.name)?.value ?? "—"}</strong>
    </div>)}
    <p className="muted">XCP polling, not ECU DAQ. Export contains only retained browser frames.</p>
  </section>;
}
