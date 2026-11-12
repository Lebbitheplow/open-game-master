// The row the after-the-roll table brought to another player's roll
// (src/lib/dm/after-roll-table.ts; Restore Balance, which #907 also brought,
// is used before the roll by the ruling on issue #908):
//   - Violent Attraction: the player's fighter enters a 15 and hits, and the
//     lead's Graviturgy wizard is offered 1d10 more damage on the hit. The
//     player's own screen says the attack hits and someone may still add to it.
// At desktop width the lead answers from the keyboard; at phone width the lead
// lets Violent Attraction stand and nothing is spent. The rules are held by
// scripts/test-enforce-after-roll-table.mjs; this is what only a page can see:
// the helper's card, finger-sized and inside the phone's width, by day and by
// night and in the app shell.
import { request } from "playwright-core";
import { axeViolations, check, enterApp, eventually, hydrated, newContext, seeAllTours, settle, signIn, untilStill } from "../lib.mjs";

const GROUP = '[role="group"][aria-label="Help Bren Ash\'s roll, or let it stand"]';
const OWN = '[role="group"][aria-label="Change this roll, or keep it"]';

const scenario = {
  name: "after-roll-helpers",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport } = t;
    const other = await request.newContext();
    const seat = await newContext(page.context().browser(), viewport, { app: t.app });
    try {
      const signed = await other.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player signed in (${signed.status()})`);
      await seeAllTours(other, base);
      const theirs = await seat.newPage();
      const press = (locator) => (t.touch && t.app ? locator.tap() : locator.click());

      // One lane: the lead's page and the player's page open on the table,
      // the player's swing made, and its d20s entered as their card sends them.
      async function lane(table, faces) {
        const state = async () => (await other.get(`${base}/api/campaigns/${table.id}`)).json();
        await t.open(`/campaigns/${table.id}`);
        if (viewport === "phone") {
          const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true });
          if (await tab.count()) await t.tap(tab);
        }
        if (t.app) {
          if (!theirs.url().startsWith("http")) await enterApp(theirs, new URL(page.url()).origin, base, { ...ids, lead: ids.player }, t.touch);
          await theirs.evaluate((to) => window.odmShell.navigation.push(to), `/campaigns/${table.id}`);
        } else {
          if (!theirs.url().startsWith("http")) await signIn(seat, base, ids.player, ids.password);
          await theirs.goto(`${base}/campaigns/${table.id}`, { waitUntil: "networkidle", timeout: 120_000 });
          await hydrated(theirs);
          await settle(theirs);
        }
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
        const entered = await other.post(`${base}/api/campaigns/${table.id}/pending-rolls/${parked.id}`, { data: { dice: faces } });
        check(entered.ok(), `the dice were entered (${entered.status()})`);
        const choices = page.locator(`${root}${GROUP}`).locator("visible=true");
        await eventually(() => choices.count(), { timeoutMs: 30_000, label: "the card on the lead's screen" });
        await page.getByText(/roll initiative/i).locator("visible=true").first().waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
        await untilStill(page);
        return { choices, state };
      }

      async function looks(choices, button, name) {
        const box = await button.boundingBox();
        check((box?.height ?? 0) >= 40, `a finger-sized button (${box?.height}px)`);
        const stand = choices.getByRole("button", { name: "Let it stand" });
        check(((await stand.boundingBox())?.height ?? 0) >= 40, "a finger-sized Let it stand");
        check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the card does not push the page sideways");
        const night = await axeViolations(page, `${root}${GROUP}`);
        check(!night.length, `axe on the card: ${night.map((entry) => entry.id).join(", ")}`);
        await t.shot(name);
        await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
        await untilStill(page);
        const day = await axeViolations(page, `${root}${GROUP}`);
        check(!day.length, `axe on the card by day: ${day.map((entry) => entry.id).join(", ")}`);
        await t.shot(`${name}-day`);
        await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
      }

      // ---- Violent Attraction: 1d10 more on the hit ----
      {
        const table = ids.attractionTables[viewport];
        const { choices, state } = await lane(table, [15]);
        check(await page.getByText(/Bren Ash rolled \d+ \(the die shows 15\) and hits\./).locator("visible=true").count(), "the lead reads that the roll hits");
        const attraction = choices.getByRole("button", { name: "Violent Attraction: add 1d10 to Bren Ash's hit" });
        // The player's own card: the hit, and who may still add to it.
        const own = theirs.locator(`${root}${OWN}`).locator("visible=true");
        await eventually(() => own.count(), { timeoutMs: 30_000, label: "the card on the player's screen" });
        const line = theirs.getByText("The attack hits. Someone may still add to its damage.").locator("visible=true");
        await eventually(() => line.count(), { timeoutMs: 15_000, label: "the hit on the player's card" });
        await theirs.getByText(/roll initiative/i).locator("visible=true").first().waitFor({ state: "hidden", timeout: 6_000 }).catch(() => {});
        await theirs.screenshot({ path: t.shotPath("attraction-roller") }).catch(() => {});
        check(!(await theirs.getByText(/attack misses/).locator("visible=true").count()), "the player's card does not call the hit a miss");
        await looks(choices, attraction, "attraction");
        await (viewport === "phone" ? choices.getByRole("button", { name: "Let it stand" }) : attraction).focus();
        await page.keyboard.press("Enter");
        await eventually(async () => !(await choices.count()), { timeoutMs: 15_000, label: "the card gone once the lead answers" });
        const after = await state();
        const wizard = after.sheets.find((sheet) => sheet.id === table.hero);
        const wanted = viewport === "phone" ? 0 : 1;
        check(wizard?.resources?.sub_violent_attraction?.used === wanted, `${wanted} use of Violent Attraction spent (${JSON.stringify(wizard?.resources?.sub_violent_attraction)})`);
        const damage = after.pendingRolls?.find((entry) => entry.kind === "damage");
        check(damage, "the hit asks the player for damage");
        check(/\+1d10$/.test(damage.expression) === (viewport !== "phone"), `the damage asked for (${damage.expression})`);
      }
    } finally {
      await other.dispose();
      await seat.close();
    }
  },
};

export default scenario;
