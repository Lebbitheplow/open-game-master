// Spells magic items cast, in the Hand (src/lib/battlemap/hand-items.ts). A wand, a
// staff and a scroll each deal a card per spell that a player plays without typing:
// it names the item and the spell, shows what is left, greys with the engine's
// reason, spends one charge, and a scroll takes its card with it when it is used up.
// Items shows a section per item with its charges; the same card is under Spells at
// its level. The rules behind it are scripts/test-hand-items.mjs; this is what only a
// page can see: the cards and the section tabs on a real table, read by axe in the
// day and night themes, at phone width. The lead runs these tables and plays at them,
// so a card resolves as it is played.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const WAND = "Wand of Magic Missiles";
const MISSILE = `${WAND}: Magic Missile`;

const scenario = {
  name: "item-cards",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, api, base, ids, viewport } = t;
    const table = ids.itemTables[viewport];
    const hand = `${root}[aria-label="Your hand"]`;
    const urlOf = (id) => `${base}/api/campaigns/${id}`;
    const heroNow = async (id, hero) => ((await (await api.get(urlOf(id))).json()).sheets ?? []).find((sheet) => sheet.id === hero);
    const rowNow = async (id, hero, name) => (await heroNow(id, hero)).equipment.find((item) => item.name === name);
    const card = (name) => page.locator(`${root}button.hand-card[aria-label^="${name},"]`).locator("visible=true").first();
    const groupCard = (key) => page.locator(`${root}button.hand-group-card[data-group-id="group:${key}"]`).locator("visible=true").first();
    const back = page.locator(`${root}.hand-back`).locator("visible=true");
    const tab = (name) => page.locator(hand).getByRole("tab", { name }).locator("visible=true").first();
    const openGroup = async (key) => {
      await eventually(() => groupCard(key).count(), { timeoutMs: 30_000, label: `the ${key} group` });
      await t.tap(groupCard(key));
      await eventually(() => back.count(), { label: `the ${key} group open` });
    };
    const closeGroup = async () => {
      await t.tap(back.first());
      await eventually(async () => (await back.count()) === 0, { label: "the main hand again" });
    };
    const openTab = async (name) => {
      await eventually(() => tab(name).count(), { label: `the ${name} tab` });
      await t.tap(tab(name));
    };
    const toTableTab = async () => {
      if (viewport !== "phone") return;
      // The phone's Table tab holds the Hand.
      const bar = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true });
      if (await bar.count()) await t.tap(bar);
    };
    const inBothThemes = async (shot, selector = hand) => {
      await untilStill(page);
      const night = await axeViolations(page, selector);
      check(!night.length, `axe on ${shot} by night: ${night.map((entry) => entry.id).join(", ")}`);
      await t.shot(shot);
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      const day = await axeViolations(page, selector);
      check(!day.length, `axe on ${shot} by day: ${day.map((entry) => entry.id).join(", ")}`);
      await t.shot(`${shot}-day`);
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    };
    // Played as a card is, from the keyboard, which a fan's overlapping cards cannot
    // get in the way of: aim it at the first goblin and press the aim bar's button.
    const playAtGoblin = async (tableId, name) => {
      await card(name).focus();
      await page.keyboard.press("Enter");
      const aimBar = page.locator(`${root}.hand-aim`).locator("visible=true").first();
      await eventually(() => aimBar.count(), { label: "the aim bar" });
      await t.tap(aimBar.getByRole("group", { name: "Targets" }).getByRole("button", { name: /Goblin/ }).first());
      const commit = aimBar.getByRole("button", { name, exact: true }).first();
      await eventually(() => commit.isEnabled(), { label: `${name}'s button` });
      const played = page.waitForResponse((response) => response.url().endsWith(`/api/campaigns/${tableId}/actions`) && response.request().method() === "POST", { timeout: 30_000 });
      played.catch(() => {});
      await t.tap(commit);
      const answer = await played;
      check(answer.ok(), `${name} was taken (${answer.status()}): ${(await answer.text()).slice(0, 240)}`);
    };

    // ---- a wizard's table: a section per item, and one card under Items and Spells ----
    await t.open(`/campaigns/${table.study}`);
    await toTableTab();
    await openGroup("items");
    for (const name of [/Staff of Fire/, new RegExp(WAND), /Scrolls/, /Gear/]) {
      await eventually(() => tab(name).count(), { label: `the ${name} section` });
    }
    check((await page.locator(hand).getByRole("tablist", { name: "Items by item" }).count()) > 0, "the tabs say what they sort by");
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the tabs do not push the page sideways");
    await openTab(/Staff of Fire/);
    for (const [spell, cost] of [["Burning Hands", 1], ["Fireball", 3], ["Wall of Fire", 4]]) {
      const words = await card(`Staff of Fire: ${spell}`).innerText();
      check(words.includes(`Charges 7/10, costs ${cost}`), `${spell}'s card says what is left and what it costs (${words})`);
    }
    const box = await card("Staff of Fire: Fireball").boundingBox();
    check((box?.height ?? 0) >= 40, `a card a finger can press (${box?.height}px)`);
    await inBothThemes("staff-section");
    await openTab(new RegExp(WAND));
    await eventually(() => card(MISSILE).count(), { label: "the wand's card" });
    await inBothThemes("wand-section");
    await closeGroup();
    await openGroup("spells");
    await openTab(/Level 3/);
    await eventually(() => card("Staff of Fire: Fireball").count(), { label: "the staff's Fireball under Spells" });
    await inBothThemes("under-spells");
    await closeGroup();
    check((await page.locator(`${root}.hand-fan button.hand-card:not(.hand-group-card)[aria-label^="Staff of Fire: "]`).count()) === 0, "and not loose in the fan as well");

    // ---- greyed with the reason, and open again ----
    const setStaff = async (change, reason) => {
      const { equipment } = await heroNow(table.study, table.mage);
      const patched = await api.patch(`${urlOf(table.study)}/sheets/${table.mage}`, {
        data: { equipment: equipment.map((item) => (item.name === "Staff of Fire" ? { ...item, ...change } : item)), reason },
      });
      check(patched.ok(), `${reason} (${patched.status()})`);
    };
    await setStaff({ attuned: false }, "The staff comes loose");
    await openGroup("items");
    await openTab(/Staff of Fire/);
    await eventually(async () => /works only for someone attuned/.test((await card("Staff of Fire: Fireball").getAttribute("aria-label")) ?? ""), { timeoutMs: 15_000, label: "the staff greyed for no attunement" });
    await inBothThemes("not-attuned");
    await setStaff({ attuned: true }, "The staff is theirs again");
    await eventually(async () => !/works only/.test((await card("Staff of Fire: Fireball").getAttribute("aria-label")) ?? ""), { timeoutMs: 15_000, label: "the staff open again" });

    // ---- a scroll is read with no typing, and takes its card with it ----
    await openTab(/Scrolls/);
    await eventually(() => card("Scroll: Magic Missile").count(), { label: "the scroll's card" });
    check((await card("Scroll: Magic Missile").innerText()).includes("Scroll, one use"), "it says it is one use");
    await playAtGoblin(table.study, "Scroll: Magic Missile");
    await eventually(async () => !(await rowNow(table.study, table.mage, "Spell Scroll (Magic Missile)")), { timeoutMs: 20_000, label: "the scroll used up" });
    await eventually(async () => (await card("Scroll: Magic Missile").count()) === 0, { timeoutMs: 20_000, label: "the scroll's card gone" });
    check(((await heroNow(table.study, table.mage)).spellcasting.slots["1"]?.used ?? 0) === 0, "no slot was spent");

    // ---- a fighter's table: a wand played with no spell list, a scroll they cannot read ----
    await t.open(`/campaigns/${table.id}`);
    await toTableTab();
    await openGroup("items");
    await openTab(/Scrolls/);
    await eventually(() => card("Scroll: Magic Missile").count(), { label: "the fighter's scroll card" });
    const label = (await card("Scroll: Magic Missile").getAttribute("aria-label")) ?? "";
    check(/unintelligible/.test(label), `it says why it cannot be read (${label})`);
    await inBothThemes("unreadable");
    await openTab(new RegExp(WAND));
    await eventually(() => card(MISSILE).count(), { label: "the fighter's wand card" });
    check((await card(MISSILE).innerText()).includes("Charges 5/7, costs 1"), "it counts its charges");
    await playAtGoblin(table.id, MISSILE);
    await eventually(async () => (await rowNow(table.id, table.hero, WAND)).charges === 4, { timeoutMs: 20_000, label: "one charge spent" });
    // Played, a card leaves its group shut, a moment after the answer: read the wand
    // inside it again once it has.
    await eventually(async () => (await back.count()) === 0, { timeoutMs: 15_000, label: "the group shut after the card" });
    await untilStill(page);
    await openGroup("items");
    await openTab(new RegExp(WAND));
    await eventually(async () => (await card(MISSILE).innerText()).includes("Charges 4/7"), { timeoutMs: 20_000, label: "the count on the card falling" });
    await eventually(async () => /action/i.test(((await card(MISSILE).getAttribute("aria-label")) ?? "").replace(/^[^,]*, Action/, "")), { timeoutMs: 15_000, label: "greyed for the action spent" });
    await inBothThemes("no-action");
  },
};

export default scenario;
