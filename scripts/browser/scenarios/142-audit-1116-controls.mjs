// The 2026-11-16 rules audit's new player and GM controls, where a person
// meets them, each on a host that offers it (src/lib/capabilities.ts):
//   the Hand's Wake card (shakeAwake), dealt only beside an ally Sleep or
//   Hypnotic Pattern holds, and never through the diagonal run of wall that
//   pinches the corner between two squares, where take_action refuses it;
//   the Hand Crossbow card's Ammunition pick (magicAmmo), offered while the
//   hero carries +1 bolts;
//   the opportunity attack card's "Strike and smite" (opportunitySmite), for
//   a paladin with a slot;
//   the GM console's Player attacks "Ammunition" (magicAmmo), Action's "Shake
//   a sleeper awake" (shakeAwake) and "Their familiar helps" (familiarHelp),
//   and Heal's "Their pet" (petHealing).
// Each is named for a screen reader, a finger's height on a phone, clean
// under axe, and shot in the night and the day themes. Answered as a host
// from before them (its features without these five), each is left out;
// that pass runs on the website only, since the app keeps its capabilities
// for 30 seconds.
// Nothing is played: the GM's teleports and the goblin's walks change the
// board, and every opportunity attack is let go. The seed's Lantern and Owl
// Tables, one of each per viewport.
import { request } from "playwright-core";
import { axeViolations, check, eventually, openPanelTab, untilStill, upTo } from "../lib.mjs";

// A Hand card pressed from the keyboard, as a player tabbing through the
// fan does: on a desktop the fanned cards overlap, and a pointer aimed at a
// card's middle lands on its neighbour.
async function press(t, locator) {
  await locator.focus();
  await t.page.keyboard.press("Enter");
}

const cardNames = (locator) => locator.evaluateAll((cards) => cards.map((card) => (card.getAttribute("aria-label") ?? "").split(",")[0].trim()));

// Every card dealt by name: the fan's, the ones inside its groups and the
// ones behind More (as 53-gear-cards reads them).
async function dealt(t) {
  const { page, root } = t;
  const names = await cardNames(page.locator(`${root}.hand-fan button.hand-card:not(.hand-group-card)`));
  const groups = await page.locator(`${root}button.hand-group-card`).evaluateAll((cards) => cards.map((card) => card.dataset.groupId));
  for (const id of groups) {
    await press(t, page.locator(`${root}button.hand-group-card[data-group-id="${id}"]`).first());
    const back = page.locator(`${root}.hand-back`).locator("visible=true");
    await eventually(() => back.count(), { label: `the ${id} group open` });
    names.push(...(await cardNames(page.locator(`${root}.hand-fan button.hand-card`))));
    await press(t, back.first());
    await eventually(async () => (await back.count()) === 0, { label: "the main hand again" });
  }
  const more = page.locator(`${root}button.hand-more`).locator("visible=true");
  if (await more.count()) {
    await t.tap(more.first());
    await eventually(() => page.locator("li.hand-more-row").locator("visible=true").count(), { label: "the cards behind More" });
    await untilStill(page);
    names.push(...(await page.locator("li.hand-more-row .font-display").evaluateAll((rows) => rows.map((row) => row.textContent?.trim() ?? ""))));
    await page.keyboard.press("Escape");
    await eventually(async () => (await page.locator("li.hand-more-row").locator("visible=true").count()) === 0, { label: "More closed" });
  }
  // A card pressed from the keyboard keeps the focus and shows its preview
  // over the fan: the walk ends with the focus let go.
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  return names;
}

// Picks the card of that name wherever it is dealt: the fan, a group, or
// the row behind More. The aim bar opens under it. Says the card's spoken
// name and its box as it sat in the fan (null behind More).
async function pickCard(t, name) {
  const { page, root } = t;
  const inFan = page.locator(`${root}.hand-fan button.hand-card[aria-label^="${name},"]`).locator("visible=true");
  if (!(await inFan.count())) {
    const more = page.locator(`${root}button.hand-more`).locator("visible=true");
    if (await more.count()) {
      await t.tap(more.first());
      const row = page.locator("li.hand-more-row button").filter({ hasText: name }).locator("visible=true");
      if (await upTo(() => row.count(), 3_000)) {
        await press(t, row.first());
        return null;
      }
      await page.keyboard.press("Escape");
    }
    for (const id of await page.locator(`${root}button.hand-group-card`).evaluateAll((cards) => cards.map((card) => card.dataset.groupId))) {
      await press(t, page.locator(`${root}button.hand-group-card[data-group-id="${id}"]`).first());
      if (await upTo(() => inFan.count(), 2_000)) break;
      await press(t, page.locator(`${root}.hand-back`).locator("visible=true").first());
    }
  }
  await eventually(() => inFan.count(), { label: `the ${name} card` });
  const card = inFan.first();
  const said = { label: (await card.getAttribute("aria-label")) ?? "", box: await card.boundingBox() };
  await press(t, card);
  return said;
}

