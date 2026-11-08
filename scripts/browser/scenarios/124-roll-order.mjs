// Issue 843: the roll toast showed whichever roll the stream heard last, so an
// attack's damage replaced its to-hit before anyone could read it (and with
// 3D dice on, while the d20 was still in the air). Rolls now take the toast
// one at a time, in the order they were rolled: an unthrown roll holds it for
// a readable beat while others wait, and a thrown one shows when its dice
// land. The rules behind the order are held by scripts/test-roll-stage.mjs;
// this is what only a page can see.
import { check, eventually, sleep } from "../lib.mjs";

const STEP_MS = 1_000;

const scenario = {
  name: "roll-order",
  viewports: ["desktop"],
  async run(t) {
    const { page, root, ids, base, api } = t;
    await t.open(`/campaigns/${ids.quietId}`);
    await eventually(() => page.locator(`${root}#dice-overlay`).count(), { timeoutMs: 30_000, label: "the dice stage" });
    const dice = (on) =>
      page.evaluate((value) => {
        window.localStorage.setItem("odm:dice3d", value ? "on" : "off");
        window.dispatchEvent(new Event("odm-dice3d-pref"));
      }, on);
    // Every toast the page shows, with when it appeared.
    await page.evaluate(() => {
      window.__odmToasts = [];
      const read = () => {
        const text = document.querySelector(".cine-roll .cine-roll-math")?.textContent?.trim() ?? "";
        if (text && window.__odmToasts.at(-1)?.text !== text) window.__odmToasts.push({ text, at: performance.now() });
      };
      new MutationObserver(read).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    const toasts = () => page.evaluate(() => window.__odmToasts);
    const roll = async (expression) => {
      const response = await api.post(`${base}/api/campaigns/${ids.quietId}/rolls`, { data: { expression } });
      check(response.ok(), `the ${expression} roll was refused (${response.status()})`);
    };

    // 3D dice off: three rolls back to back, the way an attack, its damage
    // and an on-hit die arrive. Each takes the toast in turn and holds it.
    await dice(false);
    const burst = ["1d20+5", "2d6+3", "1d8+1"];
    for (const expression of burst) await roll(expression);
    await eventually(async () => (await toasts()).length >= burst.length, { timeoutMs: 15_000, label: "a toast for each roll" });
    const seen = await toasts();
    check(
      burst.every((expression, index) => seen[index]?.text.startsWith(`${expression} =`)),
      `the toasts in the order rolled: ${seen.map((entry) => entry.text).join(" | ")}`,
    );
    for (let index = 0; index < burst.length - 1; index += 1) {
      const held = seen[index + 1].at - seen[index].at;
      check(held >= STEP_MS, `the ${burst[index]} toast held ${Math.round(held)}ms before the next replaced it`);
    }
    await t.shot("roll-order");

    // 3D dice on: a roll's toast waits for its dice to land.
    const webgl = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
    });
    if (!webgl) {
      console.log("[roll-order] no WebGL in this browser: the thrown half is skipped");
      return;
    }
    await sleep(6_000);
    await dice(true);
    await page.evaluate(() => (window.__odmToasts = []));
    const posted = await page.evaluate(() => performance.now());
    await roll("1d20+2");
    await eventually(async () => (await toasts()).length >= 1, { timeoutMs: 20_000, label: "the thrown roll's toast" });
    const [landed] = await toasts();
    check(landed.text.startsWith("1d20+2 ="), `the thrown roll's toast (${landed.text})`);
    check(landed.at - posted >= 800, `the toast waited for the dice (${Math.round(landed.at - posted)}ms after the roll)`);
    await eventually(async () => (await page.locator(`${root}#dice-overlay`).getAttribute("data-dice")) === "idle", {
      timeoutMs: 20_000,
      label: "the tray going idle",
    });
  },
};

export default scenario;
