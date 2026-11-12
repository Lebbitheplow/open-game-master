// A Ring of Spell Storing in the Hand (src/lib/battlemap/hand-ring.ts). Each spell
// the ring holds is a card a fighter with no spell list can play without typing:
// it names the spell and its level, greys with the engine's reason, goes once the
// spell has left the ring, and a reaction spell waits for its trigger and comes up
// when the attack lands. The rules behind it are scripts/test-hand-ring.mjs; this
// is what only a page can see: the cards on a real table, read by axe in the day and
// night themes, at phone width, and the card gone from the Hand as the spell goes.
// A fighter's cards fold under Items; at a wizard's table the same card is under
// Spells and under Items. The lead runs these tables and plays at them, so a card
// resolves as it is played.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const RING = "Ring of Spell Storing";

const scenario = {
  name: "ring-cards",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, api, base, ids, viewport } = t;
    const table = ids.ringTables[viewport];
    const campaign = `${base}/api/campaigns/${table.id}`;
    const hand = `${root}[aria-label="Your hand"]`;
    const heroNow = async () => ((await (await api.get(campaign)).json()).sheets ?? []).find((sheet) => sheet.id === table.hero);
    const ringNow = async () => (await heroNow()).equipment.find((item) => item.name === RING);
    const spellsNow = async () => (await ringNow()).storedSpells?.map((entry) => entry.spell) ?? [];
    const card = (spell) => page.locator(`${root}button.hand-card[aria-label^="Ring: ${spell},"]`).locator("visible=true").first();
    const labelOf = async (spell) => (await card(spell).getAttribute("aria-label")) ?? "";
    const groupCard = (key) => page.locator(`${root}button.hand-group-card[data-group-id="group:${key}"]`).locator("visible=true").first();
    const back = page.locator(`${root}.hand-back`).locator("visible=true");
    const openGroup = async (key) => {
      await eventually(() => groupCard(key).count(), { timeoutMs: 30_000, label: `the ${key} group` });
      await t.tap(groupCard(key));
      await eventually(() => back.count(), { label: `the ${key} group open` });
    };
    const closeGroup = async () => {
      await t.tap(back.first());
      await eventually(async () => (await back.count()) === 0, { label: "the main hand again" });
    };
    const toTableTab = async () => {
      // The fight's opening banner fills the screen for its first moments.
      await page.waitForTimeout(3_000);
      if (viewport !== "phone") return;
      // The phone's Table tab holds the Hand.
      const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true });
      if (await tab.count()) await t.tap(tab);
    };
    // A card that cannot be played gives its seat in the fan to one that can, so a
    // grey one is read where it went: the row behind More, which says why as well.
    const greyRow = (spell) => page.locator("li.hand-more-row").filter({ hasText: `Ring: ${spell}` }).locator("visible=true").first();
    const whyGrey = async (spell) => {
      if (await card(spell).count()) return labelOf(spell);
      // Played, a card leaves its group shut: the spell is read inside it again.
      if (!(await back.count()) && (await groupCard("items").count())) {
        await openGroup("items");
        await eventually(() => card(spell).count(), { label: `${spell}'s card under Items` });
        const label = await labelOf(spell);
        await closeGroup();
        return label;
      }
      const more = page.locator(`${root}button.hand-more`).locator("visible=true").first();
      await eventually(() => more.count(), { label: `the way to ${spell}'s card behind More` });
      await t.tap(more);
      await eventually(() => greyRow(spell).count(), { label: `${spell}'s row behind More` });
      const words = await greyRow(spell).innerText();
      await page.keyboard.press("Escape");
      await eventually(async () => (await greyRow(spell).count()) === 0, { label: "the More sheet closing" });
      return words;
    };
    const invoke = async (name, args) => {
      const response = await api.post(`${campaign}/dm/invoke`, { data: { name, args } });
      const body = await response.json().catch(() => ({}));
      check(response.ok() && body.ok !== false, `${name} ran (${response.status()}): ${JSON.stringify(body).slice(0, 240)}`);
      return body;
    };
    const patchRing = async (change, reason) => {
      const { equipment } = await heroNow();
      const patched = await api.patch(`${campaign}/sheets/${table.hero}`, {
        data: { equipment: equipment.map((item) => (item.name === RING ? { ...item, ...change } : item)), reason },
      });
      check(patched.ok(), `${reason} (${patched.status()})`);
    };
    // A thrown die lies over the page until it clears, and hides what a shot is of.
    const diceClear = () =>
      eventually(
        async () => {
          const overlay = page.locator(`${root}#dice-overlay`);
          return (await overlay.count()) === 0 || (await overlay.getAttribute("data-dice")) === "idle";
        },
        { timeoutMs: 30_000, label: "the dice clearing" },
      );
    const inBothThemes = async (shot, selector = hand) => {
      await diceClear();
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

    // ---- a wizard's table: the one card under both Spells and Items ----
    await t.open(`/campaigns/${table.study}`);
    await toTableTab();
    for (const key of ["spells", "items"]) {
      await openGroup(key);
      // Spells opens by level, and Knock is a level 2 spell.
      if (key === "spells") await t.tap(page.locator(`${root}[aria-label="Your hand"]`).getByRole("tab", { name: /Level 2/ }).first());
      await eventually(() => card("Knock").count(), { label: `the ring's Knock card under ${key}` });
      check((await card("Knock").innerText()).includes("Level 2"), `it names its level under ${key}`);
      await inBothThemes(`under-${key}`);
      await closeGroup();
    }
    check((await page.locator(`${root}.hand-fan button.hand-card:not(.hand-group-card)[aria-label^="Ring: "]`).count()) === 0, "and not loose in the fan as well");

    // ---- a fighter's table: under Items ----
    await t.open(`/campaigns/${table.id}`);
    await toTableTab();
    await openGroup("items");
    await eventually(() => card("Knock").count(), { timeoutMs: 30_000, label: "the ring's Knock card" });

    // ---- a card for each spell, naming it and its level ----
    for (const [spell, level] of [["Knock", 2], ["Hold Person", 2], ["Shield", 1]]) {
      await eventually(() => card(spell).count(), { label: `the ring's ${spell} card` });
      const words = await card(spell).innerText();
      check(words.includes(spell) && words.includes(`Level ${level}`), `${spell}'s card names it and its level (${words})`);
    }
    check(!(await labelOf("Knock")).includes("."), `Knock can be played (${await labelOf("Knock")})`);
    const shieldWords = await whyGrey("Shield");
    check(/cast as a reaction: its card comes up when an attack hits you/.test(shieldWords), `Shield waits for its trigger (${shieldWords})`);
    const box = await card("Knock").boundingBox();
    check((box?.height ?? 0) >= 40, `a card a finger can press (${box?.height}px)`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the hand does not push the page sideways");
    await card("Knock").scrollIntoViewIfNeeded();
    await inBothThemes("cards");

    // ---- greyed with the reason ----
    await patchRing({ attuned: false }, "The ring comes loose");
    await eventually(async () => /works only for someone attuned/.test(await whyGrey("Knock")), { timeoutMs: 15_000, label: "Knock greyed for no attunement" });
    await inBothThemes("not-attuned");
    await patchRing({ attuned: true }, "The ring is theirs again");
    await eventually(async () => (await card("Knock").count()) > 0 && !(await labelOf("Knock")).includes("."), { timeoutMs: 15_000, label: "Knock open again" });

    // ---- played without typing ----
    // From the keyboard, which a fan's overlapping cards cannot get in the way of.
    await card("Hold Person").focus();
    await page.keyboard.press("Enter");
    const aimBar = page.locator(`${root}.hand-aim`).locator("visible=true").first();
    await eventually(() => aimBar.count(), { label: "the aim bar" });
    await t.tap(aimBar.getByRole("group", { name: "Targets" }).getByRole("button", { name: /Goblin/ }).first());
    const commit = aimBar.getByRole("button", { name: "Ring: Hold Person", exact: true }).first();
    await eventually(() => commit.isEnabled(), { label: "the aim bar's button" });
    const said = await page.evaluate(() => document.body.textContent ?? "");
    check(said.includes(`I cast Hold Person from my ${RING} at Goblin`), "the sentence says it comes out of the ring");
    await inBothThemes("aimed", `${root}.hand-aim`);
    const played = page.waitForResponse((response) => response.url().endsWith(`/api/campaigns/${table.id}/actions`) && response.request().method() === "POST", { timeout: 30_000 });
    played.catch(() => {});
    await t.tap(commit);
    const answer = await played;
    check(answer.ok(), `the card was taken (${answer.status()}): ${(await answer.text()).slice(0, 240)}`);
    await eventually(async () => !(await spellsNow()).includes("Hold Person"), { timeoutMs: 20_000, label: "Hold Person out of the ring" });
    await eventually(async () => (await card("Hold Person").count()) === 0, { timeoutMs: 20_000, label: "Hold Person's card gone" });
    check((await spellsNow()).join() === "Knock,Shield", `the others stay (${await spellsNow()})`);

    // ---- no action left ----
    await eventually(async () => /action/i.test((await whyGrey("Knock")).replace(/^Ring: Knock, Action/, "")), { timeoutMs: 15_000, label: "Knock greyed for the action spent" });
    await t.shot("no-action");

    // ---- a reaction spell comes up when the attack lands ----
    await invoke("end_turn", { characterId: table.hero });
    // A goblin Hold Person did not take, and that has not swung this round: a
    // held one swings at nobody, and one that swung has spent its action.
    const swung = new Set();
    const freeGoblin = async () =>
      ((await (await api.get(campaign)).json()).encounter?.enemies ?? []).find(
        (enemy) => enemy.status !== "dead" && !(enemy.conditions ?? []).includes("paralyzed") && !swung.has(enemy.id),
      )?.id;
    check(await freeGoblin(), "a goblin is free to swing");
    const chip = page.locator(`${root}[role="group"][aria-label="Reactions"] button`).filter({ hasText: "Ring: Shield" }).locator("visible=true").first();
    // AC 1 hits on all but a natural 1. A goblin that rolls the 1 has spent its
    // action for the round, and asked again it refuses, so the swing that
    // follows is a fresh goblin's (CI, ring-cards-phone: the one free goblin
    // fumbled and every retry was refused until the 30 seconds ran out).
    const { ac: acBefore } = await heroNow();
    const lowered = await api.patch(`${campaign}/sheets/${table.hero}`, { data: { ac: 1, acOverride: true, reason: "Caught flat-footed" } });
    check(lowered.ok(), `AC lowered (${lowered.status()}) from ${acBefore}`);
    await eventually(
      async () => {
        if (await chip.count()) return true;
        let goblin = await freeGoblin();
        if (!goblin) {
          await invoke("add_enemies", { enemies: [{ monster: "goblin", count: 1 }] });
          goblin = await freeGoblin();
        }
        if (!goblin) return false;
        swung.add(goblin);
        await invoke("enemy_attack", { enemyId: goblin, targetCharacterId: table.hero });
        return (await chip.count()) > 0;
      },
      { timeoutMs: 30_000, every: 2_000, label: "the ring's Shield offered by the hit" },
    );
    await inBothThemes("reaction", `${root}[role="group"][aria-label="Reactions"]`);
    await t.tap(chip);
    const send = page.locator(`${root}.hand-aim`).getByRole("button", { name: "Ring: Shield", exact: true }).locator("visible=true").first();
    await eventually(() => send.isEnabled(), { label: "Shield's button" });
    const cast = page.waitForResponse((response) => response.url().endsWith(`/api/campaigns/${table.id}/actions`) && response.request().method() === "POST", { timeout: 30_000 });
    cast.catch(() => {});
    await t.tap(send);
    const answered = await cast;
    check(answered.ok(), `Shield was taken (${answered.status()}): ${(await answered.text()).slice(0, 240)}`);
    await eventually(async () => !(await spellsNow()).includes("Shield"), { timeoutMs: 20_000, label: "Shield out of the ring" });
    check((await heroNow()).conditions.includes("shielded"), "the fighter is shielded");
    await diceClear();
    await untilStill(page);
    await t.shot("reaction-cast");
  },
};

export default scenario;