// The flags these controls came with: a host without them is one from before.
const FLAGS = ["shakeAwake", "opportunitySmite", "magicAmmo", "petHealing", "familiarHelp"];

const scenario = {
  name: "audit-1116-controls",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport } = t;
    const { lantern, owl } = ids.audit1116[viewport];
    const phone = viewport === "phone";

    // The night theme, then the day, each under axe where `scope` is given,
    // each read by `also` where given, each shot; the page's own theme comes
    // back after.
    const bothThemes = async (name, scope, also) => {
      const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
      for (const [mode, label] of [["dark", "night"], ["light", "day"]]) {
        await page.evaluate((value) => (document.documentElement.dataset.theme = value), mode);
        await untilStill(page);
        if (scope) {
          const found = await axeViolations(page, scope);
          check(!found.length, `axe on ${name} by ${label}: ${found.map((entry) => `${entry.id}: ${entry.help} (${entry.nodes.join(", ")})`).join("; ").slice(0, 600)}`);
        }
        if (also) await also(label);
        await t.shot(`${name}-${label}`);
      }
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      await untilStill(page);
    };
    // A target a finger can reach on a phone (AGENTS.md: 40px, the kit's own).
    const fingerSized = async (locator, label) => {
      const box = await locator.boundingBox();
      if (phone) check((box?.height ?? 0) >= 39.5, `${label} is a target a finger can reach (${box?.height}px)`);
      check(box && box.x >= 0 && box.x + box.width <= (page.viewportSize()?.width ?? 0) + 0.5, `${label} sits inside the screen (${JSON.stringify(box)})`);
    };
    const noSideScroll = async (label) =>
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label} does not push the page sideways`);
    const openTable = async (id) => {
      await t.open(`/campaigns/${id}`);
      await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });
      // The fight's title card ("Battle") plays over the page as it loads.
      const titleCard = page.locator(".announce").locator("visible=true");
      await upTo(async () => (await titleCard.count()) > 0, 5_000);
      await eventually(async () => (await titleCard.count()) === 0, { timeoutMs: 30_000, label: "the fight's title card gone" });
    };
    const openHand = async () => {
      if (phone) {
        const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true });
        if (await tab.count()) await t.tap(tab);
      }
      await eventually(() => page.locator(`${root}.hand-fan button.hand-card[aria-label^="Longsword,"]`).count(), { timeoutMs: 30_000, label: "the Hand's Longsword card" });
      await untilStill(page);
    };

    // The table's GM is the player: the GM's calls go out as them.
    const gm = await request.newContext();
    let older = false;
    try {
      const signed = await gm.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player signed in (${signed.status()})`);
      const invoke = async (name, args) => {
        const sent = await gm.post(`${base}/api/campaigns/${lantern.id}/dm/invoke`, { data: { name, args } });
        const body = await sent.json().catch(() => ({}));
        check(sent.ok() && (body.ok ?? true) !== false, `the GM's ${name} went through (${sent.status()}: ${JSON.stringify(body).slice(0, 300)})`);
        return body.result ?? body;
      };
      const bring = (dx, dy) => invoke("move_token", { token: lantern.sleeper, x: lantern.cx + dx, y: lantern.cy + dy, teleport: true, cause: "hazard" });
      const walk = (dx) => invoke("move_token", { token: lantern.goblin, x: lantern.cx + dx, y: lantern.cy });
      const wakeDealt = async () => (await dealt(t)).includes("Wake");
      const ask = page.getByRole("group", { name: new RegExp(`^${lantern.goblinName} is moving out of your reach\\. Take your opportunity attack with your Longsword\\?`) }).locator("visible=true");
      const smiteLabel = "Strike and smite (1st-level slot)";
      const letItGo = async () => {
        const letGo = ask.getByRole("button", { name: "Let it go", exact: true });
        await letGo.focus();
        await page.keyboard.press("Enter");
        await eventually(async () => !(await ask.count()), { timeoutMs: 15_000, label: "the card gone once the lead lets it go" });
      };

      // ---- the Lantern Table: the Hand and the opportunity card ----
      await openTable(lantern.id);
      await openHand();
      // Bryn sleeps within 5 feet, behind the wall that pinches the corner.
      check(!(await wakeDealt()), `no Wake card for ${lantern.sleeperName} beyond the diagonal run of wall`);
      // The fan deals itself in again once its groups are closed.
      await untilStill(page);
      await t.shot("wake-walled-night");

      // Brought beside her, he can be shaken awake.
      await bring(0, -1);
      await eventually(() => wakeDealt(), { timeoutMs: 20_000, label: `the Wake card once ${lantern.sleeperName} lies beside her` });
      const wake = await pickCard(t, "Wake");
      if (wake) {
        check(/^Wake, /.test(wake.label), `the Wake card is named for a screen reader (${wake.label})`);
        if (phone) check((wake.box?.height ?? 0) >= 40, `the Wake card is a target a finger can reach (${wake.box?.height}px)`);
      }
      const aim = page.locator(`${root}.hand-aim`).locator("visible=true").first();
      await eventually(() => aim.count(), { label: "the Wake card's aim bar" });
      await eventually(async () => ((await aim.textContent()) ?? "").includes("Sleep or Hypnotic Pattern"), { label: "the aim bar says what Wake does" });
      // The sleeper is offered, and never the waker herself (take_action
      // refuses a shake of oneself).
      const sleeperChip = aim.getByRole("button", { name: new RegExp(`^${lantern.sleeperName}\\b`) });
      await eventually(() => sleeperChip.count(), { label: `${lantern.sleeperName}'s chip on the Wake card` });
      // The aim bar grows in; its chips are measured at their full size.
      await untilStill(page);
      await fingerSized(sleeperChip.first(), `${lantern.sleeperName}'s chip`);
      check(!(await aim.getByRole("button", { name: /\(you\)/ }).count()), "the Wake card offers the waker herself");
      await noSideScroll("the Wake card's aim bar");
      await bothThemes("wake-card", `${root}.hand-aim`);
      await page.keyboard.press("Escape");

      // Sent 15 feet off, he is out of a hand's reach.
      await bring(3, -3);
      await eventually(async () => !(await wakeDealt()), { timeoutMs: 20_000, label: `no Wake card once ${lantern.sleeperName} is 15 feet off` });

      // The crossbow fires ordinary bolts unless the shot names the +1 ones.
      await pickCard(t, "Hand Crossbow");
      const ammo = page.getByRole("radiogroup", { name: "Ammunition", exact: true }).locator("visible=true");
      await eventually(() => ammo.count(), { label: "the Hand Crossbow card's Ammunition pick" });
      await untilStill(page);
      const picks = ammo.getByRole("radio");
      const labels = await picks.evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ""));
      check(labels.length === 2 && /^Ordinary bolts$/i.test(labels[0]) && labels[1] === "+1 Crossbow Bolts (5)", `the pick offers ordinary bolts and the +1 ones (${labels.join(" | ")})`);
      check((await picks.first().getAttribute("aria-checked")) === "true", "ordinary bolts are picked to start");
      for (const pick of await picks.all()) await fingerSized(pick, `the ${await pick.textContent()} pick`);
      await noSideScroll("the Ammunition pick");
      // The picked bolts wear the row's travelling fill (src/lib/motion/
      // pill.ts) over their whole pill, by night and again by day: placed
      // again for the theme, it read the pill's eased background back from
      // the blank and lost its fill, and placed while the pill sprang in, it
      // fell short of its edges.
      const pillHolds = async (label) => {
        const got = await ammo.first().evaluate((group) => {
          const pill = group.querySelector(".motion-pill");
          const chosen = group.querySelector("[data-on]");
          if (!pill || !chosen || getComputedStyle(pill).opacity === "0") return null;
          const box = pill.getBoundingClientRect();
          return { fill: getComputedStyle(pill).backgroundColor, width: box.width, height: box.height, chosenWidth: chosen.offsetWidth, chosenHeight: chosen.offsetHeight };
        });
        if (!got) return;
        check(!/^(transparent|rgba\(0, 0, 0, 0\))$/.test(got.fill), `the picked bolts wear their fill by ${label} (${got.fill})`);
        check(Math.abs(got.width - got.chosenWidth) <= 1 && Math.abs(got.height - got.chosenHeight) <= 1, `the fill covers the picked bolts by ${label} (${JSON.stringify(got)})`);
      };
      await bothThemes("ammo-pick", `${root}.hand-aim`, pillHolds);
      await page.keyboard.press("Escape");

      // The goblin walks out of her reach: Strike, Strike and smite, Let it go.
      // The crossbow card pressed from the keyboard keeps the focus, and a
      // focused card shows its preview over the board: let it go first.
      await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
      check((await walk(-2)).parked === true, "the goblin's walk did not wait on the lead");
      await eventually(() => ask.count(), { timeoutMs: 30_000, label: "the card asking the lead about the goblin's walk" });
      await untilStill(page);
      const smite = ask.getByRole("button", { name: smiteLabel, exact: true });
      check(await smite.count(), `the paladin is offered ${smiteLabel}`);
      check(/spend a level 1 spell slot on Divine Smite/.test((await smite.getAttribute("title")) ?? ""), "the smite says the slot it spends");
      for (const name of ["Strike", smiteLabel, "Let it go"]) await fingerSized(ask.getByRole("button", { name, exact: true }), name);
      await noSideScroll("the opportunity card");
      if (phone) {
        // The harness's phone is 412px wide; a small phone is 375px.
        const size = page.viewportSize();
        await page.setViewportSize({ width: 375, height: size.height });
        await untilStill(page);
        await noSideScroll("the opportunity card at 375px");
        for (const name of ["Strike", smiteLabel, "Let it go"]) await fingerSized(ask.getByRole("button", { name, exact: true }), `${name} at 375px`);
        await page.setViewportSize(size);
        await untilStill(page);
      }
      await bothThemes("smite-card", `${root}.opportunity-ask`);
      await letItGo();

      // ---- the Owl Table: the GM console ----
      const formScope = `${root}[data-tour="dm-console-tabs"] + .motion-tab`;
      const field = (role, label) => page.getByRole(role, { name: label, exact: true }).locator("visible=true");
      const openForm = async (tab, plate, anchor) => {
        await openPanelTab(t, "dm");
        const tabButton = page.locator(`${root}[data-tour="dm-console-tabs"] button`).filter({ hasText: new RegExp(`^${tab}$`, "i") }).locator("visible=true").first();
        await eventually(() => tabButton.count(), { timeoutMs: 30_000, label: `the console's ${tab} tab` });
        await t.tap(tabButton);
        const plateButton = page.getByRole("button", { name: plate }).locator("visible=true").first();
        await eventually(() => plateButton.count(), { label: `the console's ${plate}` });
        await t.tap(plateButton);
        await untilStill(page);
        await eventually(() => field(anchor.role, anchor.label).count(), { label: `${plate}'s ${anchor.label}` });
      };
      const emptyText = async (label) => {
        const box = field("textbox", label);
        await eventually(() => box.count(), { label: `${label}, labelled` });
        check((await box.first().inputValue()) === "", `${label} starts empty`);
        await fingerSized(box.first(), label);
        await box.first().evaluate((node) => node.scrollIntoView({ block: "center" }));
        return box.first();
      };
      const PLAYER_ATTACKS = /^Player attacks\b/;
      const ACTION = /^Action\b(?! Surge)/;
      const HEAL = /^Heal\b/;
      const WAKE_OPTION = "Shake a sleeper awake (Sleep, Hypnotic Pattern)";

      await openTable(owl.id);
      await openForm("combat", PLAYER_ATTACKS, { role: "button", label: "Attacker" });
      await emptyText("Ammunition");
      await bothThemes("console-ammo", formScope);

      await openForm("combat", ACTION, { role: "button", label: "Character" });
      await t.tap(field("button", "Action").first());
      const menu = page.getByRole("menu").locator("visible=true").last();
      await eventually(() => menu.count(), { label: "the Action choices" });
      const wakeOption = menu.getByRole("menuitemradio", { name: WAKE_OPTION, exact: true });
      await eventually(() => wakeOption.count(), { label: `${WAKE_OPTION} among the actions` });
      await wakeOption.first().scrollIntoViewIfNeeded();
      await fingerSized(wakeOption.first(), WAKE_OPTION);
      await bothThemes("console-wake-option", null);
      await t.tap(wakeOption.first());
      await eventually(async () => ((await field("button", "Action").first().textContent()) ?? "").includes(WAKE_OPTION), { label: `Action reads ${WAKE_OPTION}` });
      await emptyText("Their familiar helps");
      await bothThemes("console-familiar-help", formScope);

      await openForm("party", HEAL, { role: "button", label: "Character" });
      await emptyText("Their pet");
      await bothThemes("console-pet-heal", formScope);

      if (t.app) return;

      // ---- a host from before these controls ----
      older = true;
      await page.route("**/api/capabilities**", async (route) => {
        const response = await route.fetch();
        const json = await response.json().catch(() => ({}));
        for (const flag of FLAGS) delete json.features?.[flag];
        await route.fulfill({ response, json });
      });
      await openTable(owl.id);
      await openForm("combat", PLAYER_ATTACKS, { role: "button", label: "Attacker" });
      check(!(await field("textbox", "Ammunition").count()), "an older host's Player attacks asks Ammunition");
      await openForm("combat", ACTION, { role: "button", label: "Character" });
      check(!(await field("textbox", "Their familiar helps").count()), "an older host's Action asks Their familiar helps");
      await t.tap(field("button", "Action").first());
      const olderMenu = page.getByRole("menu").locator("visible=true").last();
      await eventually(() => olderMenu.getByRole("menuitemradio", { name: "Dodge", exact: true }).count(), { label: "the older host's Action choices" });
      check(!(await olderMenu.getByRole("menuitemradio", { name: WAKE_OPTION, exact: true }).count()), `an older host is offered ${WAKE_OPTION}`);
      await page.keyboard.press("Escape");
      await openForm("party", HEAL, { role: "button", label: "Character" });
      check(!(await field("textbox", "Their pet").count()), "an older host's Heal asks Their pet");

      await openTable(lantern.id);
      await openHand();
      await bring(0, -1);
      await page.waitForTimeout(1_500);
      check(!(await wakeDealt()), "an older host is dealt Wake");
      // The page was opened again behind the older host's capabilities, which
      // land after the first deal: a press made before they settle can be
      // taken by the deal they redraw. Press again while no aim bar shows, and
      // say what the Hand shows if it never does.
      const olderAim = page.locator(`${root}.hand-aim`).locator("visible=true");
      await untilStill(page);
      await pickCard(t, "Hand Crossbow");
      for (let tries = 0; tries < 2 && !(await upTo(() => olderAim.count(), 5_000)); tries += 1) {
        await page.keyboard.press("Escape");
        await untilStill(page);
        await pickCard(t, "Hand Crossbow");
      }
      const shown = async () => ((await page.locator(`${root}.hand-read-panel, ${root}.hand-read-seat`).locator("visible=true").allTextContents()).join(" ") || "no read panel").slice(0, 300);
      if (!(await upTo(() => olderAim.count(), 15_000))) check(false, `the Hand Crossbow card's aim bar on an older host (the Hand shows: ${await shown()})`);
      check(!(await page.getByRole("radiogroup", { name: "Ammunition", exact: true }).count()), "an older host's Hand Crossbow card offers magic ammunition");
      await page.keyboard.press("Escape");
      await walk(-1);
      check((await walk(-2)).parked === true, "the goblin's second walk did not wait on the lead");
      await eventually(() => ask.count(), { timeoutMs: 30_000, label: "the card asking again on an older host" });
      check(await ask.getByRole("button", { name: "Strike", exact: true }).count(), "an older host still offers Strike");
      check(!(await ask.getByRole("button", { name: smiteLabel, exact: true }).count()), `an older host is offered ${smiteLabel}`);
      await letItGo();
    } finally {
      if (older) await page.unroute("**/api/capabilities**").catch(() => {});
      await gm.dispose();
    }
  },
};

export default scenario;
