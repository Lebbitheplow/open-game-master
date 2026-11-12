// War God's Blessing on another player's roll (src/lib/dm/after-roll.ts): the
// player's fighter swings at a goblin and enters a 9, and the lead, whose cleric
// stands within 30 feet, sees a card with the choice on it. The player sees who
// can still help, and keeps the roll, which leaves the lead's choice open. At
// desktop width the lead adds it from the keyboard and the +10 turns the miss;
// at phone width the lead lets it stand and nothing is spent. The rules are held by
// scripts/test-enforce-ally-reaction-on-roll.mjs; this is what only a page can
// see: a card for the player who did not roll, finger-sized and inside the
// phone's width, by day and by night and in the app shell.
import { request } from "playwright-core";
import { axeViolations, check, enterApp, eventually, hydrated, newContext, seeAllTours, settle, signIn, untilStill } from "../lib.mjs";

const GROUP = '[role="group"][aria-label="Help Bren Ash\'s roll, or let it stand"]';
const OWN = '[role="group"][aria-label="Change this roll, or keep it"]';

const scenario = {
  name: "ally-reaction-on-roll",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport } = t;
    const table = ids.allyTables[viewport];
    const other = await request.newContext();
    // The player's own page, open before the roll: the card's timer is short.
    const seat = await newContext(page.context().browser(), viewport, { app: t.app });
    const state = async () => (await other.get(`${base}/api/campaigns/${table.id}`)).json();
    try {
      const signed = await other.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player signed in (${signed.status()})`);
      await t.open(`/campaigns/${table.id}`);
      if (viewport === "phone") {
        const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true });
        if (await tab.count()) await t.tap(tab);
      }
      // Their account has seen every tour, or one opens over the card.
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
      const swung = await other.post(`${base}/api/campaigns/${table.id}/dm/invoke`, {
        data: { name: "pc_attack", args: { characterId: table.roller, targetEnemyId: table.goblin, weapon: "Longsword" } },
      });
      const body = await swung.json().catch(() => ({}));
      check(swung.ok(), `the swing was made (${swung.status()}): ${JSON.stringify(body).slice(0, 200)}`);
      const parked = (await state()).pendingRolls?.find((entry) => entry.kind === "attack");
      check(parked, "the to-hit roll waits for the player's dice");
      const entered = await other.post(`${base}/api/campaigns/${table.id}/pending-rolls/${parked.id}`, { data: { dice: [9] } });
      check(entered.ok(), `the 9 was entered (${entered.status()})`);

      const choices = page.locator(`${root}${GROUP}`).locator("visible=true");
      await eventually(() => choices.count(), { timeoutMs: 30_000, label: "the card on the lead's screen" });
      const help = choices.getByRole("button", { name: "War God's Blessing: add 10" });

      // The player's screen: who can still help, and keeping the roll leaves it to them.
      const own = theirs.locator(`${root}${OWN}`).locator("visible=true");
      await eventually(() => own.count(), { timeoutMs: 30_000, label: "the card on the player's screen" });
      const line = theirs.getByText("Tamsin Reed can still help with this roll.").locator("visible=true");
      await eventually(() => line.count(), { timeoutMs: 15_000, label: "who can still help" });
      await theirs.getByText(/roll initiative/i).locator("visible=true").first().waitFor({ state: "hidden", timeout: 6_000 }).catch(() => {});
      // Keeping it first: the kept roll gets its own time, and the shots take some.
      await theirs.screenshot({ path: t.shotPath("roller") }).catch(() => {});
      check(!(await theirs.getByText("You can still change that.").locator("visible=true").count()), "no promise of a change the player has no button for");
      await press(own.getByRole("button", { name: "Keep this roll" }));
      const kept = theirs.getByText("You kept this roll.").locator("visible=true");
      await eventually(() => kept.count(), { timeoutMs: 15_000, label: "the roll kept" });
      await theirs.screenshot({ path: t.shotPath("roller-kept") }).catch(() => {});
      await theirs.evaluate(() => (document.documentElement.dataset.theme = "light"));
      const ownDay = await axeViolations(theirs, `${root}${OWN}`);
      check(!ownDay.length, `axe on the player's card by day: ${ownDay.map((entry) => entry.id).join(", ")}`);
      await theirs.screenshot({ path: t.shotPath("roller-kept-day") }).catch(() => {});
      await theirs.evaluate(() => (document.documentElement.dataset.theme = "dark"));
      check(await choices.count(), "the lead's choice is still open");

      await page.getByText(/roll initiative/i).locator("visible=true").first().waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
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

      const stand = choices.getByRole("button", { name: "Let it stand" });
      const standBox = await stand.boundingBox();
      check((standBox?.height ?? 0) >= 40, `a finger-sized Let it stand (${standBox?.height}px)`);
      await (viewport === "phone" ? stand : help).focus();
      await page.keyboard.press("Enter");
      await eventually(async () => !(await choices.count()), { timeoutMs: 15_000, label: "the card gone once the lead answers" });
      await eventually(async () => !(await kept.count()), { timeoutMs: 15_000, label: "the card gone from the player's screen" });
      const after = await state();
      const cleric = after.sheets.find((sheet) => sheet.id === table.hero);
      const wanted = viewport === "phone" ? 0 : 1;
      check(cleric?.resources?.channel_divinity?.used === wanted, `${wanted} use of Channel Divinity spent (${JSON.stringify(cleric?.resources?.channel_divinity)})`);
      const hit = after.pendingRolls?.some((entry) => entry.kind === "damage") ?? false;
      check(hit === (viewport !== "phone"), viewport === "phone" ? "the miss stands" : "the hit now asks the player for damage");
    } finally {
      await other.dispose();
      await seat.close();
    }
  },
};

export default scenario;
