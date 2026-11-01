/**
 * End-to-end browser check of the Pages-only React app and uPlot Canvas.
 * Launch from repo root after npm ci in frontend; requires Windows Edge.
 * No Rust server or ECU connection is made.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = "http://127.0.0.1:5174/xcp-studio/";
const screenshot = process.env.XCP_E2E_SCREENSHOT;
const children = [];

function launch(command, args, cwd, env = process.env, shell = false) {
  const child = spawn(command, args, {
    cwd, env, shell, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const record = data => { output = (output + String(data)).slice(-10000); };
  child.stdout.on("data", record);
  child.stderr.on("data", record);
  children.push({ child, output: () => output });
  return child;
}

async function killTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true, stdio: "ignore",
    });
    await new Promise(done => {
      killer.once("exit", done);
      killer.once("error", done);
    });
  } else child.kill("SIGTERM");
}

async function run() {
  assert.equal(process.platform, "win32", "Windows Edge smoke check needs a Windows runner");
  const edge = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find(existsSync);
  assert.ok(edge, "Microsoft Edge executable missing");

  launch("npm", ["run","dev","--","--host","127.0.0.1","--port","5174","--strictPort"],
    join(root, "frontend"), { ...process.env, VITE_DEMO: "1" }, true);
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(700) });
      if (response.ok) { ready = true; break; }
    } catch { /* Vite still starting. */ }
    await delay(180);
  }
  assert.ok(ready, "Demo Vite dev server did not start");

  const profile = mkdtempSync(join(tmpdir(), "xcp-pages-demo-"));
  const browser = launch(edge, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--no-sandbox",
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
    "--remote-allow-origins=*", "--window-size=1440,1600",
    "--user-data-dir=" + profile, url,
  ], root);

  let ws;
  try {
    let port = 0;
    for (let attempt = 0; attempt < 130; attempt++) {
      const file = join(profile, "DevToolsActivePort");
      if (existsSync(file)) {
        port = Number(readFileSync(file, "utf8").split(/\r?\n/)[0]);
        if (port > 0) break;
      }
      if (browser.exitCode !== null) throw new Error("Edge exited: " + browser.exitCode);
      await delay(130);
    }
    assert.ok(port, "Edge CDP port not created");

    let target;
    for (let attempt = 0; attempt < 70; attempt++) {
      try {
        const response = await fetch("http://127.0.0.1:" + port + "/json/list", {
          signal: AbortSignal.timeout(1500),
        });
        const pages = await response.json();
        target = pages.find(page => page.type === "page" && page.webSocketDebuggerUrl);
        if (target) break;
      } catch { /* tab may still be starting. */ }
      await delay(180);
    }
    assert.ok(target, "Edge CDP page target missing");

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await Promise.race([
      new Promise((done, fail) => {
        ws.addEventListener("open", done, { once:true });
        ws.addEventListener("error", fail, { once:true });
      }),
      delay(10000).then(() => { throw new Error("CDP connection timed out"); }),
    ]);
    let commandId = 0;
    const pending = new Map();
    ws.addEventListener("message", event => {
      const reply = JSON.parse(String(event.data));
      const item = pending.get(reply.id);
      if (!item) return;
      pending.delete(reply.id);
      clearTimeout(item.timer);
      if (reply.error) item.reject(new Error(reply.error.message));
      else item.resolve(reply.result);
    });
    const cdp = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
      const id = ++commandId;
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectCall(new Error("CDP timeout: " + method));
      }, 10000);
      pending.set(id, { resolve:resolveCall, reject:rejectCall, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
    await cdp("Page.enable");
    await cdp("Runtime.enable");
    await cdp("Emulation.setDeviceMetricsOverride", {
      width:1440, height:1600, deviceScaleFactor:1, mobile:false,
    });
    await cdp("Page.navigate", { url });

    const evaluate = async expression => {
      const result = await cdp("Runtime.evaluate", { expression, returnByValue:true });
      if (result.exceptionDetails)
        throw new Error("Browser expression error: " + result.exceptionDetails.text);
      return result.result?.value;
    };
    let state;
    const deadline = Date.now() + 24000;
    while (Date.now() < deadline) {
      state = await evaluate(
        "(() => ({ title:document.querySelector('h1')?.textContent," +
        " demo:!!document.querySelector('.demo-notice')," +
        " live:document.body.innerText.includes('Receiving live samples')," +
        " canvases:document.querySelectorAll('.uplot-host canvas').length," +
        " windows:document.querySelectorAll('.live-window').length," +
        " rate:parseFloat(document.querySelector('.live-metrics>div:nth-child(2) strong')?.textContent||'0')," +
        " body:document.body.innerText.slice(0,450) }))()",
      );
      if (state?.title === "Live View" && state.demo && state.live &&
          state.canvases >= 2 && state.windows === 2 && state.rate > 0) break;
      await delay(280);
    }
    assert.ok(state?.title === "Live View" && state.demo && state.live &&
      state.canvases >= 2 && state.windows === 2 && state.rate > 0,
      "Real demo UI failed to show moving charts: " + JSON.stringify(state));
    console.log("PASS browser demo: LIVE, two Canvas charts, draggable windows and positive Hz");

    const clicked = await evaluate(
      "(() => {const b=[...document.querySelectorAll('button')].find(e=>" +
      "e.textContent.trim()==='Pause chart');if(!b)return false;b.click();return true})()",
    );
    assert.ok(clicked, "Pause-chart control missing");
    await delay(150);
    assert.equal(await evaluate("document.body.innerText.includes('Resume chart')"), true);
    console.log("PASS live chart pause/resume React interaction");

    const image = await cdp("Page.captureScreenshot", {
      format:"png", captureBeyondViewport:true, fromSurface:true,
    });
    if (screenshot) {
      writeFileSync(resolve(screenshot), Buffer.from(image.data, "base64"));
      console.log("SCREENSHOT " + resolve(screenshot));
    }
  } finally {
    ws?.close();
    await killTree(browser);
    try { rmSync(profile, {recursive:true, force:true, maxRetries:3, retryDelay:180}); }
    catch (error) { console.warn("Profile cleanup deferred: " + String(error)); }
  }
}

try {
  await run();
} catch (error) {
  console.error(error);
  for (const item of children) console.error(item.output().slice(-2000));
  process.exitCode = 1;
} finally {
  for (const item of [...children].reverse()) await killTree(item.child);
}
