// Issue 685, round 2: every control the second round added, seen running on
// a desktop and a phone, in the night theme and the day one, each part of
// the screen through axe (the seed's bench2 tables, one per moment):
// 1. "Speaking as" in Do: the lead's Ada on her turn, a goblin's hit open
//    on Bram; Bram is picked and the words go out as his reaction;
// 2. two open hits on each of two heroes: Shield once over Ada's two (it
//    covers every hit after the one it answers), an Uncanny Dodge per hit on
//    Bram, each under its own hit's words; Shield played on the first;
// 3. the reaction card of a companion the lead commands;
// 4. Conjure Animals' creature and number on the Hand's card, and the
//    sheet's summoning: Find Familiar's creature and kind, cast as a ritual,
//    and Animate Dead's form per target;
// 5. the GM console: Cast a buff's Kind and Each target's form, Summon a
//    pet's Creature and "Not in the list";
// 6. the monsters' Hand at a table the lead runs: a gynosphinx's legendary
//    cards at the end of Kara's turn (cost and what is left), the aim bar's
//    square and spell pickers, a Teleport played, the lair's card at 20;
// 7. a dominated hero's Hand in the GM seat on his turn, aimed at the party,
//    ended with End turn;
// 8. a steered table, where the GM seat has the console and no monsters'
//    Hand;
// 9. the event log's row for a turn that changed the fight, its revert with
//    the dialog's words, and the board as it was;
// 10. the Test fight sheet's refusal where only administrators start tables.
import http from "node:http";
import { request } from "playwright-core";
import { axeViolations, check, enterApp, eventually, freePort, hydrated, newContext, openPanelTab, settle, signIn, untilStill, seeAllTours } from "../lib.mjs";

// A stand-in narrator for the steered table, as in fight-bench.
function narrator(port) {
  const state = { asked: 0 };
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (!req.url?.endsWith("/chat/completions")) {
        res.writeHead(404).end();
        return;
      }
      state.asked += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: "The goblin snarls and circles." }, finish_reason: "stop" }] }));
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ state, close: () => server.close() })));
}

