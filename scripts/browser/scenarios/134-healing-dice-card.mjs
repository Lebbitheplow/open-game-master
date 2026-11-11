// A fighter on real dice rolls her own Second Wind (issue 902): the GM's
// seat plays it for the lead's fighter, who is hurt, and the d10 comes to the
// lead as a roll card that says what it is for. Until then the server threw
// the die and the chronicle never showed it. She types a 7, the fighter is
// healed by 7 and her level, the answered card leaves the table (it stayed up
// for every roll a held call recorded itself), and the roll is a card in the
// chronicle. The rules are held by scripts/test-enforce-healing-real-dice.mjs;
// this is the card where the player meets it, inside the phone's width, by
// night and day.
import { request } from "playwright-core";
import { check, eventually, untilStill } from "../lib.mjs";

const scenario = {
  name: "healing-dice-card",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport, api } = t;
    const table = ids.healingDiceTables[viewport];
    const hitPoints = async () => {
      const seen = await (await api.get(`${base}/api/campaigns/${table.id}`)).json();
      return seen.sheets.find((sheet) => sheet.id === table.hero)?.currentHp;
    };
    // The table is the player's to run: the GM's calls go out as them.
    const gm = await request.newContext();
    try {
      const signed = await gm.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player signed in (${signed.status()})`);
      await t.open(`/campaigns/${table.id}`);
      if (viewport === "phone") {
        const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true });
        if (await tab.count()) await t.tap(tab);
      }
      const before = await hitPoints();
      const spent = await gm.post(`${base}/api/campaigns/${table.id}/dm/invoke`, {
        data: { name: "use_resource", args: { characterId: table.hero, resource: "Second Wind" } },
      });
      const body = await spent.json().catch(() => ({}));
      check(spent.ok(), `Second Wind waits on the lead's die (${spent.status()}): ${JSON.stringify(body).slice(0, 200)}`);

      // The card: one d10, and what it is for.
      const d10 = page.locator(`${root}input[aria-label="d10"]`).locator("visible=true");
      await eventually(() => d10.count(), { timeoutMs: 30_000, label: "the Second Wind roll card" });
      check((await d10.count()) === 1, `one d10 to enter (${await d10.count()})`);
      const what = page.locator(`${root}p`).filter({ hasText: /Second Wind \(1d10\+3\)/ }).locator("visible=true");
      check((await what.count()) > 0, "the card says the die is Second Wind's");
      check((await hitPoints()) === before, "nothing is healed before the die is in");
      await untilStill(page);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the card does not push the page sideways");
      await t.shot("second-wind-card");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      await t.shot("second-wind-card-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

      await d10.first().fill("7");
      const send = page.locator(`${root}button`).filter({ hasText: /^\s*Submit roll\s*$/ }).locator("visible=true");
      await eventually(async () => (await send.count()) && (await send.first().isEnabled()), { label: "the roll ready to send" });
      await t.tap(send.first());
      await eventually(async () => (await hitPoints()) === before + 10, { timeoutMs: 30_000, label: "the fighter healed by 7 and her level" });
      await eventually(async () => (await d10.count()) === 0, { timeoutMs: 15_000, label: "the answered roll card gone from the table" });

      // The roll is in the chronicle, a card with its own sentence.
      const note = page.locator(`${root}[data-rolled-note]`).filter({ hasText: /Second Wind/ }).locator("visible=true");
      await eventually(() => note.count(), { timeoutMs: 30_000, label: "the healing roll as a card in the chronicle" });
      await note.last().scrollIntoViewIfNeeded();
      // The stage's own throw of the die is off the screen before the picture.
      const stage = page.locator("[data-dice]").first();
      await eventually(async () => !(await stage.count()) || (await stage.getAttribute("data-dice")) === "idle", { timeoutMs: 20_000, label: "the thrown die off the screen" });
      await untilStill(page);
      await t.shot("chronicle-card");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      await t.shot("chronicle-card-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    } finally {
      await gm.dispose();
    }
  },
};

export default scenario;
