/**
 * Rust XCP simulator -> Vite -> React/uPlot browser acceptance.
 * Run from repo root after cargo build -p xcp-server and frontend/npm ci.
 * This standalone test does not change the independently owned CI script.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { awaitHttp, frontend, launch, openBrowser, root, shutdown } from "./browserDriver.mjs";

const url = "http://127.0.0.1:5173";
const binary = join(root, "target", "debug",
  process.platform === "win32" ? "xcp-server.exe" : "xcp-server");
const downloadFolder = mkdtempSync(join(tmpdir(), "xcp-csv-test-"));
let browser;
let id;
let subscriber;
const captured = new Map();

async function json(path, init) {
  const response = await fetch(url + path, init);
  return {status:response.status,data:await response.json()};
}
async function click(text) {
  const expression = "(() => {const b=[...document.querySelectorAll('button')]" +
    ".find(x=>x.textContent.trim()===" + JSON.stringify(text) + ");" +
    "if(!b||b.disabled)return false;b.click();return true})()";
  assert.equal(await browser.evaluate(expression), true, "Cannot click " + text);
}
const viewCount = () => browser.evaluate(
  "parseInt((document.querySelector('.plot-panel .panel-heading .muted')?.textContent||'0').split('/')[0],10)",
);
async function downloadedCsv() {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const filename = readdirSync(downloadFolder).find(file => file.endsWith(".csv"));
    if (filename) return readFileSync(join(downloadFolder, filename), "utf8");
    await delay(120);
  }
  throw new Error("Browser did not download CSV after clicking Export");
}

async function run() {
  assert.ok(existsSync(binary), "Build Rust server first: cargo build -p xcp-server");
  assert.ok(typeof WebSocket === "function", "Node 22 native WebSocket required");
  launch(binary, [], root);
  launch("npm", ["run", "dev", "--", "--host", "127.0.0.1",
    "--port", "5173", "--strictPort"], frontend);
  await awaitHttp(url + "/api/v1/health");

  browser = await openBrowser(url, downloadFolder);
  await browser.cdp("Page.addScriptToEvaluateOnNewDocument", {
    source:"(() => {const Native=window.WebSocket;window.__xcpTestSockets=[];" +
      "window.WebSocket=class extends Native {constructor(...args) {" +
      "super(...args);window.__xcpTestSockets.push(this);}};})();",
  });
  await browser.navigate(url);
  await browser.waitFor("document.querySelector('h1')?.textContent === 'Live View'");
  await browser.waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Connect simulator'&&!b.disabled)");
  await click("Connect simulator");
  await browser.waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Start Live View'&&!b.disabled)");
  await click("Start Live View");
  await browser.waitFor("document.body.innerText.includes('Receiving live samples') && " +
    "document.querySelectorAll('.timeseries canvas').length >= 2 && " +
    "parseInt((document.querySelector('.plot-panel .panel-heading .muted')?.textContent||'0').split('/')[0],10) >= 5");
  const initial = await json("/api/v1/acquisitions/current");
  assert.equal(initial.data.state, "running");
  id = initial.data.acquisition_id;
  assert.ok(id);

  subscriber = new WebSocket("ws://127.0.0.1:5173/api/v1/acquisitions/" +
    encodeURIComponent(id) + "/stream");
  subscriber.addEventListener("message", event => {
    const data = JSON.parse(String(event.data));
    if (data.type === "samples") captured.set(data.sequence, data);
  });
  await new Promise((done, fail) => {
    subscriber.addEventListener("open", done, {once:true});
    subscriber.addEventListener("error", fail, {once:true});
  });
  console.log("PASS Rust simulator values through real React/uPlot Canvas");

  await click("Pause chart");
  await browser.waitFor("document.body.innerText.includes('Resume chart')");
  await delay(160);
  const frozen = await viewCount();
  const firstSequence = (await json("/api/v1/acquisitions/current")).data.sequence;
  await delay(900);
  assert.equal(await viewCount(), frozen, "Display pause advanced the chart buffer");
  const secondSequence = (await json("/api/v1/acquisitions/current")).data.sequence;
  assert.ok(secondSequence > firstSequence, "Display pause stopped backend acquisition");
  await click("Resume chart");
  await browser.waitFor("Number((document.querySelector('.plot-panel .panel-heading .muted')?.textContent||'0').split('/')[0]) > " + frozen);
  await browser.waitFor("document.body.innerText.includes('stream discontinuity')");
  console.log("PASS pause/resume preserves acquisition and visibly marks interruption");

  await click("Place cursor at oldest sample");
  await click("Place cursor at latest sample");
  await browser.waitFor("!!document.querySelector('.measurement-readout')?.innerText.match(/Δt: (?!—)/)");
  const cursor = await browser.evaluate("document.querySelector('.measurement-readout')?.innerText");
  assert.match(cursor, /Hz/);
  assert.match(cursor, /ΔY:/);
  console.log("PASS A/B cursor readouts use actual received timestamps");

  assert.equal(await browser.evaluate(
    "(() => {const ws=window.__xcpTestSockets?.findLast(s=>s.readyState===1);" +
    "if(!ws)return false;ws.close();return true})()",
  ), true);
  await browser.waitFor("document.body.innerText.includes('Receiving live samples') && " +
    "window.__xcpTestSockets?.length>=2", 20000);
  assert.equal((await json("/api/v1/acquisitions/current")).data.acquisition_id, id);
  await browser.waitFor("document.body.innerText.includes('stream discontinuity')");
  console.log("PASS WebSocket reconnect reuses single backend acquisition");

  assert.equal(await browser.evaluate(
    "(() => {const s=[...document.querySelectorAll('summary')]" +
    ".find(x=>x.textContent.includes('export recent live samples'));" +
    "if(!s)return false;s.click();return true})()",
  ), true);
  await delay(650);
  await click("Export recent CSV");
  const csv = await downloadedCsv();
  const rows = csv.trim().split(/\r?\n/).map(row => row.split(","));
  assert.deepEqual(rows[0].slice(0,5), ["acquisition_id","sequence",
    "timestamp_ms","monotonic_elapsed_ms","dropped_since_previous"]);
  assert.ok(rows.length >= 6);
  let overlaps = 0;
  let previous = 0;
  for (const fields of rows.slice(1)) {
    assert.equal(fields[0], id);
    const seq = Number(fields[1]);
    assert.ok(seq > previous);
    previous = seq;
    assert.ok(Number.isSafeInteger(Number(fields[2])) && Number(fields[2]) > 0);
    assert.ok(Number(fields[3]) >= 0 && Number(fields[4]) >= 0);
    assert.equal(Number(fields[5]), 1850);
    assert.equal(Number(fields[6]), 88.5);
    const packet = captured.get(seq);
    if (packet) {
      assert.equal(Number(fields[2]), packet.timestamp_ms);
      assert.equal(Number(fields[3]), packet.monotonic_elapsed_ms);
      assert.equal(Number(fields[5]), packet.samples[0].value);
      assert.equal(Number(fields[6]), packet.samples[1].value);
      overlaps++;
    }
  }
  assert.ok(overlaps >= 1, "CSV did not match the independent XCP WS subscriber");
  console.log("PASS browser CSV export matches backend sequence, timestamps and values");

  if (process.env.XCP_E2E_SCREENSHOT) {
    const screenshot = await browser.cdp("Page.captureScreenshot", {
      format:"png",captureBeyondViewport:true,
    });
    const path = resolve(process.env.XCP_E2E_SCREENSHOT);
    writeFileSync(path, Buffer.from(screenshot.data, "base64"));
    console.log("SCREENSHOT " + path);
  }
  console.log("EXTENDED BROWSER E2E PASS (simulator only)");
}

try { await run(); }
catch (error) { console.error(error); process.exitCode = 1; }
finally {
  subscriber?.close();
  if (id) await json("/api/v1/acquisitions/" + encodeURIComponent(id) + "/stop",
    {method:"POST"}).catch(() => {});
  await json("/api/xcp/disconnect", {method:"POST"}).catch(() => {});
  await browser?.close();
  await shutdown();
  rmSync(downloadFolder, {recursive:true,force:true,maxRetries:2});
}
