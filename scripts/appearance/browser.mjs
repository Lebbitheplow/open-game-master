// Chrome DevTools Protocol keeps the preview dependency-free. The browser uses
// a fresh, disposable profile, never the developer's signed-in profile.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function openBrowser({ browserPath, output }) {
  const executable = browserPath ?? [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ].find(existsSync);
  if (!executable || !existsSync(executable)) throw new Error("Chrome or Edge was not found. Pass --browser with the full executable path or set THEME_BROWSER.");
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, "browser-"));
  const chrome = spawn(executable, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  let ws, startError;
  chrome.on("error", error => { startError = error; });
  const pending = new Map();
  let sequence = 0;
  try {
    let targets;
    for (let i = 0; i < 100; i++) {
      if (startError) throw startError;
      try {
        const port = (await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0];
        targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        if (targets.some(target => target.type === "page")) break;
      } catch { /* The browser is still starting. */ }
      await pause(200);
    }
    const target = targets?.find(item => item.type === "page");
    if (!target) throw new Error("The isolated browser did not start within 20 seconds.");
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.onmessage = event => {
      const result = JSON.parse(event.data);
      const callback = pending.get(result.id);
      if (!callback) return;
      pending.delete(result.id);
      clearTimeout(callback.timer);
      if (result.error) callback.reject(new Error(JSON.stringify(result.error)));
      else callback.resolve(result.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 30000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    return { send, evaluate, async close() {
      try { await send("Browser.close"); } catch { /* Also terminate after a browser failure. */ }
      ws.close(); chrome.kill();
      for (const item of pending.values()) clearTimeout(item.timer);
    } };
  } catch (error) { ws?.close(); chrome.kill(); throw error; }
}
