import { useState } from "react";
import { api, decodeValue, parseAddress } from "../../core/api";
import type { SignalType } from "../../core/api";
import { signalTypes } from "../../core/signals";

type Props = { connected: boolean; busy: boolean; onConnect: () => Promise<void>; onDisconnect: () => Promise<void> };
export function ConnectionsPage({ connected, busy, onConnect, onDisconnect }: Props) {
  const [address, setAddress] = useState("0x1000");
  const [count, setCount] = useState(4);
  const [type, setType] = useState<SignalType>("u32");
  const [hex, setHex] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const read = async () => {
    setError(""); setReading(true);
    try {
      const result = await api.read(parseAddress(address), count);
      setHex(result.hex);
      try { setValue(String(decodeValue(result.bytes, type))); }
      catch { setValue("Not enough bytes for selected type"); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setReading(false); }
  };
  return <div className="workspace-stack">
    <div className="stats-row">
      <div className="stat-tile"><span>TRANSPORT</span><strong>Simulation</strong><small>In-process XCP slave</small></div>
      <div className="stat-tile"><span>SESSION</span><strong>{connected ? "Connected" : "Disconnected"}</strong><small>XCP over simulated CAN</small></div>
      <div className="stat-tile"><span>REQUEST ID</span><strong>0x667</strong><small>Default CAN identifier</small></div>
      <div className="stat-tile"><span>RESPONSE ID</span><strong>0x666</strong><small>Default CAN identifier</small></div>
    </div>
    <section className="panel">
      <div className="panel-heading"><div><h2>XCP connection</h2><p>Establish a session with the built-in ECU simulator</p></div>
        <span className={connected ? "state-pill online" : "state-pill"}>{connected ? "CONNECTED" : "OFFLINE"}</span></div>
      <div className="toolbar">
        <button className="button primary" disabled={busy || connected} onClick={() => void onConnect()}>Connect simulator</button>
        <button className="button danger" disabled={busy || !connected} onClick={() => void onDisconnect()}>Disconnect</button>
      </div>
      <p className="muted">Physical PCAN and Vector adapters are not yet connected to this backend API.</p>
    </section>
    <section className="panel">
      <div className="panel-heading"><div><h2>Memory inspector</h2><p>Read raw bytes and decode little-endian ECU values</p></div></div>
      <form className="toolbar" onSubmit={e => { e.preventDefault(); void read(); }}>
        <label className="field-group">Address<input className="field" value={address} onChange={e => setAddress(e.target.value)} /></label>
        <label className="field-group">Bytes<input className="field" type="number" min="1" max="4096" value={count} onChange={e => setCount(Number(e.target.value))} /></label>
        <label className="field-group">Decode<select value={type} onChange={e => setType(e.target.value as SignalType)}>
          {signalTypes.map(value => <option key={value}>{value}</option>)}</select></label>
        <button className="button primary" disabled={!connected || reading || count < 1 || count > 4096}>Read memory</button>
      </form>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="inspector-grid"><div><span>RAW HEX</span><strong className="mono">{hex || "—"}</strong></div>
        <div><span>DECODED VALUE</span><strong>{value || "—"}</strong></div></div>
    </section>
  </div>;
}
