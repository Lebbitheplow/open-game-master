// Issue 760: a reader who scrolled up during a long narration was pulled back
// to the input by the next token. The transcript counted anything within 120px
// of its end as "at the end", and tokens came faster than a scroll could leave
// that band. Scrolling up now leaves at once, whatever the distance; coming
// back to the end follows again. The follow moves the transcript alone, so a
// document taller than the window stays where the reader has it.
// The tokens are scripted, put through the page's own stream listener: both the
// browser's EventSource and the apps' fetch-backed one (client
// src/renderer/game/runtime.ts) are EventTargets that take a dm_delta listener.
import { check, eventually, sleep } from "../lib.mjs";

const TOKEN_MS = 50;
const NOTCH = 100;
const WORDS = "The ferryman lifts his lantern and the river answers with a slow cold breath of fog. ";

function plant() {
  if (window.__tokens) return;
  const streams = new Set();
  const listen = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (type === "dm_delta") streams.add(this);
    return listen.call(this, type, ...rest);
  };
  const emit = (text) => {
    for (const stream of streams) stream.dispatchEvent(new MessageEvent("dm_delta", { data: JSON.stringify({ text }) }));
  };
  let timer = null;
  window.__tokens = {
    listening: () => streams.size > 0,
    burst: (text, count) => {
      for (let index = 0; index < count; index += 1) emit(text);
    },
    start: (text, ms) => {
      timer = setInterval(() => emit(text), ms);
    },
    stop: () => clearInterval(timer),
  };
}

export default {
  name: "transcript-follow",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    await page.addInitScript(plant);
    // The app's page is already up, and its screens swap in without a load.
    if (t.app) await page.evaluate(plant);
    await t.open(`/campaigns/${ids.quietId}`);
    await eventually(() => page.evaluate(() => window.__tokens.listening()), { timeoutMs: 30_000, label: "the table's stream" });
    const log = page.locator(`${root}.session-transcript`).locator("visible=true").first();
    await log.waitFor({ state: "visible", timeout: 30_000 });
    const metrics = () => log.evaluate((el) => ({ top: el.scrollTop, gap: el.scrollHeight - el.scrollTop - el.clientHeight, room: el.scrollHeight - el.clientHeight }));
    const box = await log.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    // A finger on a phone, a wheel elsewhere. Up is a positive drag: the finger
    // moves down the screen. Touch events, as a real finger sends them: the
    // protocol's synthesized scroll gesture did not move the pane at all.
    const cdp = t.touch ? await page.context().newCDPSession(page) : null;
    const scrollUp = async (px) => {
      if (!cdp) {
        await page.mouse.move(x, y);
        await page.mouse.wheel(0, -px);
        return;
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 12; step += 1) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (px * step) / 12 }] });
        await sleep(16);
      }
      await sleep(100);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };

    await page.evaluate(({ text }) => window.__tokens.burst(text, 80), { text: WORDS });
    await eventually(async () => (await metrics()).room > NOTCH * 6, { label: "a passage long enough to scroll" });
    await log.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.evaluate(({ text, ms }) => window.__tokens.start(text, ms), { text: WORDS.slice(0, 20), ms: TOKEN_MS });
    try {
      // A reader at the end follows the words.
      const atEnd = await metrics();
      await eventually(async () => (await metrics()).top > atEnd.top, { label: "the transcript following the tokens" });
      check((await metrics()).gap < 120, `a reader at the end stays at the end (${(await metrics()).gap}px below)`);

      // One notch up, with tokens still coming, and the reader keeps the place.
      await scrollUp(NOTCH);
      await sleep(300);
      const left = await metrics();
      check(left.gap >= NOTCH * 0.75, `one notch up leaves the end while tokens come (${Math.round(left.gap)}px below)`);
      await sleep(1000);
      const later = await metrics();
      check(Math.abs(later.top - left.top) <= 2, `a reader who scrolled up stays put (moved from ${Math.round(left.top)} to ${Math.round(later.top)})`);
      check(later.gap > left.gap, `the words go on growing below that reader (${Math.round(left.gap)}px, then ${Math.round(later.gap)}px)`);

      // Back at the end, the following comes back. The tokens wait for the walk
      // back: on a phone they grow the passage about as fast as a drag covers it.
      await page.evaluate(() => window.__tokens.stop());
      await eventually(async () => {
        await scrollUp(-200);
        return (await metrics()).gap < 120;
      }, { timeoutMs: 30_000, label: "the reader back at the end" });
      await sleep(300);
      const back = await metrics();
      await page.evaluate(({ text, ms }) => window.__tokens.start(text, ms), { text: WORDS.slice(0, 20), ms: TOKEN_MS });
      await sleep(600);
      const followed = await metrics();
      check(followed.top > back.top && followed.gap < 120, `back at the end the transcript follows again (${Math.round(back.top)} to ${Math.round(followed.top)}, ${Math.round(followed.gap)}px below)`);

      // A document taller than the window keeps its place: the follow moves the
      // transcript alone (scrollIntoView moves every scroller up to the window).
      const taller = await page.evaluate(() => {
        const extra = document.createElement("div");
        extra.id = "transcript-follow-extra";
        extra.style.cssText = "height: 200px; flex: none";
        document.body.appendChild(extra);
        window.scrollTo(0, 0);
        const doc = document.scrollingElement;
        return doc.scrollHeight - doc.clientHeight;
      });
      check(taller > 0, `the test's document is taller than the window (${taller}px)`);
      await sleep(600);
      const scrolled = await page.evaluate(() => document.scrollingElement.scrollTop);
      check(scrolled === 0, `the follow leaves the document alone (scrolled ${scrolled}px)`);
    } finally {
      await page.evaluate(() => {
        window.__tokens.stop();
        document.getElementById("transcript-follow-extra")?.remove();
      }).catch(() => {});
    }
  },
};
