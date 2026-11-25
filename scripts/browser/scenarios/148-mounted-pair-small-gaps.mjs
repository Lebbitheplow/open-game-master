// Two more places a mounted pair's token is two creatures (issue 1055,
// ruling 5: "Two names on the token, no default").
//
// War Caster's spell: on the seed's Rideby Table (cast) the lead's wizard has
// Fire Bolt named for her opportunity attacks. The GM walks the wolf away
// with the goblin on its back, and her card offers "Cast at Goblin" and "Cast
// at Wolf" beside Let it go, where the spell used to be cast at the wolf with
// nobody asked. She casts at the goblin, and the wolf is not hurt.
//
// The GM's own dial: on the Rideby Table (dial) the lead runs the table. Her
// dial's Damage on the pair's token asks "Goblin or Wolf?" in the chips a
// player's tap is asked in, where it used to reach the goblin alone. She
// picks the wolf, and the wolf alone loses the hit points.
//
// The engine's half is held by scripts/test-enforce-mounted-pair-small-gaps.mjs.
import { request } from "playwright-core";
import { axeViolations, check, eventually, openPanelTab, untilStill } from "../lib.mjs";

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const scenario = {
  name: "mounted-pair-small-gaps",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, api, viewport } = t;
    const tables = ids.ridebyTables[viewport];
    const gm = await request.newContext();
    try {
      const signed = await gm.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player signed in (${signed.status()})`);

      // ---- War Caster's spell at the pair riding past ----
      const cast = tables.cast;
      const state = async () => (await gm.get(`${base}/api/campaigns/${cast.id}`)).json();
      const hpOf = async (id) => ((await state()).encounter?.enemies ?? []).find((enemy) => enemy.id === id)?.currentHp;
      await t.open(`/campaigns/${cast.id}`);
      await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });
      if (viewport === "phone") {
        const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true });
        if (await tab.count()) await t.tap(tab);
      }
      await untilStill(page);
      const moved = await gm.post(`${base}/api/campaigns/${cast.id}/dm/invoke`, { data: { name: "move_token", args: { token: cast.mount, x: 7, y: 6 } } });
      const walked = await moved.json().catch(() => ({}));
      check(moved.ok() && (walked.result ?? walked).parked === true, `the wolf's walk waited on the lead (${moved.status()}: ${JSON.stringify(walked).slice(0, 300)})`);
      const line = new RegExp(`^${escape(cast.mountName)} is moving out of your reach with ${escape(cast.riderName)} on its back\\. Cast Fire Bolt as your opportunity attack \\(War Caster\\), and at which of them\\?`);
      const card = page.getByRole("group", { name: line }).locator("visible=true");
      await eventually(() => card.count(), { timeoutMs: 30_000, label: "the card asking the lead where her spell goes" });
      await untilStill(page);
      const atRider = card.getByRole("button", { name: `Cast at ${cast.riderName}`, exact: true });
      const atMount = card.getByRole("button", { name: `Cast at ${cast.mountName}`, exact: true });
      const letGo = card.getByRole("button", { name: "Let it go", exact: true });
      check(!(await card.getByRole("button", { name: /^Strike/ }).count()), "the spell's card still offers a Strike");
      const width = page.viewportSize().width;
      for (const button of [atRider, atMount, letGo]) {
        const box = await button.boundingBox();
        check((box?.height ?? 0) >= 40 && (box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= width, `a whole finger-sized button (${JSON.stringify(box)})`);
      }
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the card does not push the page sideways");
      const found = await axeViolations(page, `${root}.opportunity-ask`);
      check(!found.length, `axe on the spell's card: ${found.map((entry) => entry.id).join(", ")}`);
      await t.shot("war-caster-card");
      const mountBefore = await hpOf(cast.mount);
      await t.tap(atRider);
      await eventually(async () => !(await card.count()), { timeoutMs: 15_000, label: "the card gone once the lead casts" });
      await eventually(async () => ((await state()).encounter?.reactionsUsed ?? []).some((key) => key.includes(cast.hero)), { timeoutMs: 15_000, label: "the cast spending the lead's reaction" });
      check((await hpOf(cast.mount)) === mountBefore, `a spell at the goblin hurt the wolf (${mountBefore} to ${await hpOf(cast.mount)})`);

      // ---- the GM's own dial on the pair's token ----
      const own = tables.dial;
      const enemy = async (id) => {
        const response = await api.get(`${base}/api/campaigns/${own.id}/encounter`);
        const body = response.ok() ? await response.json() : {};
        return (body.encounter?.enemies ?? []).find((entry) => entry.id === id) ?? null;
      };
      const hp = async (id) => Number((await enemy(id))?.currentHp ?? (await enemy(id))?.hp);
      await t.open(`/campaigns/${own.id}`);
      await openPanelTab(t, "battle");
      const board = page.locator(`${root}.board-panel`).locator("visible=true").first();
      const frame = board.locator(".board-view").first();
      await eventually(() => frame.isVisible(), { timeoutMs: 30_000, label: "the GM's board" });
      const pair = frame.getByRole("img", { name: new RegExp(`^${escape(own.riderName)}`) }).first();
      const menu = board.getByRole("menu", { name: new RegExp(`^Actions for ${escape(own.riderName)}`) });
      await eventually(() => pair.isVisible(), { label: "the pair on the board" });
      if (!(await menu.count())) {
        await t.tap(pair);
      }
      await eventually(() => menu.count(), { label: "the GM's dial on the pair" });
      const [riderHp, mountHp] = [await hp(own.rider), await hp(own.mount)];
      await t.tap(menu.getByLabel("Damage", { exact: true }));
      const which = page.getByRole("group", { name: `${own.riderName} or ${own.mountName}?`, exact: true }).locator("visible=true");
      await eventually(() => which.count(), { timeoutMs: 15_000, label: "the two names asked for the GM's damage" });
      check(!(await page.getByRole("dialog", { name: /^Damage / }).count()), "the damage prompt opened before the GM said which of the two");
      for (const name of [own.riderName, own.mountName]) {
        const chip = which.getByRole("button", { name: new RegExp(`^${escape(name)}`) });
        const box = await chip.boundingBox();
        // Rounded: the GM's board scales its chrome, and 40px measures as 39.99998.
        check(Math.round(box?.height ?? 0) >= 40 && (await chip.locator("img").count()) === 1, `${name}'s chip has a face and a finger's height (${JSON.stringify(box)})`);
      }
      await untilStill(page);
      await t.shot("gm-dial-which");
      await t.tap(which.getByRole("button", { name: new RegExp(`^${escape(own.mountName)}`) }));
      const amount = page.getByRole("dialog", { name: new RegExp(`^Damage ${escape(own.mountName)}`) }).getByRole("textbox").first();
      await eventually(() => amount.isVisible(), { label: "the damage prompt naming the wolf" });
      check(!(await which.count()), "the choice stayed up after it was made");
      await amount.fill("3");
      await untilStill(page);
      await t.shot("gm-dial-damage-mount");
      await amount.press("Enter");
      await eventually(async () => (await hp(own.mount)) === mountHp - 3, { timeoutMs: 15_000, label: `the wolf down 3 from ${mountHp}` });
      check((await hp(own.rider)) === riderHp, `damage the GM dealt the wolf hurt the goblin (${riderHp} to ${await hp(own.rider)})`);
    } finally {
      await gm.dispose();
    }
  },
};

export default scenario;
