// Flash of Genius on another player's save (src/lib/dm/after-roll.ts): the
// player's fighter fails a save by 2 or less, and the artificer beside them has
// the choice on their own screen, by day and by night and in the app shell. The
// roller has nothing of their own to press, so their card promises no change
// they could make. The rules are held by
// scripts/test-enforce-ally-reaction-on-roll.mjs.
import { request } from "playwright-core";
import { axeViolations, check, enterApp, eventually, hydrated, newContext, seeAllTours, settle, signIn, untilStill } from "../lib.mjs";

const GROUP = '[role="group"][aria-label="Help Bren Ash\'s roll, or let it stand"]';
const OWN = '[role="group"][aria-label="Change this roll, or keep it"]';

const scenario = {
  name: "flash-of-genius-on-roll",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport } = t;
    const table = ids.flashTables[viewport];
    const other = await request.newContext();
    const state = async () => (await other.get(`${base}/api/campaigns/${table.id}`)).json();
    const seat = await newContext(page.context().browser(), viewport, { app: t.app });
    try {
      const signed = await other.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player signed in (${signed.status()})`);
      await t.open(`/campaigns/${table.id}`);
      if (viewport === "phone") {
        const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true });
        if (await tab.count()) await t.tap(tab);
      }
      // The player's own page, open before the roll: the card's timer is short.
      await seeAllTours(other, base);
      const theirs = await seat.newPage();
      if (t.app) {
        await enterApp(theirs, new URL(page.url()).origin, base, { ...ids, lead: ids.player }, t.touch);
        await theirs.evaluate((to) => window.odmShell.navigation.push(to), `/campaigns/${table.id}`);
      } else {
        await signIn(seat, base, ids.player, ids.password);
        await theirs.goto(`${base}/campaigns/${table.id}`, { waitUntil: "networkidle", timeout: 120_000 });
        await hydrated(theirs);
        await settle(theirs);
      }
      const press = (locator) => (t.touch && t.app ? locator.tap() : locator.click());
      if (viewport === "phone") {
        const tab = theirs.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true });
        await eventually(() => tab.count(), { timeoutMs: 30_000, label: "the player's Table tab" });
        await press(tab);
      }
      await theirs.getByText(/roll initiative/i).locator("visible=true").first().waitFor({ state: "hidden", timeout: 6_000 }).catch(() => {});

      // A 9 on the die misses this DC by 2, and the artificer's +3 carries it.
      const before = await state();
      const fighter = before.sheets.find((sheet) => sheet.id === table.roller);
      const dc = 9 + Math.floor((fighter.abilities.wis - 10) / 2) + 2;
      const asked = await other.post(`${base}/api/campaigns/${table.id}/dm/invoke`, {
        data: { name: "request_roll", args: { characterId: table.roller, kind: "saving_throw", ability: "wis", dc, reason: "The gate's whisper" } },
      });
      const body = await asked.json().catch(() => ({}));
      check(asked.ok(), `the save was asked for (${asked.status()}): ${JSON.stringify(body).slice(0, 200)}`);
      const parked = (await state()).pendingRolls?.find((entry) => entry.kind === "saving_throw");
      check(parked, "the save waits for the player's dice");
      const entered = await other.post(`${base}/api/campaigns/${table.id}/pending-rolls/${parked.id}`, { data: { dice: [9] } });
      check(entered.ok(), `the 9 was entered (${entered.status()})`);

      const choices = page.locator(`${root}${GROUP}`).locator("visible=true");
      await eventually(() => choices.count(), { timeoutMs: 30_000, label: "the card on the artificer's screen" });
      const help = choices.getByRole("button", { name: "Flash of Genius: add 3" });

      // The roller's screen: who can still help, and no change of their own to promise.
      const own = theirs.locator(`${root}${OWN}`).locator("visible=true");
      await eventually(() => own.count(), { timeoutMs: 30_000, label: "the card on the player's screen" });
      const waits = theirs.getByText("Tamsin Reed can still help with this roll.").locator("visible=true");
      await eventually(() => waits.count(), { timeoutMs: 15_000, label: "who can still help" });
      const words = theirs.getByText("Before the game says what happens, someone may still help.").locator("visible=true");
      check(await words.count(), "the roller reads that someone may still help");
      check(!(await theirs.getByText("you can still change it").locator("visible=true").count()), "no promise of a change the player has no button for");
      await theirs.screenshot({ path: t.shotPath("roller") }).catch(() => {});
      // Keeping it gives the artificer their own time, and the shots take some.
      await press(own.getByRole("button", { name: "Keep this roll" }));
      await eventually(() => theirs.getByText("You kept this roll.").locator("visible=true").count(), { timeoutMs: 15_000, label: "the roll kept" });

      await untilStill(page);
      const box = await help.boundingBox();
      check((box?.height ?? 0) >= 40, `a finger-sized button (${box?.height}px)`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the card does not push the page sideways");
      const night = await axeViolations(page, `${root}${GROUP}`);
      check(!night.length, `axe on the card: ${night.map((entry) => entry.id).join(", ")}`);
      await t.shot("help");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      const day = await axeViolations(page, `${root}${GROUP}`);
      check(!day.length, `axe on the card by day: ${day.map((entry) => entry.id).join(", ")}`);
      await t.shot("help-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

      await help.focus();
      await page.keyboard.press("Enter");
      await eventually(async () => !(await choices.count()), { timeoutMs: 15_000, label: "the card gone once the use is spent" });
      const after = await state();
      const artificer = after.sheets.find((sheet) => sheet.id === table.hero);
      check(artificer?.resources?.art_flash_of_genius?.used === 1, `a use of Flash of Genius is spent (${JSON.stringify(artificer?.resources?.art_flash_of_genius)})`);
      check(!after.pendingRolls?.length, "nothing is left waiting");
    } finally {
      await other.dispose();
      await seat.close();
    }
  },
};

export default scenario;
