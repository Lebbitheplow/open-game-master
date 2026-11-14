// The ask before a character's opportunity attack (src/lib/dm/opportunity-ask.ts):
// SRD 5.1 says a character "can" make one, and it spends the reaction a
// player may be keeping for Shield or Hellish Rebuke, so the walk stops and
// asks. The GM of the seed's Breakaway Table walks its goblin away from the
// lead's fighter; the lead's table shows "The Goblin is moving out of your
// reach. Take your opportunity attack with your Longsword? It uses your
// reaction." with Strike and Let it go. The first time the GM's screen is
// open too, so the card counts down; Let it go keeps the reaction and the
// goblin walks on. The GM walks it back beside her and away again, and with
// nobody else at the table there is no clock; Strike swings and spends the
// reaction. Finger-sized, inside the phone's width, by day and by night,
// through axe, and from the keyboard. The engine's half is held by
// scripts/test-enforce-opportunity-ask.mjs.
import { request } from "playwright-core";
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const scenario = {
  name: "opportunity-ask",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport } = t;
    const table = ids.opportunityTables[viewport];
    // The table is the player's to run: the GM's calls go out as them.
    const gm = await request.newContext();
    const watching = new AbortController();
    try {
      const signed = await gm.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player signed in (${signed.status()})`);
      const walk = async (x) => {
        const moved = await gm.post(`${base}/api/campaigns/${table.id}/dm/invoke`, { data: { name: "move_token", args: { token: table.goblin, x, y: 6 } } });
        const body = await moved.json().catch(() => ({}));
        check(moved.ok() && (body.ok ?? true) !== false, `the GM's move_token went through (${moved.status()}: ${JSON.stringify(body).slice(0, 300)})`);
        return body.result ?? body;
      };
      const state = async () => (await gm.get(`${base}/api/campaigns/${table.id}`)).json();
      const reacted = async () => ((await state()).encounter?.reactionsUsed ?? []).some((key) => key.includes(table.hero));

      // The GM's own screen is open on the table: the card's clock runs only
      // while someone besides its player is there to be held up.
      const cookie = (await gm.storageState()).cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ");
      const stream = await fetch(`${base}/api/campaigns/${table.id}/events`, { headers: { cookie }, signal: watching.signal });
      check(stream.ok, `the GM's stream opened (${stream.status})`);
      await t.open(`/campaigns/${table.id}`);
      await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });
      if (viewport === "phone") {
        const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true });
        if (await tab.count()) await t.tap(tab);
      }
      // The lead's page holds the table open: she is at the table, and asked.
      const line = new RegExp(`^${table.goblinName} is moving out of your reach\\. Take your opportunity attack with your Longsword\\? It uses your reaction\\.$`);
      const card = page.getByRole("group", { name: line }).locator("visible=true");
      await untilStill(page);
      check((await walk(4)).parked === true, "the goblin's walk did not wait on the lead");
      await eventually(() => card.count(), { timeoutMs: 30_000, label: "the card asking the lead about the goblin's walk" });
      await untilStill(page);
      const strike = card.getByRole("button", { name: "Strike", exact: true });
      const letGo = card.getByRole("button", { name: "Let it go", exact: true });
      for (const button of [strike, letGo]) {
        const box = await button.boundingBox();
        check((box?.height ?? 0) >= 40, `a finger-sized button (${box?.height}px)`);
      }
      // The clock is no live region: each choice names it, so the time left
      // is heard as the keyboard reaches the button.
      const described = await letGo.evaluate((node) => document.getElementById(node.getAttribute("aria-describedby") ?? "")?.textContent ?? "");
      check(/^If nobody answers, the attack is taken in \d+s$/.test(described), `Let it go is described by the clock (${described})`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the card does not push the page sideways");
      await t.shot("card-clock");
      // From the keyboard: Let it go spends nothing, and the goblin walks on.
      await letGo.focus();
      await page.keyboard.press("Enter");
      await eventually(async () => !(await card.count()), { timeoutMs: 15_000, label: "the card gone once the lead lets it go" });
      check(!(await reacted()), "letting it go spent the lead's reaction");
      const away = (await state()).battleMap?.tokens?.find?.((token) => token.refId === table.goblin);
      if (away) check(away.x === 4, `the goblin walked on to where it was going (${away.x},${away.y})`);

      // The GM's screen closes: alone at the table, the lead is asked with no
      // clock. The server hears the stream go a moment later.
      watching.abort();
      await page.waitForTimeout(1500);
      await walk(3);
      check((await walk(4)).parked === true, "the goblin's second breakaway did not wait on the lead");
      await eventually(() => card.count(), { timeoutMs: 30_000, label: "the card asking again once the goblin breaks away a second time" });
      await untilStill(page);
      const open = ((await state()).pendingRolls ?? []).find((entry) => entry.parkedFor === "opportunity");
      check(open && !open.carry?.ask?.deadline, `a lead alone at the table is given a clock (${JSON.stringify(open?.carry?.ask)})`);
      check(!(await card.getByText(/attack is taken in/).count()), "the card counts down with nobody else at the table");
      if (viewport === "phone") {
        // The harness's phone is 412px wide; a small phone is 375px.
        const size = page.viewportSize();
        await page.setViewportSize({ width: 375, height: size.height });
        await untilStill(page);
        check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "nor on a 375px phone");
        for (const button of [strike, letGo]) {
          const box = await button.boundingBox();
          check((box?.height ?? 0) >= 40 && (box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 375, `a whole finger-sized button at 375px (${JSON.stringify(box)})`);
        }
        await page.setViewportSize(size);
        await untilStill(page);
      }
      const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
      await untilStill(page);
      const night = await axeViolations(page, `${root}.opportunity-ask`);
      check(!night.length, `axe on the card at night: ${night.map((entry) => entry.id).join(", ")}`);
      await t.shot("card-night");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      const day = await axeViolations(page, `${root}.opportunity-ask`);
      check(!day.length, `axe on the card by day: ${day.map((entry) => entry.id).join(", ")}`);
      await t.shot("card-day");
      await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
      await untilStill(page);

      // Strike: the swing is rolled and the reaction spent.
      await t.tap(strike);
      await eventually(async () => !(await card.count()), { timeoutMs: 15_000, label: "the card gone once the lead strikes" });
      await eventually(() => reacted(), { timeoutMs: 15_000, label: "the strike spending the lead's reaction" });
    } finally {
      watching.abort();
      await gm.dispose();
    }
  },
};

export default scenario;
