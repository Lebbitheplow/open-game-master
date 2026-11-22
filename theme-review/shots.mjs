// Review screenshots against a running `npm run theme:preview -- --theme wasteland --port 3043`.
//   node theme-review/shots.mjs [--themes wasteland,forge,inferno] [--port 3043] [--only lobby,story]
// Other themes are shown through the reader's own override, as a player would pick them.
import fs from "node:fs/promises";
import path from "node:path";
import { register } from "node:module";
register("../scripts/lib/register-alias.mjs", import.meta.url);
const { themeArt, APPEARANCE_THEMES } = await import("../src/lib/appearance-themes.ts");
const { openBrowser, pause } = await import("../scripts/appearance/browser.mjs");

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const campaignTheme = "wasteland";
const themes = arg("themes", "wasteland").split(",");
const only = arg("only", "lobby,story,combat,map,picker").split(",");
const origin = `http://127.0.0.1:${arg("port", "3043")}`;
const repo = path.resolve(import.meta.dirname, "..");
const outDir = path.join(repo, "theme-review", "screens");
await fs.mkdir(outDir, { recursive: true });
const SIZES = [["desktop", 1360, 900], ["phone", 390, 844]];
const MODES = [["night", "dark"], ["day", "light"]];

const browser = await openBrowser({ output: path.join(repo, ".theme-preview", "wasteland-shots") });
const { send, evaluate: quick } = browser;
// A busy machine can take longer than the helper's 30 seconds for one
// command, so a promise is started in the page and polled for.
let ticket = 0;
const evaluate = async (expression) => {
  const key = "__shot" + ++ticket;
  await quick(`(() => { window.${key} = { done: false }; Promise.resolve().then(() => (0, eval)(${JSON.stringify(expression)})).then(value => { window.${key} = { done: true, value }; }, error => { window.${key} = { done: true, error: String(error && error.message || error) }; }); })()`);
  for (let i = 0; i < 1200; i++) {
    const state = await quick(`window.${key}`).catch(() => null);
    if (state?.done) { if (state.error) throw new Error(state.error); return state.value; }
    await pause(250);
  }
  throw new Error("Timed out in page: " + expression.slice(0, 80));
};
const waitFor = async (expression, timeout = 90000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { if (await evaluate(expression)) return; } catch { /* navigating */ } await pause(250); }
  throw new Error("Timed out: " + expression);
};
const navigate = async (url) => {
  for (let attempt = 0; ; attempt++) {
    try { await send("Page.navigate", { url }); return; } catch (error) { if (attempt > 4) throw error; await pause(3000); }
  }
};
const click = async (selector) => {
  const point = await evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.getBoundingClientRect().width && e.getBoundingClientRect().height); if (!el) throw new Error('Missing control: ' + ${JSON.stringify(selector)}); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
};
const dimensions = async (width, height, mode) => {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await evaluate(`localStorage.setItem('odm.theme', ${JSON.stringify(mode)}); localStorage.setItem('odm.ui-scale', '1'); window.dispatchEvent(new StorageEvent('storage', { key: null }));`);
  await waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(mode)}`);
  await pause(700);
};
const preload = (id) => {
  const art = [...new Set(["dark", "light"].flatMap((mode) => Object.values(themeArt(id, mode) ?? {})))];
  return evaluate(`Promise.all(${JSON.stringify(art)}.map(src=>new Promise(resolve=>{const img=new Image();img.onload=()=>img.decode().then(resolve,resolve);img.onerror=resolve;img.src=src})))`);
};
const shot = async (name) => {
  await pause(500);
  const image = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await fs.writeFile(path.join(outDir, name + ".png"), Buffer.from(image.data, "base64"));
  console.log("shot", name);
};
const settleOverlay = () => evaluate(`Promise.all([...document.querySelector('.theme-overlay').getAnimations({subtree:true})].filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))).then(()=>true)`);

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await navigate(origin);
  await waitFor("document.readyState === 'complete'");
  const campaigns = await evaluate(`(async () => {
    const login = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:'theme_preview',password:'ThemePreview2026!'}) });
    if (!login.ok) throw new Error('Fixture login failed');
    localStorage.setItem('odm:tour:table-player','done'); localStorage.setItem('odm:tour:table-dm','done'); localStorage.setItem('odm:dice3d','off');
    return (await (await fetch('/api/campaigns')).json()).campaigns;
  })()`);
  const idOf = (end) => campaigns.find((c) => c.title.endsWith(end)).id;
  const storyId = idOf("In play"), combatId = idOf("Combat"), lobbyId = idOf("Lobby");

  for (const id of themes) {
    await evaluate(id === campaignTheme ? `localStorage.removeItem('odm.appearance')` : `localStorage.setItem('odm.appearance', ${JSON.stringify(id)})`);
    const ready = `document.documentElement.dataset.appearance === ${JSON.stringify(id)}`;
    const open = async (campaign, selector) => {
      await navigate(origin + "/campaigns/" + campaign);
      await waitFor(`!!document.querySelector(${JSON.stringify(selector)}) && ${ready}`);
      await evaluate("document.fonts.ready.then(() => true)");
      await preload(id);
      await pause(900);
    };
    if (only.includes("lobby")) {
      await open(lobbyId, ".theme-lobby-shell");
      for (const [size, width, height] of SIZES) for (const [label, mode] of MODES) {
        await dimensions(width, size === "desktop" ? 1000 : height, mode);
        await preload(id);
        await evaluate("scrollTo(0,0)");
        await shot(`${id}-lobby-${size}-${label}`);
      }
    }
    if (only.includes("story")) {
      await open(storyId, ".theme-table");
      await waitFor(`document.querySelector('.session-transcript')?.textContent.includes('Archive entry 125')`);
      for (const [size, width, height] of SIZES) for (const [label, mode] of MODES) {
        await dimensions(width, height, mode);
        await evaluate(`(() => { const e=document.querySelector('.session-transcript'); e.scrollTop=e.scrollHeight; })()`);
        await shot(`${id}-story-${size}-${label}`);
      }
    }
    if (only.includes("combat") || only.includes("map")) {
      await open(combatId, ".theme-table");
      await waitFor(`!!document.querySelector('[aria-label^="Board view"]')`);
      for (const [size, width, height] of SIZES) for (const [label, mode] of MODES) {
        await dimensions(width, height, mode);
        if (width < 1024) { await click('.cine-bottombar [data-tour="tab-battle"]'); await pause(700); }
        if (only.includes("combat")) await shot(`${id}-combat-${size}-${label}`);
        if (only.includes("map")) {
          await waitFor(`[...document.querySelectorAll('button[aria-label="Enlarge battle map"]')].some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight})`);
          await click('button[aria-label="Enlarge battle map"]');
          await waitFor(`!!document.querySelector('.theme-overlay .theme-ornaments[data-surface="overlay"]')`);
          await settleOverlay();
          await shot(`${id}-map-${size}-${label}`);
          await click('button[aria-label="Close the board"]');
          await waitFor(`!document.querySelector('.theme-overlay')`);
        }
      }
    }
    if (only.includes("picker") && id === campaignTheme) {
      await navigate(origin);
      await waitFor(`!!document.querySelector('button[aria-label="Account"]')`);
      await dimensions(1360, 900, "dark");
      await click('button[aria-label="Account"]');
      await waitFor(`[...document.querySelectorAll('[role="menuitem"]')].some(e=>e.textContent.trim()==='Appearance')`);
      await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim()==='Appearance').click()`);
      await waitFor(`!!document.querySelector('.appearance-picker')`);
      for (const [size, width, height] of SIZES) for (const [label, mode] of MODES) {
        await dimensions(width, height, mode);
        const art = [...new Set(APPEARANCE_THEMES.flatMap((theme) => Object.values(themeArt(theme.id, mode) ?? {})))];
        await evaluate(`Promise.all(${JSON.stringify(art)}.map(src=>new Promise(resolve=>{const img=new Image();img.onload=()=>img.decode().then(resolve,resolve);img.onerror=resolve;img.src=src})))`);
        await evaluate(`document.querySelector('.appearance-preview[data-appearance="${id}"]').closest('.appearance-option').scrollIntoView({block:'center',inline:'center'})`);
        await shot(`${id}-picker-${size}-${label}`);
        // The card alone, enlarged, for a close look at picker size.
        const box = await evaluate(`(() => { const r=document.querySelector('.appearance-preview[data-appearance="${id}"]').closest('.appearance-option').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
        const card = await send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
        await fs.writeFile(path.join(outDir, `${id}-picker-card-${size}-${label}.png`), Buffer.from(card.data, "base64"));
      }
    }
  }
} finally {
  await browser.close();
}