export default {
  name: "fight-bench-2",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, api, root, ids } = t;
    const phone = t.viewport === "phone";
    const bench = ids.bench2[t.viewport];
    // Faults that do not stop the walk are gathered and reported together.
    const faults = [];
    const log = (line) => console.log(`[fight-bench-2 ${t.viewport}${t.app ? " app" : ""}] ${line}`);
    // Said as found too, so a later stop still shows them.
    const soft = (condition, message) => {
      if (condition) return;
      faults.push(message);
      log(`fault: ${message}`);
    };
    const visible = (selector) => page.locator(`${root}${selector}`).locator("visible=true").first();
    const menuItem = (name) => page.getByRole("menuitemradio", { name }).locator("visible=true").first();
    // axe takes a selector: a part found by its words is marked for it.
    let marks = 0;
    const markFor = async (locator) => {
      marks += 1;
      await locator.evaluate((node, mark) => node.setAttribute("data-bench", mark), String(marks));
      return `[data-bench="${marks}"]`;
    };
    // A travelling pill (src/lib/motion/pill.ts) wears a copy of its chosen
    // button's fill: after a theme switch it must wear the new theme's.
    const stalePills = (on) =>
      on.evaluate(() =>
        [...document.querySelectorAll("[data-pill-ready]")].flatMap((group) => {
          const pill = group.querySelector(":scope > .motion-pill");
          const chosen = group.querySelector('[data-on], [role="tab"][aria-selected="true"]');
          if (!pill || !chosen || chosen.offsetParent === null) return [];
          group.removeAttribute("data-pill-ready");
          const look = getComputedStyle(chosen).backgroundImage;
          group.setAttribute("data-pill-ready", "");
          return look === pill.style.backgroundImage ? [] : [`${chosen.textContent?.trim().slice(0, 24)}: ${pill.style.backgroundImage.slice(0, 60)} for ${look.slice(0, 60)}`];
        }),
      );
    async function themes(step, scope, on = page) {
      const selector = !scope || typeof scope === "string" ? scope : await markFor(scope);
      const shoot = (name) => (on === page ? t.shot(name) : on.screenshot({ path: t.shotPath(name) }).catch(() => {}));
      // A table opened mid-fight greets with its battle title first.
      await eventually(async () => !(await on.getByText(/roll initiative/i).locator("visible=true").count()), { timeoutMs: 15_000, label: "the battle title gone" }).catch(() => undefined);
      await untilStill(on).catch(() => undefined);
      if (selector) {
        const night = await axeViolations(on, selector);
        soft(night.length === 0, `${step} fails axe at night: ${JSON.stringify(night).slice(0, 500)}`);
      }
      await shoot(`${step}-night`);
      const theme = await on.evaluate(() => document.documentElement.dataset.theme ?? "");
      await on.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(on).catch(() => undefined);
      const stale = await stalePills(on);
      soft(!stale.length, `${step}: a chosen pill keeps the night's fill in the day theme (${stale.join(" | ")})`);
      if (selector) {
        const day = await axeViolations(on, selector);
        soft(day.length === 0, `${step} fails axe in the day theme: ${JSON.stringify(day).slice(0, 500)}`);
      }
      await shoot(`${step}-day`);
      await on.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
      await untilStill(on).catch(() => undefined);
    }
    const fingerSized = async (locator, what) => {
      if (!phone) return;
      // Measured at rest: a pill pops in, and a press scales it down a beat.
      await untilStill(page).catch(() => undefined);
      const box = await locator.boundingBox();
      soft(box && Math.round(box.height) >= 40, `${what} is at least 40px tall on a phone (${box?.height})`);
    };
    // On a phone the Hand, the monsters' Hand and the message box are the
    // Table view's; the table may turn to the board once it loads.
    const tableTab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true }).locator("visible=true").first();
    const onTable = (ready, label) =>
      eventually(
        async () => {
          if (await ready.isVisible().catch(() => false)) return true;
          if (phone && (await tableTab.count())) await t.tap(tableTab).catch(() => undefined);
          return false;
        },
        { timeoutMs: 60_000, every: 1_000, label },
      );
    const posted = (campaignId, tail) => {
      const waiting = page.waitForResponse((response) => response.url().endsWith(`/api/campaigns/${campaignId}/${tail}`) && response.request().method() === "POST", { timeout: 30_000 });
      waiting.catch(() => {});
      return waiting;
    };
    const snapshot = async (campaignId) => (await api.get(`${base}/api/campaigns/${campaignId}`)).json();
    const invoke = async (campaignId, name, args) => {
      const response = await api.post(`${base}/api/campaigns/${campaignId}/dm/invoke`, { data: { name, args } });
      check(response.ok(), `${name} answered ${response.status()}: ${(await response.text()).slice(0, 200)}`);
      return response.json();
    };
    // Names a box cuts short: each visible text that is exactly one of
    // `names`, measured against the nearest box that clips it.
    const clippedNames = (names) =>
      page.evaluate((list) => {
        const out = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent?.trim() ?? "";
          const parent = node.parentElement;
          if (!list.includes(text) || !parent || parent.offsetParent === null) continue;
          let box = parent;
          while (box && getComputedStyle(box).overflowX === "visible") box = box.parentElement;
          if (!box || box === document.body || box === document.documentElement) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const shown = range.getBoundingClientRect();
          const room = box.getBoundingClientRect();
          if (shown.width && shown.bottom > room.top && shown.top < room.bottom && shown.right > room.right + 1) {
            out.push(`${text} shows ${Math.max(0, Math.round(room.right - shown.left))} of ${Math.round(shown.width)}px`);
          }
        }
        return out;
      }, names);
    // The order's four buttons on a row share one line, in the night theme
    // and the day one: a row whose buttons split, one left on the name's
    // line, is named.
    const orderSplit = async () => {
      const found = [];
      const before = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
      for (const theme of ["dark", "light"]) {
        await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
        await untilStill(page).catch(() => undefined);
        found.push(
          ...(await page.evaluate(() =>
            [...document.querySelectorAll('button[aria-label$=" up the order"]')].flatMap((up) => {
              if (up.offsetParent === null) return [];
              const name = up.getAttribute("aria-label").replace(/^Move /, "").replace(/ up the order$/, "");
              const tops = [`Move ${name} up the order`, `Move ${name} down the order`, `Delay ${name} to the bottom of the round`, `Take ${name} out of the order`]
                .map((label) => [...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === label && button.offsetParent !== null))
                .map((button) => (button ? Math.round(button.getBoundingClientRect().top) : null));
              return tops.some((top) => top === null) || Math.max(...tops) - Math.min(...tops) > 1 ? [`${name}: ${tops.join("/")}`] : [];
            }),
          )).map((line) => `${theme}: ${line}`),
        );
      }
      await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), before);
      return found;
    };
    // A card in a fan lies partly under its neighbours: it is pressed where
    // it shows, as a person presses it.
    const tapCard = async (locator) => {
      await locator.scrollIntoViewIfNeeded();
      const at = await locator.evaluate((card) => {
        const box = card.getBoundingClientRect();
        for (const fy of [0.35, 0.55, 0.2, 0.75]) {
          for (const fx of [0.5, 0.3, 0.7, 0.15, 0.85]) {
            const [x, y] = [box.left + box.width * fx, box.top + box.height * fy];
            const top = document.elementFromPoint(x, y);
            if (top && card.contains(top)) return { x, y };
          }
        }
        return null;
      });
      check(at, "the card shows somewhere to press");
      if (t.touch && t.app) await page.touchscreen.tap(at.x, at.y);
      else await page.mouse.click(at.x, at.y);
    };
    // The aim bar's send: the last button in the row that holds Back.
    const aimSend = (scope) => scope.locator("div", { has: page.getByRole("button", { name: "Back", exact: true }) }).last().getByRole("button").last();

    const port = await freePort();
    const model = await narrator(port);
    const playerApi = await request.newContext();
    let switchBefore = null;
    let other = null;
    try {
      // ---- 1. Speaking as: Bram's reaction typed on Ada's turn ----
      const { react } = bench;
      await t.open(`/campaigns/${react.id}`);
      const composer = visible(".session-compose-entry");
      await onTable(composer, "the message box");
      const doMode = composer.locator('button[data-mode="do"]');
      if ((await doMode.getAttribute("data-on")) === null) await t.tap(doMode);
      const speaking = composer.getByRole("button", { name: "Speaking as" });
      await eventually(() => speaking.isVisible(), { timeoutMs: 30_000, label: "Speaking as in Do" });
      check(/Ada Quill, their turn/.test(await speaking.innerText()), `the box speaks for Ada on her turn (${await speaking.innerText()})`);
      await fingerSized(speaking, "Speaking as");
      await themes("s1-speaking-as", composer);
      await t.tap(speaking);
      await eventually(() => menuItem(/Bram Tallow, a reaction/).isVisible(), { label: "Bram among those who may react" });
      const offered = await page.getByRole("menuitemradio").locator("visible=true").allInnerTexts();
      check(offered.some((text) => /Pip Quickfoot, a reaction/.test(text)), `the companion the lead commands is offered (${offered.join(" | ")})`);
      check(!offered.some((text) => /Ada Quill, a reaction/.test(text)), "Ada, whom nothing hit, is not offered a reaction");
      for (const row of await page.getByRole("menuitemradio").locator("visible=true").all()) await fingerSized(row, "a Speaking as row");
      await themes("s1-speaking-as-menu");
      await t.tap(menuItem(/Bram Tallow, a reaction/));
      await eventually(async () => /Bram Tallow, a reaction/.test(await speaking.innerText()), { label: "Bram picked" });
      const words = "Bram twists aside as the blade comes down.";
      await composer.locator('[data-tour="composer-input"] textarea').fill(words);
      await themes("s1-speaking-as-bram", composer);
      const typed = posted(react.id, "actions");
      await t.tap(composer.getByRole("button", { name: "Send" }));
      const typedAnswer = await typed;
      const typedBody = JSON.parse(typedAnswer.request().postData() ?? "{}");
      check(typedAnswer.ok(), `the typed reaction answered ${typedAnswer.status()}: ${(await typedAnswer.text()).slice(0, 200)}`);
      check(typedBody.characterId === react.bram.id && typedBody.reaction === true, `the words go out as Bram's reaction (${JSON.stringify(typedBody)})`);
      await eventually(
        async () => ((await (await api.get(`${base}/api/campaigns/${react.id}/messages?limit=40`)).json()).messages ?? []).some((message) => message.content === words && message.characterId === react.bram.id),
        { timeoutMs: 20_000, label: "the line in the chronicle as Bram's" },
      );
      // The box goes back to the turn, and Bram's reaction waits on the GM:
      // he is not offered again, nor is his card; Pip's still is.
      await eventually(async () => /Ada Quill, their turn/.test(await speaking.innerText()), { label: "the box back on Ada's turn" });
      await t.tap(speaking);
      await eventually(() => menuItem(/Pip Quickfoot, a reaction/).isVisible(), { label: "Pip still offered" });
      check(!(await menuItem(/Bram Tallow, a reaction/).count()), "Bram, whose reaction waits on the GM, is not offered again");
      await page.keyboard.press("Escape");
      const bramChip = visible('section[aria-label="Your hand"]').locator('[role="group"][aria-label="Reactions"]').filter({ hasText: react.bram.name }).getByRole("button", { name: /^Uncanny Dodge/ }).first();
      await eventually(async () => (await bramChip.getAttribute("aria-disabled")) === "true", { label: "Bram's Uncanny Dodge held while his words wait" });
      await t.shot("s1-sent");

      // ---- 3. A companion's reaction card, for the lead who commands it ----
      const hand = visible('section[aria-label="Your hand"]');
      await onTable(hand, "the lead's Hand");
      const pipStrip = hand.locator('[role="group"][aria-label="Reactions"]').filter({ hasText: react.pip.name }).first();
      await eventually(() => pipStrip.isVisible(), { timeoutMs: 20_000, label: "Pip's reaction strip" });
      const pipDodge = pipStrip.getByRole("button", { name: /^Uncanny Dodge/ }).first();
      await fingerSized(pipDodge, "Pip's Uncanny Dodge chip");
      await pipStrip.scrollIntoViewIfNeeded();
      await themes("s3-companion-reaction", hand);
      await t.tap(pipDodge);
      const pipSend = aimSend(hand);
      await eventually(async () => /uncanny dodge/i.test(await pipSend.innerText()), { label: "the aim bar for Pip's Uncanny Dodge" });
      const pipPlayed = posted(react.id, "actions");
      await t.tap(pipSend);
      const pipAnswer = await pipPlayed;
      const pipBody = JSON.parse(pipAnswer.request().postData() ?? "{}");
      check(pipAnswer.ok(), `Pip's reaction answered ${pipAnswer.status()}: ${(await pipAnswer.text()).slice(0, 200)}`);
      check(pipBody.characterId === react.pip.id && pipBody.intent?.card === "reaction", `the card is played as Pip's (${JSON.stringify(pipBody).slice(0, 300)})`);
      await eventually(async () => (await pipDodge.getAttribute("aria-disabled")) === "true" || !(await pipDodge.isVisible().catch(() => false)), { label: "Pip's chip held once its card is sent" });
      await untilStill(page).catch(() => undefined);
      await t.shot("s3-played");

      // ---- 2. Two open hits on each hero; Shield on the first ----
      const { hits } = bench;
      const hitsBefore = ((await snapshot(hits.id)).encounter?.lastHits ?? []).filter((hit) => hit.characterId === hits.ada.id);
      check(hitsBefore.length === 2, `two hits open on Ada (${JSON.stringify(hitsBefore).slice(0, 300)})`);
      await t.open(`/campaigns/${hits.id}`);
      await onTable(hand, "the Hand at the two-hits table");
      const strips = hand.locator('[role="group"][aria-label="Reactions"]');
      await eventually(async () => (await strips.count()) >= 2, { timeoutMs: 20_000, label: "the reaction strips" });
      const stripWords = await strips.allInnerTexts();
      log(`strips: ${stripWords.map((text) => text.replace(/\s+/g, " ")).join(" || ")}`);
      const adaStrip = strips.filter({ hasText: /hit you/ }).first();
      check(/then Goblin \d's Scimitar/.test(await adaStrip.innerText()), `Ada's Shield names both hits it covers (${await adaStrip.innerText()})`);
      const bramDodges = hand.locator('[role="group"][aria-label="Reactions"]').filter({ hasText: hits.bram.name }).getByRole("button", { name: /^Uncanny Dodge/ });
      check((await bramDodges.count()) === 2, `a card per hit on Bram (${await bramDodges.count()})`);
      const bramStrips = strips.filter({ hasText: /hit Bram Tallow/ });
      const bramWords = new Set((await bramStrips.allInnerTexts()).map((text) => text.replace(/\s+/g, " ")));
      soft(bramWords.size === 2, `each Uncanny Dodge sits under its own hit's words (${[...bramWords].join(" || ")})`);
      for (const chip of await bramDodges.all()) await fingerSized(chip, "an Uncanny Dodge chip");
      await adaStrip.scrollIntoViewIfNeeded();
      await themes("s2-hits", hand);
      await t.tap(adaStrip.getByRole("button", { name: /^Shield/ }).first());
      const shieldSend = aimSend(hand);
      await eventually(async () => /shield/i.test(await shieldSend.innerText()), { label: "the aim bar for Shield" });
      const shielded = posted(hits.id, "actions");
      await t.tap(shieldSend);
      const shieldAnswer = await shielded;
      const shieldBody = JSON.parse(shieldAnswer.request().postData() ?? "{}");
      check(shieldAnswer.ok(), `Shield answered ${shieldAnswer.status()}: ${(await shieldAnswer.text()).slice(0, 200)}`);
      check(shieldBody.intent?.hit === hitsBefore[0].id, `Shield answers the first hit (${shieldBody.intent?.hit} against ${hitsBefore.map((hit) => hit.id).join(", ")})`);
      // At a table a person runs it waits for the GM: the chip is held, not live.
      const shieldChip = adaStrip.getByRole("button", { name: /^Shield/ }).first();
      const answered = await eventually(async () => !(await adaStrip.isVisible().catch(() => false)) || (await shieldChip.getAttribute("aria-disabled")) === "true", { timeoutMs: 20_000, label: "Ada's Shield held" }).catch(() => false);
      soft(answered, "Ada's Shield chip stays live once Shield is played");
      await t.shot("s2-shielded");

      // ---- 4. Conjure Animals on the Hand: the creature and the number ----
      const { conjure, familiar } = bench;
      await t.open(`/campaigns/${conjure.id}`);
      await onTable(hand, "the druid's Hand");
      const conjureCard = hand.getByRole("button", { name: /^Conjure Animals, / }).first();
      await eventually(() => conjureCard.isVisible(), { timeoutMs: 20_000, label: "the Conjure Animals card" });
      await tapCard(conjureCard);
      const creature = hand.getByRole("button", { name: "Creature for Conjure Animals" });
      await eventually(() => creature.isVisible(), { timeoutMs: 20_000, label: "the creature to pick" });
      const conjureSend = aimSend(hand);
      check(await conjureSend.isDisabled(), "Conjure Animals waits for its creature");
      await fingerSized(creature, "the creature picker");
      await t.tap(creature);
      const wolf = menuItem(/^Wolf/);
      await eventually(() => wolf.isVisible(), { timeoutMs: 20_000, label: "the wolf among the beasts" });
      await themes("s4-hand-creature-menu");
      await t.tap(wolf);
      const number = hand.getByRole("radiogroup", { name: "Number" });
      await eventually(() => number.isVisible(), { label: "the number of wolves" });
      check((await number.getByRole("radio", { name: "8", exact: true }).getAttribute("aria-checked")) === "true", "the number starts at the most, eight");
      await t.tap(number.getByRole("radio", { name: "4", exact: true }));
      check((await number.getByRole("radio", { name: "4", exact: true }).getAttribute("aria-checked")) === "true", "four wolves picked");
      for (const pill of await number.getByRole("radio").all()) await fingerSized(pill, "a number pill");
      await themes("s4-hand-summon", hand);
      const conjured = posted(conjure.id, "actions");
      await t.tap(conjureSend);
      const conjureAnswer = await conjured;
      const conjureBody = JSON.stringify(JSON.parse(conjureAnswer.request().postData() ?? "{}").intent ?? {});
      check(conjureAnswer.ok(), `the summon card answered ${conjureAnswer.status()}: ${(await conjureAnswer.text()).slice(0, 200)}`);
      check(/Wolf/.test(conjureBody) && /"count":4/.test(conjureBody), `the card carries the wolves and their number (${conjureBody})`);
      await t.shot("s4-hand-sent");

      // ---- 4. The sheet's summoning, out of a fight ----
      await t.open(`/campaigns/${familiar.id}`);
      await openPanelTab(t, "party");
      const partyCard = visible(`[data-party-card="${familiar.wren.id}"]`);
      await eventually(() => partyCard.count(), { timeoutMs: 30_000, label: "Wren's party card" });
      await t.tap(partyCard.getByRole("button", { name: `Options for ${familiar.wren.name}` }));
      await t.tap(page.getByRole("menuitem", { name: "View sheet" }).locator("visible=true").first());
      const sheetDialog = page.getByRole("dialog").filter({ hasText: familiar.wren.name }).first();
      const summoning = sheetDialog.locator('section[aria-label="Summoning"]');
      await eventually(() => summoning.isVisible(), { timeoutMs: 20_000, label: "the sheet's summoning" });
      const rowOf = (spell) => summoning.locator("div.rounded-lg").filter({ hasText: spell }).first();
      const findFamiliar = rowOf("Find Familiar");
      await findFamiliar.scrollIntoViewIfNeeded();
      await t.tap(findFamiliar.getByRole("button", { name: "Creature for Find Familiar" }));
      await eventually(() => menuItem(/^Owl/).isVisible(), { label: "the owl among the familiars" });
      await t.tap(menuItem(/^Owl/));
      const kind = findFamiliar.getByRole("radiogroup", { name: "Kind" });
      await t.tap(kind.getByRole("radio", { name: "Fey" }));
      check((await kind.getByRole("radio", { name: "Fey" }).getAttribute("aria-checked")) === "true", "the familiar is fey");
      const ritual = findFamiliar.getByRole("button", { name: "Cast as a ritual" });
      check(await ritual.isEnabled(), "Cast as a ritual is offered out of a fight");
      await fingerSized(ritual, "Cast as a ritual");
      await fingerSized(kind.getByRole("radio", { name: "Fey" }), "a kind pill");
      const animate = rowOf("Animate Dead");
      const mix = animate.getByRole("group", { name: "Each target's form for Animate Dead" });
      await t.tap(mix.getByRole("button", { name: "One more Zombie" }));
      await eventually(async () => /0 left/.test(await mix.innerText()), { label: "the slot's one target spent on a zombie" });
      check(await mix.getByRole("button", { name: "One more Skeleton" }).isDisabled(), "no skeleton past the slot's budget");
      await fingerSized(mix.getByRole("button", { name: "One fewer Zombie" }), "a form stepper");
      await findFamiliar.scrollIntoViewIfNeeded();
      await themes("s4-sheet-summoning", summoning);
      const ritualPosted = posted(familiar.id, "actions");
      await t.tap(ritual);
      const ritualAnswer = await ritualPosted;
      const ritualIntent = JSON.parse(ritualAnswer.request().postData() ?? "{}").intent ?? {};
      check(ritualAnswer.ok(), `the ritual answered ${ritualAnswer.status()}: ${(await ritualAnswer.text()).slice(0, 200)}`);
      check(ritualIntent.ritual === true && /Owl/.test(JSON.stringify(ritualIntent)) && /fey/i.test(JSON.stringify(ritualIntent)), `the ritual carries the owl and its kind (${JSON.stringify(ritualIntent)})`);
      await eventually(() => summoning.getByText("Sent.").isVisible(), { label: "Sent." });
      await t.shot("s4-sheet-sent");
      await page.keyboard.press("Escape");

      // ---- 5. The GM console: Cast a buff and Summon a pet ----
      const { console: desk } = bench;
      await t.open(`/campaigns/${desk.id}`);
      await openPanelTab(t, "dm");
      const combat = page.locator(`${root}button.dm-tab`).filter({ hasText: /^Combat$/ }).locator("visible=true").first();
      await eventually(() => combat.count(), { timeoutMs: 30_000, label: "the console's Combat tab" });
      await t.tap(combat);
      // One form is open at a time; an open one is used again.
      const openForm = async (label) => {
        const open = page.locator(`${root}.ornate`).filter({ hasText: label }).locator("visible=true").first();
        if (await open.count()) return open;
        const plate = page.locator(`${root}button`).filter({ hasText: new RegExp(label) }).locator("visible=true").first();
        await eventually(() => plate.count(), { label: `${label} in the console` });
        await t.tap(plate);
        const form = page.locator(`${root}.ornate`).filter({ hasText: label }).locator("visible=true").first();
        await eventually(() => form.count(), { label: `the ${label} form` });
        return form;
      };
      const choose = async (form, field, option) => {
        await t.tap(form.getByRole("button", { name: field, exact: true }));
        await eventually(() => menuItem(option).isVisible(), { label: `${option} in ${field}` });
        await t.tap(menuItem(option));
      };
      const run = async (form) => {
        const ran = posted(desk.id, "dm/invoke");
        await t.tap(form.getByRole("button", { name: "Run", exact: true }));
        const answer = await ran;
        check(answer.ok(), `the console's form answered ${answer.status()}: ${(await answer.text()).slice(0, 300)}`);
      };
      const cast = await openForm("Cast a buff");
      await choose(cast, "Caster", desk.corvin.name);
      await cast.getByRole("textbox", { name: "Spell" }).fill("Animate Dead");
      await cast.getByRole("spinbutton", { name: "Slot level" }).fill("3");
      const consoleMix = cast.getByRole("group", { name: "Each target's form for Animate Dead" });
      await eventually(() => consoleMix.isVisible(), { timeoutMs: 20_000, label: "Each target's form for Animate Dead" });
      await t.tap(consoleMix.getByRole("button", { name: "One more Skeleton" }));
      await eventually(async () => /0 left/.test(await consoleMix.innerText()), { label: "one skeleton" });
      await fingerSized(consoleMix.getByRole("button", { name: "One fewer Skeleton" }), "the console's form stepper");
      await consoleMix.scrollIntoViewIfNeeded();
      await themes("s5-console-mix", cast);
      await run(cast);
      await eventually(async () => ((await snapshot(desk.id)).sheets ?? []).some((sheet) => sheet.summon?.casterId === desk.corvin.id && /skeleton/i.test(sheet.name)), { timeoutMs: 20_000, label: "Corvin's skeleton raised" });
      const steed = await openForm("Cast a buff");
      await choose(steed, "Caster", desk.hale.name);
      await steed.getByRole("textbox", { name: "Spell" }).fill("Find Steed");
      await steed.getByRole("spinbutton", { name: "Slot level" }).fill("2");
      const kinds = steed.getByRole("radiogroup", { name: "Kind" });
      await eventually(() => kinds.isVisible(), { timeoutMs: 20_000, label: "Find Steed's Kind" });
      await t.tap(kinds.getByRole("radio", { name: "Fey" }));
      check((await kinds.getByRole("radio", { name: "Fey" }).getAttribute("aria-checked")) === "true", "the steed is fey");
      await fingerSized(kinds.getByRole("radio", { name: "Fey" }), "a Kind pill");
      await kinds.scrollIntoViewIfNeeded();
      await themes("s5-console-kind", steed);
      const pet = await openForm("Summon a pet");
      await choose(pet, "Owner", desk.hale.name);
      await choose(pet, "Kind", "Familiar");
      await t.tap(pet.getByRole("button", { name: "Creature", exact: true }));
      await eventually(() => menuItem(/^Owl/).isVisible(), { timeoutMs: 20_000, label: "the familiar forms" });
      await themes("s5-console-pet-creature");
      await t.tap(menuItem(/^Owl/));
      await choose(pet, "Kind", "A pet the story gave them");
      await t.tap(pet.getByRole("button", { name: "Creature", exact: true }));
      await eventually(() => menuItem(/Not in the list/).isVisible(), { label: "Not in the list for a story pet" });
      await t.tap(menuItem(/Not in the list/));
      const typedPet = pet.getByRole("textbox", { name: "Not in the list" });
      await eventually(() => typedPet.isVisible(), { label: "the story pet's own name" });
      await typedPet.fill("clockwork crow");
      await pet.getByRole("spinbutton", { name: "Hit points" }).fill("9");
      await pet.getByRole("spinbutton", { name: "Armor Class" }).fill("13");
      await typedPet.scrollIntoViewIfNeeded();
      await themes("s5-console-pet-story", pet);
      await run(pet);
      await eventually(async () => ((await snapshot(desk.id)).sheets ?? []).find((sheet) => sheet.id === desk.hale.id)?.pets?.some((entry) => /clockwork crow/i.test(entry.name ?? entry.form ?? "")), { timeoutMs: 20_000, label: "Hale's clockwork crow" });

      // ---- 6. The monsters' Hand: legendary cards, their aim, the lair ----
      const { sphinx } = bench;
      await t.open(`/campaigns/${sphinx.id}`);
      const monsters = visible(`section[aria-label="The monsters' hand"]`);
      await onTable(monsters, "the monsters' hand");
      const showCards = monsters.getByRole("button", { name: "Show the monsters' cards" });
      if (await showCards.count()) await t.tap(showCards.first());
      const chip = monsters.getByRole("group", { name: "Which monster" }).getByRole("button", { name: /Gynosphinx/ }).first();
      await eventually(() => chip.isVisible(), { timeoutMs: 20_000, label: "the sphinx's chip" });
      const chipWords = (await chip.innerText()).replace(/\s+/g, " ");
      check(/3 legendary/.test(chipWords) && /lair/.test(chipWords), `the chip says 3 legendary and the lair (${chipWords})`);
      await t.tap(chip);
      const cards = monsters.getByRole("group", { name: "Gynosphinx's cards" });
      const legendary = (name) => cards.getByRole("button", { name: new RegExp(`^${name}, Legendary`) }).first();
      await eventually(() => legendary("Teleport").isVisible(), { timeoutMs: 20_000, label: "the Teleport card" });
      check(/Costs 2\s+3\/3 left/.test(await legendary("Teleport").innerText()), `Teleport says its cost and what is left (${await legendary("Teleport").innerText()})`);
      check(/Costs 3\s+3\/3 left/.test(await legendary("Cast a Spell").innerText()), `Cast a Spell says its cost and what is left (${await legendary("Cast a Spell").innerText()})`);
      // What is left shows on each card in the fan, the next card covering
      // none of it: here, and on a narrower desktop where the fan is tighter.
      const footCovered = async () => {
        await page.mouse.move(1, 1);
        await untilStill(page).catch(() => undefined);
        return cards.locator('.hand-card[data-cost="legendary"]').evaluateAll((nodes) =>
          nodes.flatMap((card) => {
            card.scrollIntoView({ block: "nearest", inline: "nearest" });
            const lines = [...card.querySelectorAll(".hand-resource > span")];
            return (lines.length ? lines : [card.querySelector(".hand-resource")]).flatMap((line) => {
              const range = document.createRange();
              range.selectNodeContents(line);
              const box = range.getBoundingClientRect();
              const top = document.elementFromPoint(box.right - 1.5, box.top + box.height / 2);
              return top && card.contains(top) ? [] : [`${card.getAttribute("aria-label")?.split(",")[0]}: "${line.textContent}"`];
            });
          }),
        );
      };
      const hidden = await footCovered();
      soft(!hidden.length, `a legendary card's cost or what is left lies under the next card (${hidden.join(" | ")})`);
      if (!phone) {
        const size = page.viewportSize();
        await page.setViewportSize({ width: 1280, height: 800 });
        const tight = await footCovered();
        soft(!tight.length, `at 1280 wide a legendary card's cost or what is left lies under the next card (${tight.join(" | ")})`);
        await t.shot("s6-legendary-cards-1280");
        await page.setViewportSize(size);
      }
      const lairCard = cards.getByRole("button", { name: /^Lair: .*, Lair/ }).first();
      check(await lairCard.isVisible(), "the lair's card on initiative 20");
      check(/Initiative 20/.test(await lairCard.innerText()), `the lair's card says initiative 20 (${await lairCard.innerText()})`);
      for (const card of [legendary("Teleport"), legendary("Cast a Spell"), lairCard]) await fingerSized(card, "a legendary or lair card");
      await themes("s6-legendary-cards", monsters);
      await tapCard(legendary("Cast a Spell"));
      const spellPick = monsters.getByRole("combobox", { name: "Spell" });
      await eventually(() => spellPick.isVisible(), { label: "the sphinx's spell to cast" });
      const spells = await spellPick.locator("option").allInnerTexts();
      check(spells.length > 2 && /Pick one from its list/.test(spells[0]), `the spells of its list (${spells.slice(0, 6).join(", ")})`);
      await spellPick.selectOption({ index: 1 });
      await fingerSized(spellPick, "the spell picker");
      await themes("s6-aim-spell", monsters);
      check(/Costs 3 · 3\/3 left/.test(await monsters.innerText()), "the aim bar says the spell's cost and what is left");
      // The aim bar holds the fan's place: Back to the cards.
      await t.tap(monsters.getByRole("button", { name: "Back", exact: true }));
      await eventually(() => legendary("Teleport").isVisible(), { label: "the cards again" });
      await tapCard(legendary("Teleport"));
      const where = monsters.getByRole("group", { name: "Where it goes" });
      await eventually(() => where.isVisible(), { label: "where the sphinx goes" });
      const board = await (await api.get(`${base}/api/campaigns/${sphinx.id}/battle-map`)).json();
      const sphinxToken = (board.view?.tokens ?? []).find((token) => token.refId === sphinx.sphinx.id);
      check(sphinxToken, "the sphinx is on the board");
      const to = { x: sphinxToken.x + 2, y: Math.max(0, sphinxToken.y - 2) };
      // The column, then the row (MonsterHandAim.tsx).
      const [column, row] = [where.getByRole("spinbutton").nth(0), where.getByRole("spinbutton").nth(1)];
      check(/column/i.test(`${await column.getAttribute("aria-label")} ${await column.evaluate((node) => node.closest("label")?.textContent ?? "")}`), "the first picker is the column");
      await column.fill(String(to.x));
      await row.fill(String(to.y));
      await fingerSized(column, "the column picker");
      await themes("s6-aim-square", monsters);
      const teleported = posted(sphinx.id, "dm/invoke");
      await t.tap(monsters.getByRole("button", { name: "Play Teleport" }));
      const teleportAnswer = await teleported;
      check(teleportAnswer.ok(), `Teleport answered ${teleportAnswer.status()}: ${(await teleportAnswer.text()).slice(0, 300)}`);
      await eventually(async () => {
        const after = await (await api.get(`${base}/api/campaigns/${sphinx.id}/battle-map`)).json();
        const token = (after.view?.tokens ?? []).find((entry) => entry.refId === sphinx.sphinx.id);
        return token && token.x === to.x && token.y === to.y;
      }, { timeoutMs: 20_000, label: "the sphinx where it teleported" });
      // One legendary action at a turn's end: the lair's card stays.
      await eventually(async () => !(await legendary("Teleport").isVisible().catch(() => false)), { label: "no more legendary cards this turn's end" });
      check(await lairCard.isVisible(), "the lair's card stays after the legendary action");
      await themes("s6-after-teleport", monsters);
      // The GM's side panel names every combatant in full: the roster and
      // the order squeezed them to a letter beside their chips and buttons.
      await openPanelTab(t, "battle");
      await eventually(async () => (await page.getByText(sphinx.sphinx.name, { exact: true }).locator("visible=true").count()) > 0, { timeoutMs: 20_000, label: "the battle panel" });
      const cut = await clippedNames([sphinx.sphinx.name, sphinx.kara.name, "Dorn Ashby"]);
      soft(!cut.length, `the GM panel cuts names short (${cut.join(" | ")})`);
      const split = await orderSplit();
      soft(!split.length, `the order's buttons split across lines (${split.join(" | ")})`);
      await themes("s6-gm-panel");

      // ---- 7. A dominated hero's Hand in the GM seat, on his turn ----
      const { dominated } = bench;
      await t.open(`/campaigns/${dominated.id}`);
      await onTable(hand, "Bran's Hand in the GM seat");
      check(!(await visible(`section[aria-label="The monsters' hand"]`).isVisible().catch(() => false)), "no monsters' hand on Bran's turn");
      const sword = hand.getByRole("button", { name: /^Longsword, / }).first();
      await eventually(() => sword.isVisible(), { timeoutMs: 20_000, label: "Bran's Longsword card" });
      await tapCard(sword);
      const targets = hand.getByRole("group", { name: "Targets" });
      await eventually(() => targets.isVisible(), { label: "the sword's targets" });
      const targetWords = (await targets.innerText()).replace(/\s+/g, " ");
      check(targetWords.includes(dominated.sela.name) && !targetWords.includes(dominated.mage.name), `Bran's sword is aimed at the party, not the mage (${targetWords})`);
      await themes("s7-dominated-hand", hand);
      await t.tap(hand.getByRole("button", { name: "Back", exact: true }));
      const endCard = hand.getByRole("button", { name: /^End turn, / }).first();
      await tapCard(endCard);
      const ended = posted(dominated.id, "encounter/end-turn");
      await t.tap(hand.getByRole("button", { name: "End turn", exact: true }));
      const endAnswer = await ended;
      check(endAnswer.ok(), `End turn answered ${endAnswer.status()}: ${(await endAnswer.text()).slice(0, 200)}`);
      await eventually(async () => {
        const encounter = (await snapshot(dominated.id)).encounter;
        return encounter && encounter.order[encounter.turnIndex]?.characterId !== dominated.bran.id;
      }, { timeoutMs: 20_000, label: "the turn past Bran" });
      await t.shot("s7-ended");
      await openPanelTab(t, "battle");
      await eventually(async () => (await page.getByText(dominated.bran.name, { exact: true }).locator("visible=true").count()) > 0, { timeoutMs: 20_000, label: "the battle panel" });
      const cutHere = await clippedNames([dominated.bran.name, dominated.sela.name, dominated.mage.name]);
      soft(!cutHere.length, `the GM panel cuts names short (${cutHere.join(" | ")})`);
      const splitHere = await orderSplit();
      soft(!splitHere.length, `the order's buttons split across lines (${splitHere.join(" | ")})`);
      await themes("s7-gm-panel");

      // ---- 8. A steered table: the console, and no monsters' Hand ----
      const { steered } = bench;
      const pointed = await api.patch(`${base}/api/campaigns/${steered.id}/story-settings`, {
        data: { textProvider: "custom", customBaseUrl: `http://127.0.0.1:${port}/v1`, customModel: "fight-bench-2-narrator" },
      });
      soft(pointed.ok(), `pointing the steered table at the stand-in answered ${pointed.status()}`);
      await t.open(`/campaigns/${steered.id}`);
      await onTable(composer, "the steered table's message box");
      await untilStill(page).catch(() => undefined);
      check(!(await page.locator(`${root}section[aria-label="The monsters' hand"]`).locator("visible=true").count()), "no monsters' Hand at a steered table");
      await t.shot("s8-steered-table");
      await openPanelTab(t, "dm");
      const queue = visible('[data-tour="dm-queue"]');
      await eventually(() => queue.isVisible(), { timeoutMs: 30_000, label: "the GM console" });
      check(!(await page.locator(`${root}section[aria-label="The monsters' hand"]`).locator("visible=true").count()), "no monsters' Hand beside the console");
      await themes("s8-steered-console", queue);

      // ---- 9. The event log: a turn that changed the fight, reverted ----
      const { revert } = bench;
      await t.open(`/campaigns/${revert.id}`);
      await openPanelTab(t, "story");
      const logTab = page.locator(`${root}button.session-subtab`).filter({ hasText: /^\s*Log\s*$/ }).locator("visible=true").first();
      await eventually(() => logTab.count(), { timeoutMs: 30_000, label: "the Story panel's Log" });
      await t.tap(logTab);
      const tokensNow = async () => ((await (await api.get(`${base}/api/campaigns/${revert.id}/battle-map`)).json()).view?.tokens ?? []).map((token) => `${token.refId}@${token.x},${token.y}`).sort();
      const boardBefore = await tokensNow();
      await invoke(revert.id, "add_enemies", { enemies: [{ monster: "goblin", count: 1 }] });
      const arrived = ((await snapshot(revert.id)).encounter?.enemies ?? []).find((enemy) => enemy.id !== revert.goblin);
      check(arrived, "a second goblin arrived");
      // A later turn moves it: the revert asks first.
      const placed = ((await (await api.get(`${base}/api/campaigns/${revert.id}/battle-map`)).json()).view?.tokens ?? []).find((token) => token.refId === arrived.id);
      await invoke(revert.id, "move_token", { token: arrived.id, x: placed.x, y: Math.max(0, placed.y - 1) });
      // The log's rows for the two calls, as the server words them: the
      // add's (the goblins, renamed Goblin 1 and 2, their tokens, the order)
      // and the move's.
      const fightChanges = (await snapshot(revert.id)).turnChanges.filter((change) => change.kind === "fight");
      const [addLine, moveLine] = fightChanges.slice(-2).map((change) => change.line);
      check(/creature/.test(addLine) && /order of turns/.test(addLine) && /1 token/.test(moveLine), `the calls' lines (${addLine} | ${moveLine})`);
      const rowSaying = (line) => page.locator(`${root}li`).filter({ hasText: line }).locator("visible=true").last();
      const fightRow = rowSaying(addLine);
      // Told live, as the GM watches: the line says what the call changed.
      await eventually(() => fightRow.isVisible(), { timeoutMs: 30_000, label: `the add's row in the event log (${addLine})` });
      await eventually(() => rowSaying(moveLine).isVisible(), { timeoutMs: 30_000, label: `the move's row (${moveLine})` });
      log(`fight row: ${(await fightRow.innerText()).replace(/\s+/g, " ")}`);
      // Each turn's row carries its own revert, above its line.
      const rowRevert = fightRow.getByRole("button", { name: /Revert this turn/ });
      await eventually(() => rowRevert.isVisible(), { label: "the turn's Revert this turn" });
      await fingerSized(rowRevert, "Revert this turn");
      await themes("s9-log-row", fightRow.locator("xpath=.."));
      const asked = posted(revert.id, "audit/revert-turn");
      await t.tap(rowRevert);
      check((await asked).status() === 409, "the revert asks first about the later move");
      const dialog = page.getByRole("alertdialog").locator("visible=true").first();
      await eventually(() => dialog.isVisible(), { label: "the revert's dialog" });
      const dialogWords = (await dialog.innerText()).replace(/\s+/g, " ");
      check(/Revert this turn anyway\?/.test(dialogWords) && /character sheets, the clock and the fight back/.test(dialogWords) && /tokens/.test(dialogWords), `the dialog's words (${dialogWords.slice(0, 400)})`);
      await themes("s9-revert-dialog", '[role="alertdialog"]');
      const confirmed = posted(revert.id, "audit/revert-turn");
      await t.tap(dialog.getByRole("button", { name: /Undo anyway/ }));
      const confirmAnswer = await confirmed;
      check(confirmAnswer.ok(), `the revert answered ${confirmAnswer.status()}: ${(await confirmAnswer.text()).slice(0, 200)}`);
      await eventually(async () => JSON.stringify(await tokensNow()) === JSON.stringify(boardBefore), { timeoutMs: 20_000, label: "the board as it was before the turn" });
      check(((await snapshot(revert.id)).encounter?.enemies ?? []).filter((enemy) => enemy.status === "alive").length === 1, "the goblin the turn brought is gone");
      await eventually(async () => !(await fightRow.isVisible().catch(() => false)), { label: "the reverted turn's row gone" });
      // The move it wrote over no longer offers to bring back a token without its goblin.
      await eventually(async () => !(await rowSaying(moveLine).isVisible().catch(() => false)), { label: "the overwritten move's row gone" });
      await t.shot("s9-reverted");

      // ---- 10. The Test fight sheet where only administrators start tables ----
      const signed = await playerApi.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player's sign-in answered ${signed.status()}`);
      const shop = await playerApi.post(`${base}/api/workshops`, { data: { title: `Player's bench ${t.viewport}${t.app ? " app" : ""}`, description: "" } });
      check(shop.ok(), `the player's workshop answered ${shop.status()}`);
      const workshopId = (await shop.json()).workshop.id;
      const fight = await playerApi.post(`${base}/api/campaigns/${workshopId}/dm/encounter-templates`, { data: { name: "Goblin pair", enemies: "goblin x2", battlefield: "a lane", notes: "" } });
      check(fight.ok(), `the player's fight answered ${fight.status()}`);
      const templateId = (await fight.json()).template.id;
      switchBefore = ((await (await api.get(`${base}/api/admin/settings`)).json()).config?.sharedHost?.campaignCreation) ?? "everyone";
      const flipped = await api.patch(`${base}/api/admin/settings`, { data: { sharedHost: { campaignCreation: "admins" } } });
      check(flipped.ok(), `the admin switch answered ${flipped.status()}`);
      // The player's own page: the website signed in as them, or the app
      // entered as them.
      other = await newContext(page.context().browser(), t.viewport, { app: t.app });
      const theirs = await other.newPage();
      if (t.app) {
        await enterApp(theirs, new URL(page.url()).origin, base, { ...ids, lead: ids.player }, t.touch);
        await theirs.evaluate((to) => window.odmShell.navigation.push(to), `/workshop/${workshopId}?system=encounters`);
      } else {
        await signIn(other, base, ids.player, ids.password);
        // The player's account has seen every tour at its current version too
        // (a revised tour outlives the browser's version-1 flags).
        await seeAllTours(other.request, base);
        await theirs.goto(`${base}/workshop/${workshopId}?system=encounters`, { waitUntil: "networkidle", timeout: 120_000 });
        await hydrated(theirs);
        await settle(theirs);
      }
      const tap = (locator) => (t.touch && t.app ? locator.tap() : locator.click());
      const deploy = theirs.locator(`${root}[data-encounter-deploy="${templateId}"]`).locator("visible=true").first();
      await eventually(() => deploy.count(), { timeoutMs: 30_000, label: "the player's Test fight button" });
      await tap(deploy);
      const sheet = theirs.locator('[data-testid="test-fight-sheet"]').locator("visible=true").first();
      await eventually(() => sheet.isVisible(), { timeoutMs: 15_000, label: "the Test fight sheet" });
      const refused = sheet.locator('[data-testid="test-fight-refused"]');
      await eventually(() => refused.isVisible(), { timeoutMs: 15_000, label: "the sheet's refusal" });
      check(/an administrator starts campaigns, workshops and their test fights/.test(await refused.innerText()), `the refusal's words (${await refused.innerText()})`);
      check(await sheet.getByRole("button", { name: /Start the test fight/ }).isDisabled(), "Start is held");
      await refused.scrollIntoViewIfNeeded();
      await themes("s10-sheet-refused", '[data-testid="test-fight-sheet"]', theirs);

      check(!faults.length, `faults on the bench's screens:\n${faults.join("\n")}`);
    } finally {
      if (switchBefore !== null) {
        await api.patch(`${base}/api/admin/settings`, { data: { sharedHost: { campaignCreation: switchBefore } } }).catch(() => undefined);
      }
      await other?.close().catch(() => undefined);
      model.close();
      await playerApi.dispose().catch(() => {});
    }
  },
};
