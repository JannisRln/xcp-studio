import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const root = resolve(frontend, "..");
const processes = [];

export function launch(executable, args, cwd) {
  const shell = process.platform === "win32" && executable === "npm";
  const handle = spawn(executable, args, {
    cwd, shell, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let log = "";
  for (const stream of [handle.stdout, handle.stderr])
    stream.on("data", data => { log = (log + String(data)).slice(-12000); });
  processes.push({ handle, readLog: () => log });
  return handle;
}

export async function shutdown() {
  for (const { handle } of [...processes].reverse()) {
    if (!handle.pid || handle.exitCode !== null) continue;
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(handle.pid), "/T", "/F"], {
        stdio: "ignore", windowsHide: true,
      });
      await Promise.race([
        new Promise(done => { killer.once("exit", done); killer.once("error", done); }),
        delay(5000),
      ]);
    } else handle.kill("SIGTERM");
  }
}

export async function awaitHttp(url, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch { /* Server not ready yet. */ }
    await delay(200);
  }
  throw new Error("HTTP startup timeout: " + url + "\n" +
    processes.map(item => item.readLog()).join("\n"));
}

export function browserExecutable() {
  const choices = [
    process.env.XCP_BROWSER,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
  ];
  const match = choices.find(path => path && existsSync(path));
  if (!match) throw new Error("Edge/Chromium not found; set XCP_BROWSER to its executable");
  return match;
}

/** Minimal CDP driver, using Node 22 WebSocket and no extra npm packages. */
export async function openBrowser(url, downloadDirectory) {
  const profile = mkdtempSync(join(tmpdir(), "xcp-browser-"));
  const executable = browserExecutable();
  const handle = launch(executable, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run",
    "--remote-allow-origins=*", "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0", "--window-size=1440,1400",
    "--user-data-dir=" + profile, url,
  ], root);
  let socket;
  try {
    const deadline = Date.now() + 25000;
    let port;
    while (Date.now() < deadline) {
      const location = join(profile, "DevToolsActivePort");
      if (existsSync(location)) {
        port = Number(readFileSync(location, "utf8").split(/\r?\n/)[0]);
        if (port > 0) break;
      }
      if (handle.exitCode !== null)
        throw new Error("Browser terminated: " + handle.exitCode);
      await delay(100);
    }
    if (!port) throw new Error("CDP port not available");
    let page;
    while (Date.now() < deadline) {
      try {
        const targets = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
        page = targets.find(target => target.type === "page" && target.webSocketDebuggerUrl);
        if (page) break;
      } catch { /* Page target may not exist yet. */ }
      await delay(100);
    }
    if (!page) throw new Error("No browser page CDP target");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await Promise.race([
      new Promise((done, fail) => {
        socket.addEventListener("open", done, {once:true});
        socket.addEventListener("error", fail, {once:true});
      }),
      delay(10000).then(() => { throw new Error("CDP connection timeout"); }),
    ]);
    let commandId = 0;
    const pending = new Map();
    socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !pending.has(message.id)) return;
      const entry = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(entry.name + ": " + message.error.message));
      else entry.resolve(message.result);
    });
    const cdp = (name, params = {}) => new Promise((resolveCommand, rejectCommand) => {
      const id = ++commandId;
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectCommand(new Error("CDP timed out: " + name));
      }, 20000);
      pending.set(id, {name, timer, resolve:resolveCommand, reject:rejectCommand});
      socket.send(JSON.stringify({id, method:name, params}));
    });
    await cdp("Page.enable");
    await cdp("Runtime.enable");
    if (downloadDirectory) {
      try { await cdp("Browser.setDownloadBehavior", {
        behavior:"allow", downloadPath:downloadDirectory, eventsEnabled:true,
      }); } catch { await cdp("Page.setDownloadBehavior", {
        behavior:"allow", downloadPath:downloadDirectory,
      }); }
    }
    const evaluate = async expression => {
      const result = await cdp("Runtime.evaluate", {
        expression, returnByValue:true, awaitPromise:true,
      });
      if (result.exceptionDetails)
        throw new Error("Browser JS: " + (result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text));
      return result.result?.value;
    };
    const waitFor = async (expression, timeoutMs = 20000) => {
      const end = Date.now() + timeoutMs;
      let value;
      while (Date.now() < end) {
        value = await evaluate(expression);
        if (value) return value;
        await delay(120);
      }
      throw new Error("Browser assertion timeout: " + expression + "; last " + JSON.stringify(value));
    };
    return {
      cdp, evaluate, waitFor, executable,
      navigate: next => cdp("Page.navigate", {url:next}),
      async close() {
        socket.close();
        try { rmSync(profile, {recursive:true,force:true,maxRetries:2}); }
        catch { /* Browser may still release its profile asynchronously. */ }
      },
    };
  } catch (error) {
    socket?.close();
    throw error;
  }
}
