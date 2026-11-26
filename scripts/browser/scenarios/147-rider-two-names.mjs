// Two names on a mounted pair's token (issue 1055, ruling 5). A goblin on a
// wolf is one token for two creatures, so wherever the table picks a
// creature by that token it asks which of the two, by face and name, with no
// default.
//
// The ride past: the GM of the seed's Rideby Table walks the wolf away from
// the lead's fighter with the goblin on its back. Her card has no plain
// Strike: it offers "Strike Goblin" and "Strike Wolf" beside Let it go, each
// finger-sized, inside the phone's width, by day and by night, through axe.
// She strikes the goblin, and the goblin alone is hurt.
//
// The tap: on her own turn she opens her figure's dial, picks Attack and
// taps the pair's token. Two chips ask "Goblin or Wolf?", each a finger's
// 40px, and the one she picks is the one her sentence names. Cancelled with
// the two names up, the next Attack opens on the target list again. The engine's half is held by
// scripts/test-enforce-rider-two-names.mjs.
import { request } from "playwright-core";
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const scenario = {
  name: "rider-two-names",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport } = t;
    const tables = ids.ridebyTables[viewport];
    const gm = await request.newContext();
    const setTheme = async (mode) => {
      await page.evaluate((choice) => (document.documentElement.dataset.theme = choice), mode);
      await untilStill(page);
    };
    try {
      const signed = await gm.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player signed in (${signed.status()})`);

      // ---- the ride past ----
      const ride = tables.ride;
      const state = async () => (await gm.get(`${base}/api/campaigns/${ride.id}`)).json();
      const hpOf = async (id) => ((await state()).encounter?.enemies ?? []).find((enemy) => enemy.id === id)?.currentHp;
      await t.open(`/campaigns/${ride.id}`);
      await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });
      if (viewport === "phone") {
        const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true });
        if (await tab.count()) await t.tap(tab);
      }
      await untilStill(page);
      const moved = await gm.post(`${base}/api/campaigns/${ride.id}/dm/invoke`, { data: { name: "move_token", args: { token: ride.mount, x: 7, y: 6 } } });
      const walked = await moved.json().catch(() => ({}));
      check(moved.ok() && (walked.result ?? walked).parked === true, `the wolf's walk waited on the lead (${moved.status()}: ${JSON.stringify(walked).slice(0, 300)})`);
      const line = new RegExp(`^${escape(ride.mountName)} is moving out of your reach with ${escape(ride.riderName)} on its back\\.`);
      const card = page.getByRole("group", { name: line }).locator("visible=true");
      await eventually(() => card.count(), { timeoutMs: 30_000, label: "the card asking the lead about the pair riding past" });
      await untilStill(page);
      const atRider = card.getByRole("button", { name: `Strike ${ride.riderName}`, exact: true });
      const atMount = card.getByRole("button", { name: `Strike ${ride.mountName}`, exact: true });
      const letGo = card.getByRole("button", { name: "Let it go", exact: true });
      check(!(await card.getByRole("button", { name: "Strike", exact: true }).count()), "the pair's card still has a Strike that names nobody");
      const width = page.viewportSize().width;
      for (const button of [atRider, atMount, letGo]) {
        const box = await button.boundingBox();
        check((box?.height ?? 0) >= 40 && (box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= width, `a whole finger-sized button (${JSON.stringify(box)})`);
      }
      check((await atRider.locator("img").count()) + (await atMount.locator("img").count()) === 2, "each of the two has a face on its button");
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the card does not push the page sideways");
      const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
      await setTheme("dark");
      const night = await axeViolations(page, `${root}.opportunity-ask`);
      check(!night.length, `axe on the card at night: ${night.map((entry) => entry.id).join(", ")}`);
      await t.shot("card-night");
      await setTheme("light");
      const day = await axeViolations(page, `${root}.opportunity-ask`);
      check(!day.length, `axe on the card by day: ${day.map((entry) => entry.id).join(", ")}`);
      await t.shot("card-day");
      await setTheme(theme);
      const [riderBefore, mountBefore] = [await hpOf(ride.rider), await hpOf(ride.mount)];
      await t.tap(atRider);
      await eventually(async () => !(await card.count()), { timeoutMs: 15_000, label: "the card gone once the lead strikes" });
      await eventually(async () => ((await state()).encounter?.reactionsUsed ?? []).some((key) => key.includes(ride.hero)), { timeoutMs: 15_000, label: "the strike spending the lead's reaction" });
      check((await hpOf(ride.mount)) === mountBefore, `a swing at the goblin hurt the wolf (${mountBefore} to ${await hpOf(ride.mount)})`);
      check((await hpOf(ride.rider)) <= riderBefore, "the goblin gained hit points from a swing");

      // ---- the tap ----
      const aim = tables.aim;
      await t.open(`/campaigns/${aim.id}`);
      if (viewport === "phone") {
        const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Battle", exact: true }).locator("visible=true").first();
        await eventually(() => tab.isVisible(), { timeoutMs: 30_000, label: "the phone's bar" });
        await t.tap(tab);
      }
      const tokens = page.locator(`${root}[data-token-id]`).locator("visible=true");
      await eventually(async () => (await tokens.count()) >= 2, { timeoutMs: 30_000, label: "the board's two tokens" });
      const title = page.getByText("Roll initiative", { exact: true }).locator("visible=true");
      await eventually(async () => (await title.count()) === 0, { timeoutMs: 30_000, label: "the title card gone" });
      const hide = page.locator(`${root}button`, { hasText: /^Hide$/i }).locator("visible=true").first();
      if (await hide.count()) {
        await t.tap(hide);
      }
      await untilStill(page).catch(() => undefined);
      const board = page.locator(`${root}.board-panel`).locator("visible=true").first();
      const mine = board.getByRole("img", { name: /^Wren Ashby/ }).first();
      const pair = board.getByRole("img", { name: new RegExp(`^${escape(aim.riderName)}`) }).first();
      await t.tap(mine);
      const dial = board.getByRole("menu", { name: /^Actions for Wren Ashby/ });
      await eventually(() => dial.count(), { label: "the lead's own dial" });
      await t.tap(dial.getByLabel("Attack", { exact: true }));
      await untilStill(page).catch(() => undefined);
      await t.tap(pair);
      const which = page.getByRole("group", { name: `${aim.riderName} or ${aim.mountName}?`, exact: true }).locator("visible=true");
      await eventually(() => which.count(), { timeoutMs: 15_000, label: "the two names asked for the pair's token" });
      const chips = which.getByRole("button");
      check((await chips.count()) === 2, `two choices for the pair (${await chips.count()})`);
      for (const name of [aim.riderName, aim.mountName]) {
        const chip = which.getByRole("button", { name: new RegExp(`^${escape(name)}`) });
        const box = await chip.boundingBox();
        check((box?.height ?? 0) >= 40 && (await chip.locator("img").count()) === 1, `${name}'s chip has a face and a finger's height (${JSON.stringify(box)})`);
      }
      await setTheme("dark");
      await t.shot("tap-night");
      await setTheme("light");
      await t.shot("tap-day");
      await setTheme(theme);
      // An aim cancelled with the two names up leaves nothing behind: the
      // next Attack opens on the target list, not on the old pair's choice.
      await t.tap(page.getByRole("button", { name: "Cancel aiming", exact: true }).locator("visible=true").first());
      await eventually(async () => !(await which.count()), { timeoutMs: 15_000, label: "the two names gone with the aim" });
      // The figure's plate may answer the first tap; the dial the next.
      await t.tap(mine);
      await eventually(() => dial.count(), { timeoutMs: 3_000, label: "the dial" }).catch(() => t.tap(mine));
      await eventually(() => dial.count(), { label: "the lead's own dial again" });
      await t.tap(dial.getByLabel("Attack", { exact: true }));
      await untilStill(page).catch(() => undefined);
      check(!(await which.count()), "a new aim opened on the choice a cancelled aim had asked");
      await t.tap(pair);
      await eventually(() => which.count(), { timeoutMs: 15_000, label: "the two names asked again for the pair's token" });
      await t.tap(which.getByRole("button", { name: new RegExp(`^${escape(aim.mountName)}`) }));
      const box = page.locator(`${root}textarea`).locator("visible=true").first();
      await eventually(async () => (await box.inputValue().catch(() => "")) === `I attack ${aim.mountName}.`, { timeoutMs: 15_000, label: "the sentence naming the wolf the lead picked" });
      check(!(await which.count()), "the choice stayed up after it was made");
    } finally {
      await gm.dispose();
    }
  },
};

export default scenario;
