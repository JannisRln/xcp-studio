/**
 * Real local simulator smoke test, without synthetic frontend WebSocket frames.
 *
 * Launches the compiled Rust server and the Vite dev proxy, then exercises
 * browser-shaped HTTP and WebSocket traffic. Node.js 22+ is required for its
 * built-in fetch and WebSocket APIs. No privileged ECU or external network.
 *
 * Run from repo root after cargo build -p xcp-server and frontend/npm ci:
 *   node scripts/live-view-e2e.mjs
 *
 * Optional screenshot on Windows:
 *   XCP_E2E_SCREENSHOT=<absolute-path-to-png> node scripts/live-view-e2e.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = join(root, "frontend");
const backendExe = join(
  root, "target", "debug", process.platform === "win32" ? "xcp-server.exe" : "xcp-server",
);
const api = "http://127.0.0.1:5173";
const wsBase = "ws://127.0.0.1:5173";
const children = [];

function launch(executable, args, cwd, shell = false) {
  const processHandle = spawn(executable, args, {
    cwd,
    shell,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const record = chunk => { output = (output + String(chunk)).slice(-16000); };
  processHandle.stdout.on("data", record);
  processHandle.stderr.on("data", record);
  children.push({ handle: processHandle, output: () => output });
  return processHandle;
}

async function shutdown() {
  for (const { handle } of [...children].reverse()) {
    if (!handle.pid || handle.exitCode !== null) continue;
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(handle.pid), "/T", "/F"], {
        windowsHide: true, stdio: "ignore",
      });
      await new Promise(resolveKill => {
        killer.once("exit", resolveKill);
        killer.once("error", resolveKill);
      });
    } else {
      handle.kill("SIGTERM");
    }
  }
}

async function http(path, init = {}) {
  const response = await fetch(api + path, {
    ...init,
    signal: AbortSignal.timeout(9000),
  });
  const payload = await response.json();
  return { response, payload };
}

async function waitForUrl(path, check = response => response.ok, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const response = await fetch(api + path, { signal: AbortSignal.timeout(1500) });
      if (check(response)) return response;
    } catch {
      // The Rust binary or Vite proxy can still be starting.
    }
    await delay(250);
  }
  const logs = children.map(item => item.output()).join("\n");
  throw new Error(`Timed out waiting for ${api + path}\n${logs}`);
}

function openStream(id) {
  const url = `${wsBase}/api/v1/acquisitions/${encodeURIComponent(id)}/stream`;
  const socket = new WebSocket(url);
  const pending = [];
  const waiters = [];
  let terminalError = null;
  socket.addEventListener("message", event => {
    let payload;
    try { payload = JSON.parse(String(event.data)); }
    catch (error) { terminalError = error; }
    if (payload !== undefined) {
      if (waiters.length) waiters.shift().resolve(payload);
      else pending.push(payload);
    }
  });
  socket.addEventListener("error", () => {
    terminalError = new Error(`WebSocket transport failed for ${id}`);
    while (waiters.length) waiters.shift().reject(terminalError);
  });
  socket.addEventListener("close", () => {
    terminalError ??= new Error(`WebSocket closed before next event from ${id}`);
    while (waiters.length) waiters.shift().reject(terminalError);
  });
  const opened = new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", () => rejectOpen(
      terminalError ?? new Error("WebSocket handshake failed"),
    ), { once: true });
  });
  return {
    socket,
    opened,
    next: async () => {
      if (pending.length) return pending.shift();
      if (terminalError) throw terminalError;
      return Promise.race([
        new Promise((resolveMessage, rejectMessage) =>
          waiters.push({ resolve: resolveMessage, reject: rejectMessage })),
        delay(10000).then(() => { throw new Error("Timed out waiting for XCP live sample"); }),
      ]);
    },
    close: () => { if (socket.readyState <= WebSocket.OPEN) socket.close(); },
  };
}

async function samples(stream, howMany) {
  const batches = [];
  while (batches.length < howMany) {
    const packet = await stream.next();
    if (packet.type === "status") throw new Error("Acquisition stopped during live sampling");
    if (packet.type === "samples") batches.push(packet);
  }
  return batches;
}

async function captureScreenshot() {
  const output = process.env.XCP_E2E_SCREENSHOT;
  if (!output || process.platform !== "win32") return;
  const locations = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  const edge = locations.find(existsSync);
  if (!edge) {
    console.log("Screenshot skipped: Microsoft Edge is not installed");
    return;
  }
  const shot = resolve(output);
  const runner = spawn(edge, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--window-size=1440,1100", "--virtual-time-budget=6000",
    `--screenshot=${shot}`, api + "/",
  ], { windowsHide: true, stdio: "ignore" });
  await Promise.race([
    new Promise((done, fail) => {
      runner.once("exit", code => code === 0 ? done() : fail(
        new Error(`Edge screenshot exited with code ${code}`)));
      runner.once("error", fail);
    }),
    delay(25000).then(() => {
      runner.kill();
      throw new Error("Edge screenshot timed out");
    }),
  ]);
  assert.ok(existsSync(shot), "Edge screenshot artifact was not created");
  console.log("SCREENSHOT " + shot);
}

async function run() {
  assert.ok(existsSync(backendExe),
    `Compiled Rust simulator is missing: ${backendExe}. Run cargo build -p xcp-server.`);
  assert.ok(typeof WebSocket === "function",
    "Node.js 22+ native WebSocket is required");

  launch(backendExe, [], root);
  launch("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort"],
    frontend, process.platform === "win32");
  await waitForUrl("/", response => response.ok);
  const rootHtml = await (await fetch(api + "/")).text();
  assert.match(rootHtml, /<div id="root"><\/div>/);
  await waitForUrl("/api/v1/health", response => response.ok);
  console.log("PASS Vite serves React shell and proxies the real Rust API");

  let result = await http("/api/v1/health");
  assert.equal(result.payload.mode, "simulation");
  assert.equal(result.payload.schema_version, 1);
  result = await http("/api/xcp/connect", { method: "POST" });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.connected, true);
  console.log("PASS XCP simulator connected through browser HTTP proxy");

  const configuration = {
    interval_ms: 200,
    signals: [
      { name: "Engine speed", address: 4096, value_type: "u32" },
      { name: "Coolant", address: 4100, value_type: "f32" },
    ],
  };
  result = await http("/api/v1/acquisitions", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...configuration, interval_ms: 19 }),
  });
  assert.equal(result.response.status, 422);
  assert.equal(result.payload.error.code, "INVALID_SAMPLE_INTERVAL");

  result = await http("/api/v1/acquisitions", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(configuration),
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.payload.state, "running");
  const id = result.payload.acquisition_id;
  assert.ok(id.startsWith("acq-"));

  const first = openStream(id);
  const second = openStream(id);
  await Promise.all([first.opened, second.opened]);
  result = await http("/api/v1/acquisitions/current");
  assert.equal(result.payload.acquisition_id, id);
  assert.equal(result.payload.subscriber_count, 2);
  console.log("PASS two browser WebSockets joined the SAME backend acquisition");

  const [a, b] = await Promise.all([samples(first, 6), samples(second, 6)]);
  for (const packet of [...a, ...b]) {
    assert.equal(packet.acquisition_id, id);
    assert.equal(packet.schema_version, 1);
    assert.equal(packet.samples.length, 2);
    assert.deepEqual(packet.samples.map(item => item.value), [1850, 88.5]);
    assert.ok(packet.timestamp_ms > 0);
    assert.ok(packet.monotonic_elapsed_ms >= 0);
  }
  const sharedSequence = new Set(a.map(packet => packet.sequence));
  assert.ok(b.some(packet => sharedSequence.has(packet.sequence)),
    "both clients must see at least one identical acquisition sequence");
  for (const stream of [a, b]) {
    for (let i = 1; i < stream.length; i++) {
      assert.ok(stream[i].sequence > stream[i - 1].sequence);
      assert.ok(stream[i].monotonic_elapsed_ms >= stream[i - 1].monotonic_elapsed_ms);
    }
  }
  console.log("PASS both clients receive real matching simulator batches in order");

  await captureScreenshot();
  first.close();
  const joined = openStream(id);
  await joined.opened;
  const next = (await samples(joined, 1))[0];
  assert.ok(next.sequence > a[0].sequence, "reattaching must not reset acquisition sequence");
  result = await http("/api/v1/acquisitions/current");
  assert.equal(result.payload.acquisition_id, id);
  assert.equal(result.payload.state, "running");
  console.log("PASS browser reattached without starting a second ECU acquisition");

  result = await http(`/api/v1/acquisitions/${id}/stop`, { method: "POST" });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.state, "stopped");
  joined.close();
  second.close();
  result = await http("/api/xcp/disconnect", { method: "POST" });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.connected, false);
  result = await http("/api/v1/acquisitions", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(configuration),
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.payload.error.code, "XCP_SESSION_DISCONNECTED");
  console.log("PASS stop, disconnect and disconnected-session rejection");

  console.log("LIVE VIEW E2E PASS (simulator, no physical ECU hardware)");
}

try {
  await run();
} catch (error) {
  console.error(error);
  for (const { output } of children) console.error(output().slice(-5000));
  process.exitCode = 1;
} finally {
  await shutdown();
}
