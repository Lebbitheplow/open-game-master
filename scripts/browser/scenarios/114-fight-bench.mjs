// Issue 685: the test fight as a bench. Every control it added, seen running
// on a desktop and a phone, in the night theme and the day one:
// - a prepared fight's Events, picked in its editor, saved and read back;
// - the Test fight sheet's allies, and its note once the fight has a set-up,
//   with the warning when another party is picked;
// - a person-run test table's banner (Back, Save as set-up, Turn trace, Set
//   the dice, End the test), each a finger-sized button on a phone;
// - the dice sheet's seed and forced face, read back after a save;
// - the turn trace after one call from the GM seat, a row opened;
// - Save as set-up, its confirm and its notice, the fight's row that then
//   starts from it, the next test opening on it, and Remove its set-up;
// - an AI-run test, where the author steers from the GM console and is
//   dealt no monsters' Hand;
// - Resolve as played on a player's Web card waiting in the GM console.
import http from "node:http";
import { request } from "playwright-core";
import { axeViolations, check, eventually, freePort, openPanelTab, untilStill } from "../lib.mjs";

// A stand-in narrator, as in test-fight: every turn of the AI GM is one
// short passage.
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
      const content = "The goblins snarl in the mud of the lane and close in.";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }));
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ state, close: () => server.close() })));
}

const companionSheet = (name) => ({
  name,
  race: "human",
  class: "fighter",
  subclass: "",
  background: "soldier",
  alignment: "N",
  abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
  maxHp: 28,
  ac: 16,
  acOverride: false,
  speed: 30,
  hitDice: { die: "d10", total: 3, spent: 0 },
  proficiencies: {
    saves: ["str", "con"],
    skills: ["athletics", "intimidation", "perception", "survival"],
    expertise: [],
    languages: ["Common", "Dwarvish"],
    tools: ["dice set", "vehicles (land)"],
    armor: ["light", "medium", "heavy", "shields"],
    weapons: ["simple", "martial"],
  },
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
  gold: 0,
  copper: 0,
  feats: [],
  features: [{ name: "Fighting Style: Defense", source: "choice" }],
  asiChoices: [],
  spellcasting: null,
  notes: "",
  backstory: "",
});

export default {
  name: "fight-bench",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, api, root, ids } = t;
    const phone = t.viewport === "phone";
    const stamp = `${t.viewport}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    // Faults that do not stop the walk are gathered and reported together,
    // so one run shows every screen.
    const faults = [];
    const soft = (condition, message) => {
      if (!condition) faults.push(message);
    };
    const log = (line) => console.log(`[fight-bench ${t.viewport}${t.app ? " app" : ""}] ${line}`);

    // A picture in each theme, and axe over the part that matters in both.
    async function themes(step, selector) {
      await untilStill(page).catch(() => undefined);
      if (selector) {
        const night = await axeViolations(page, selector);
        soft(night.length === 0, `${step} fails axe at night: ${JSON.stringify(night).slice(0, 500)}`);
      }
      await t.shot(`${step}-night`);
      const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page).catch(() => undefined);
      if (selector) {
        const day = await axeViolations(page, selector);
        soft(day.length === 0, `${step} fails axe in the day theme: ${JSON.stringify(day).slice(0, 500)}`);
      }
      await t.shot(`${step}-day`);
      await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
      await untilStill(page).catch(() => undefined);
    }

    const made = await api.post(`${base}/api/characters`, { data: { level: 3, role: "companion", sheet: companionSheet(`Ally ${stamp}`) } });
    check(made.ok(), `a library companion (${made.status()}: ${(await made.text()).slice(0, 200)})`);
    const allyId = (await made.json()).character.id;
    const shop = await api.post(`${base}/api/workshops`, { data: { title: `Bench ${stamp}`, description: "" } });
    check(shop.ok(), "a workshop");
    const workshopId = (await shop.json()).workshop.id;
    const port = await freePort();
    const model = await narrator(port);
    const playerApi = await request.newContext();
    try {
      const fightName = `Goblin pair ${stamp}`;
      const fight = await api.post(`${base}/api/campaigns/${workshopId}/dm/encounter-templates`, {
        data: { name: fightName, enemies: "goblin x2", battlefield: "a muddy lane", notes: "" },
      });
      check(fight.ok(), `a prepared fight (${fight.status()}: ${(await fight.text()).slice(0, 200)})`);
      const templateId = (await fight.json()).template.id;
      const templateNow = async () =>
        (await (await api.get(`${base}/api/campaigns/${workshopId}/dm/encounter-templates`)).json()).templates.find((entry) => entry.id === templateId);

      // ---- 1. The fight's Events, picked in its editor ----
      // The editor opens from the row's menu, as the author opens it.
      const rowMenu = page.locator(`${root}button[aria-label="More for ${fightName}"]`).locator("visible=true").first();
      const openEditor = async () => {
        await t.open(`/workshop/${workshopId}?system=encounters`);
        await eventually(() => rowMenu.count(), { timeoutMs: 30_000, label: "the fight's row menu" });
        await t.tap(rowMenu);
        const item = page.getByRole("menuitem", { name: "Open", exact: true }).locator("visible=true").first();
        await eventually(() => item.isVisible(), { label: "Open in the row's menu" });
        await t.tap(item);
      };
      await openEditor();
      const events = page.locator(`${root}button`).filter({ hasText: /^\s*Add an event\s*$/ }).locator("visible=true").first();
      await eventually(() => events.count(), { timeoutMs: 30_000, label: "the Events section's Add an event" });
      await events.scrollIntoViewIfNeeded();
      await t.tap(events);
      const first = page.locator(`${root}[role="group"][aria-label="Event 1"]`).locator("visible=true").first();
      await eventually(() => first.isVisible(), { label: "event 1" });
      // A fight on the generator's choice has no squares to change: one line
      // says so, and the ground is not offered.
      const groundNote = page.getByText(/only on a prepared map: link one above/).locator("visible=true").first();
      check(await groundNote.isVisible(), "the note that the ground changes only on a prepared map");
      check(!(await first.getByRole("button", { name: "The ground changes" }).count()), "no change of ground without a map");
      const pick = async (scope, selectName, option) => {
        await t.tap(scope.getByRole("button", { name: selectName, exact: true }));
        const row = page.getByRole("menuitemradio", { name: option }).locator("visible=true").first();
        await eventually(() => row.isVisible(), { label: `${option} in ${selectName}` });
        await t.tap(row);
        await eventually(async () => !(await page.getByRole("menuitemradio").locator("visible=true").count()), { label: `${selectName} closed` });
      };
      await pick(first, "Event 1: when", /When a round begins/);
      // A round's event starts a round after the earliest it can be; the
      // reinforcements here come at round 2.
      const round = first.getByRole("spinbutton", { name: "Event 1: round" });
      check((await round.inputValue()) === "3", `a round event starts at round 3 (${await round.inputValue()})`);
      await t.tap(first.getByRole("button", { name: "Lower Event 1: round" }));
      await eventually(async () => (await round.inputValue()) === "2", { label: "round 2" });
      check(await first.getByRole("button", { name: "Lower Event 1: round" }).isDisabled(), "round 2 is the earliest a round event takes");
      await t.tap(first.getByRole("button", { name: "More creatures arrive" }));
      const search = first.getByRole("textbox", { name: "Search monsters to add" });
      await search.fill("goblin");
      // The plain goblin, not the Chaos-Spawn Goblin the search also finds.
      const goblinChip = first.locator("button").filter({ hasText: /^\W*Goblin\s*CR/ }).locator("visible=true").first();
      await eventually(() => goblinChip.isVisible(), { timeoutMs: 20_000, label: "the bestiary's goblin to add" });
      await t.tap(goblinChip);
      const arrivals = first.getByRole("list", { name: /who arrives/ });
      await eventually(async () => /^\W*Goblin\b/.test(await arrivals.innerText()), { label: "the goblin among the arrivals" });
      await search.fill("");

      await t.tap(events);
      const second = page.locator(`${root}[role="group"][aria-label="Event 2"]`).locator("visible=true").first();
      await eventually(() => second.isVisible(), { label: "event 2" });
      await pick(second, "Event 2: when", /When a creature falls/);
      const which = second.getByRole("button", { name: "Event 2: which creature", exact: true });
      // Named as the plan above names it, not as the roster was typed.
      check(/Goblin 1/.test(await which.innerText()), `the creature that falls is Goblin 1 (${await which.innerText()})`);
      await t.tap(second.getByRole("button", { name: "Tell the table" }));
      const words = "Goblin 1 falls, and the other one bolts for the trees.";
      await second.locator("textarea").fill(words);
      await first.scrollIntoViewIfNeeded();
      await themes("s1-events-editor", `${root}[role="group"][aria-label="Event 1"]`);
      const save = page.locator(`${root}[data-tour="encounters-save"]`).locator("visible=true").first();
      await save.scrollIntoViewIfNeeded();
      await t.tap(save);
      await eventually(async () => ((await templateNow())?.extras?.events?.length ?? 0) === 2, { timeoutMs: 20_000, label: "the two events saved" });
      const saved = (await templateNow()).extras.events;
      check(saved[0].trigger.kind === "round" && saved[0].trigger.round === 2 && saved[0].actions[0]?.kind === "reinforce", `event 1 saved as round 2, reinforcements (${JSON.stringify(saved[0])})`);
      check(saved[1].trigger.kind === "falls" && saved[1].actions[0]?.kind === "say" && saved[1].actions[0].text === words, `event 2 saved as Goblin 1 falls, a line (${JSON.stringify(saved[1])})`);

      // Reopened, it is all still there.
      await openEditor();
      await eventually(() => first.isVisible(), { timeoutMs: 30_000, label: "event 1 after reopening" });
      check(/When a round begins/.test(await first.getByRole("button", { name: "Event 1: when", exact: true }).innerText()), "event 1 reads back its moment");
      check((await first.getByRole("spinbutton", { name: "Event 1: round" }).inputValue()) === "2", "event 1 reads back round 2");
      check(/Goblin/.test(await first.getByRole("list", { name: /who arrives/ }).innerText()), "event 1 reads back its arrivals");
      check((await second.locator("textarea").inputValue()) === words, "event 2 reads back its words");
      await first.scrollIntoViewIfNeeded();
      await t.shot("s1-events-reopened");

      // ---- 2. The Test fight sheet: the allies ----
      const deploy = page.locator(`${root}[data-encounter-deploy="${templateId}"]`).locator("visible=true").first();
      const sheetPanel = page.locator('[data-testid="test-fight-sheet"]').locator("visible=true").first();
      const openSheet = async () => {
        await t.open(`/workshop/${workshopId}?system=encounters`);
        await eventually(() => deploy.count(), { timeoutMs: 30_000, label: "the fight's Test fight button" });
        await t.tap(deploy);
        await eventually(() => sheetPanel.isVisible(), { timeoutMs: 15_000, label: "the Test fight sheet" });
      };
      await openSheet();
      const allies = sheetPanel.locator('[data-testid="test-fight-allies"]');
      await eventually(() => allies.isVisible(), { timeoutMs: 15_000, label: "the allies beside the party" });
      check(/Allies beside them/i.test(await allies.innerText()), "the allies are headed");
      const ally = allies.locator(`[data-test-ally="${allyId}"]`);
      check(await ally.isVisible(), "the library companion is offered as an ally");
      const allyBox = await ally.boundingBox();
      soft(allyBox && allyBox.height >= 40, `an ally's row is finger-sized (${allyBox?.height})`);
      await t.tap(ally);
      await eventually(async () => /1 beside the party/.test(await allies.innerText()), { label: "the ally counted" });
      await allies.scrollIntoViewIfNeeded();
      await themes("s2-sheet-allies", '[data-testid="test-fight-sheet"]');
      await t.tap(ally);
      await eventually(async () => /None unless you pick them/.test(await allies.innerText()), { label: "the ally unpicked" });

      // ---- 3. A person-run test: the banner ----
      const startButton = sheetPanel.getByRole("button", { name: /Start the test fight/ });
      await t.tap(startButton);
      await eventually(async () => (await t.url()).pathname.startsWith("/campaigns/"), { timeoutMs: 60_000, label: "the test table" });
      let tableId = (await t.url()).pathname.split("/")[2];
      // The fight's order settles first, as at the AI-run test below: on a
      // phone the table turns to the board when it lands, and a banner read
      // before that went from under the read of its buttons (CI on #856: 30
      // seconds on a Back link the board had hidden).
      await eventually(async () => {
        const data = await (await api.get(`${base}/api/campaigns/${tableId}`)).json();
        return data.encounter?.orderReady;
      }, { timeoutMs: 60_000, label: "the person-run fight's order" });
      await untilStill(page).catch(() => undefined);
      const banner = page.locator(`${root}.test-fight-banner`).locator("visible=true").first();
      const tableView = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true }).locator("visible=true").first();
      // On a phone the banner is the Table view's, and the table turns to the
      // board once the fight's order is in, which can land after a press of
      // Table: Table is pressed again until the banner shows.
      const showBanner = () =>
        eventually(
          async () => {
            if (await banner.isVisible().catch(() => false)) return true;
            if (phone && (await tableView.count())) await t.tap(tableView).catch(() => undefined);
            return false;
          },
          { timeoutMs: 60_000, every: 1_000, label: "the test fight's banner" },
        );
      await showBanner();
      await untilStill(page).catch(() => undefined);
      // A tap on the phone's table view that landed late (a loaded runner)
      // can flip it away again while the page settles: asked once more.
      await showBanner();
      const controls = [
        banner.getByRole("link", { name: "Back to the workshop" }),
        banner.getByRole("button", { name: "Save as set-up" }),
        banner.getByRole("button", { name: "Turn trace" }),
        banner.getByRole("button", { name: "Set the dice" }),
        banner.getByRole("button", { name: "End the test" }),
      ];
      const width = page.viewportSize().width;
      for (const control of controls) {
        check(await control.isVisible(), `the banner shows ${await control.textContent()}`);
        const box = await control.boundingBox();
        const named = (await control.textContent())?.trim();
        if (phone) soft(box && Math.round(box.height) >= 40, `${named} is at least 40px tall on a phone (${box?.height})`);
        soft(box && box.x >= 0 && box.x + box.width <= width + 0.5, `${named} fits the screen (${JSON.stringify(box)})`);
      }
      const bannerBox = await banner.boundingBox();
      // On a phone with the Hand dealt, the five buttons keep to two rows,
      // the title beside the first (hand.css).
      const rows = new Set(await Promise.all(controls.map(async (control) => Math.round((await control.boundingBox())?.y ?? -1))));
      if (phone) soft(rows.size <= 2, `the banner's buttons keep to two rows on a phone (${[...rows].join(", ")})`);
      log(`banner ${Math.round(bannerBox.width)}x${Math.round(bannerBox.height)}; buttons ${JSON.stringify(await Promise.all(controls.map(async (control) => {
        const box = await control.boundingBox();
        return box ? [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)] : null;
      })))}`);
      await themes("s3-banner", `${root}.test-fight-banner`);

      // ---- 4. Set the dice: a seed and one forced face ----
      await t.tap(banner.getByRole("button", { name: "Set the dice" }));
      const dice = page.getByRole("dialog", { name: "This test's dice" }).locator("visible=true").first();
      await eventually(() => dice.isVisible(), { label: "the dice sheet" });
      const seed = dice.getByPlaceholder("Empty: random dice");
      await eventually(async () => (await seed.isEnabled()) && !(await dice.getByText("Reading").count()), { label: "the dice read" });
      await seed.fill("1234");
      await t.tap(dice.getByRole("button", { name: "Add a forced roll" }));
      const forced = dice.locator('[role="group"][aria-label^="Forced roll 1"]');
      await eventually(() => forced.isVisible(), { label: "the forced roll's row" });
      check(/An enemy/.test(await forced.getByRole("button", { name: "Who rolls", exact: true }).innerText()), "a forced roll starts on an enemy");
      check(/Attack/i.test(await forced.getByRole("button", { name: "Roll", exact: true }).innerText()), "a forced roll starts on an attack");
      check((await forced.getByRole("spinbutton", { name: "Face on the d20" }).inputValue()) === "20", "a forced roll starts on a 20");
      await t.tap(dice.getByRole("button", { name: "Save the dice" }));
      const savedWord = dice.locator("[data-dice-saved]");
      await eventually(() => savedWord.isVisible(), { label: "the dice sheet saying they are saved" });
      await eventually(async () => {
        const script = await (await api.get(`${base}/api/campaigns/${tableId}/dice-script`)).json();
        return script.script?.seed === 1234 && script.script?.queue?.length === 1;
      }, { label: "the dice saved" });
      await themes("s4-dice", '[role="dialog"]');
      await page.keyboard.press("Escape");
      await eventually(async () => !(await dice.isVisible()), { label: "the dice sheet closed" });
      await t.tap(banner.getByRole("button", { name: "Set the dice" }));
      await eventually(async () => (await seed.inputValue()) === "1234", { label: "the seed read back" });
      await eventually(() => forced.isVisible(), { label: "the forced roll read back" });
      const said = (await forced.getAttribute("aria-label")) ?? "";
      check(/20/.test(said), `the forced roll reads back its face (${said})`);
      check(/An enemy/.test(await forced.getByRole("button", { name: "Who rolls", exact: true }).innerText()), "the forced roll reads back its roller");
      await t.shot("s4-dice-reopened");
      await page.keyboard.press("Escape");
      await eventually(async () => !(await dice.isVisible()), { label: "the dice sheet closed again" });

      // ---- 5. The turn trace after one call from the GM seat ----
      const snapshot = await (await api.get(`${base}/api/campaigns/${tableId}`)).json();
      const hero = snapshot.sheets?.[0];
      check(hero, "a stand-in to hurt");
      const hurt = await api.post(`${base}/api/campaigns/${tableId}/dm/invoke`, {
        data: { name: "apply_damage", args: { characterId: hero.id, amount: 2, type: "slashing", reason: "a splinter" } },
      });
      check(hurt.ok(), `the console's damage answered ${hurt.status()}: ${(await hurt.text()).slice(0, 200)}`);
      await t.tap(banner.getByRole("button", { name: "Turn trace" }));
      const trace = page.getByRole("dialog", { name: "Turn trace" }).locator("visible=true").first();
      await eventually(() => trace.isVisible(), { label: "the turn trace" });
      const call = trace.locator("button[aria-expanded]").filter({ hasText: "apply_damage" }).first();
      await eventually(() => call.isVisible(), { timeoutMs: 20_000, label: "the damage call in the trace" });
      const callBox = await call.boundingBox();
      if (phone) soft(callBox && callBox.height >= 40, `a trace row is finger-sized (${callBox?.height})`);
      await t.tap(call);
      await eventually(async () => (await call.getAttribute("aria-expanded")) === "true", { label: "the row opened" });
      check(await trace.getByText("Sent with").first().isVisible(), "the opened row shows what was sent");
      await themes("s5-trace", '[role="dialog"]');
      await page.keyboard.press("Escape");
      await eventually(async () => !(await trace.isVisible()), { label: "the trace closed" });

      // ---- 6. Save as set-up ----
      await t.tap(banner.getByRole("button", { name: "Save as set-up" }));
      const confirm = page.getByRole("dialog", { name: "Save as set-up" }).locator("visible=true").first();
      await eventually(() => confirm.isVisible(), { label: "the set-up's confirm" });
      await themes("s6-setup-confirm", '[role="dialog"]');
      await t.tap(confirm.getByRole("button", { name: "Save as set-up" }));
      const notice = page.getByRole("dialog", { name: "Set-up saved" }).locator("visible=true").first();
      await eventually(() => notice.isVisible(), { timeoutMs: 20_000, label: "the set-up's notice" });
      const summary = (await notice.innerText()).replace(/\s+/g, " ");
      check(/Goblin/.test(summary), `the notice says what was saved (${summary.slice(0, 300)})`);
      await themes("s6-setup-notice", '[role="dialog"]');
      await t.tap(notice.getByRole("button", { name: "OK" }));
      await eventually(async () => Boolean((await templateNow())?.setup?.length), { label: "the set-up on the fight" });

      // The fight's row starts from it now.
      await t.tap(banner.getByRole("link", { name: "Back to the workshop" }));
      const setupRow = page.locator(`${root}[data-encounter-setup="${templateId}"]`).locator("visible=true").first();
      await eventually(() => setupRow.isVisible(), { timeoutMs: 30_000, label: "the row's saved set-up" });
      check(/Starts from a saved set-up/.test(await setupRow.innerText()), "the row says it starts from a set-up");
      // The open test's card above the fights reads as a sentence on a phone.
      const openCard = page.locator(`${root}[data-testid="open-test-fight"] p`).locator("visible=true").first();
      const openBox = await openCard.boundingBox();
      soft(openBox && openBox.width >= 200, `the open test's sentence has room (${openBox?.width})`);
      const disclosure = setupRow.locator("summary");
      const summaryBox = await disclosure.boundingBox();
      soft(summaryBox && summaryBox.height >= 40, `the set-up's disclosure is finger-sized (${summaryBox?.height})`);
      await t.tap(disclosure);
      await eventually(async () => (await setupRow.getAttribute("open")) !== null, { label: "the set-up opened" });
      check(/Goblin/.test(await setupRow.innerText()), "the opened set-up lists the foes");
      await setupRow.scrollIntoViewIfNeeded();
      await themes("s6-row-setup", `${root}[data-encounter-setup="${templateId}"]`);

      // ---- 1, again: the ground changes, now the fight keeps its map ----
      const keptMapId = (await templateNow())?.map?.mapId;
      check(keptMapId, "the set-up kept the board as the fight's map");
      const maps = (await (await api.get(`${base}/api/campaigns/${workshopId}/dm/maps`)).json()).maps ?? [];
      const kept = maps.find((entry) => entry.id === keptMapId);
      check(kept?.width && kept?.height, `the kept map is in the workshop's maps (${JSON.stringify(maps.map((entry) => entry.id)).slice(0, 200)})`);
      await openEditor();
      await eventually(() => second.isVisible(), { timeoutMs: 30_000, label: "event 2 with the kept map" });
      check(!(await page.getByText(/only on a prepared map: link one above/).locator("visible=true").count()), "no map note once the fight has its map");
      const groundChip = second.getByRole("button", { name: "The ground changes" });
      await groundChip.scrollIntoViewIfNeeded();
      await t.tap(groundChip);
      const canvas = second.locator("canvas").first();
      await eventually(() => canvas.isVisible(), { label: "the kept map to pick squares on" });
      await canvas.scrollIntoViewIfNeeded();
      await untilStill(page).catch(() => undefined);
      const squaresSaid = second.getByText(/squares change|Tap each square that changes/).first();
      // Three squares tapped on the map, in from its edge.
      const area = await canvas.boundingBox();
      const tile = area.width / kept.width;
      for (const [x, y] of [[3, 3], [4, 3], [5, 3]]) {
        const at = { x: area.x + (x + 0.5) * tile, y: area.y + (y + 0.5) * tile };
        if (t.touch && t.app) await page.touchscreen.tap(at.x, at.y);
        else await page.mouse.click(at.x, at.y);
      }
      await eventually(async () => /^3 of \d+ squares change/.test(await squaresSaid.innerText()), { label: `three squares tapped (${await squaresSaid.innerText().catch(() => "")})` });
      // A fourth by the keyboard alone: the column and row steppers, then
      // Change this square, at a person's pace: in the app, presses less
      // than a frame apart, as a script sends them, left the stepper a step
      // behind, and the next press then stepped twice.
      const groundName = "Event 2, the ground changing";
      const stepper = (which) => second.getByRole("spinbutton", { name: `${groundName}: ${which}` });
      for (const which of ["column", "row"]) {
        await second.getByRole("button", { name: `Raise ${groundName}: ${which}` }).focus();
        for (let press = 0; press < 2; press += 1) {
          await page.keyboard.press("Enter");
          await page.waitForTimeout(150);
        }
        await eventually(async () => (await stepper(which).inputValue()) === "3", { label: `the ${which} stepped to 3` });
      }
      const changeHere = second.getByRole("button", { name: "Change this square" });
      check((await changeHere.getAttribute("aria-pressed")) === "true", "the square the keys point at, (3,3), is already picked");
      await second.getByRole("button", { name: `Lower ${groundName}: row` }).focus();
      await page.keyboard.press("Enter");
      await eventually(async () => (await stepper("row").inputValue()) === "2", { label: "the row stepped back to 2" });
      await page.waitForTimeout(150);
      await changeHere.focus();
      await page.keyboard.press("Enter");
      await eventually(async () => (await changeHere.getAttribute("aria-pressed")) === "true", { label: "the keyboard's square picked" });
      await eventually(async () => /^4 of \d+ squares change/.test(await squaresSaid.innerText()), { label: "four squares" });
      const hereBox = await changeHere.boundingBox();
      soft(hereBox && Math.round(hereBox.height) >= (phone ? 40 : 28), `Change this square is finger-sized (${hereBox?.height})`);
      await canvas.scrollIntoViewIfNeeded();
      await themes("s1-ground", `${root}[role="group"][aria-label="Event 2"]`);
      await t.tap(save);
      await eventually(async () => {
        const ground = (await templateNow())?.extras?.events?.[1]?.actions?.find((action) => action.kind === "ground");
        return ground?.tiles?.length === 4;
      }, { timeoutMs: 20_000, label: "the change of ground saved with its four squares" });
      const ground = (await templateNow()).extras.events[1].actions.find((action) => action.kind === "ground");
      check(ground.tiles.some((tile) => tile.x === 3 && tile.y === 2), `the keyboard's square (3,2) is saved (${JSON.stringify(ground.tiles)})`);
      await openEditor();
      await eventually(async () => /^4 of \d+ squares change/.test(await squaresSaid.innerText().catch(() => "")), { timeoutMs: 30_000, label: "the four squares read back" });
      await canvas.scrollIntoViewIfNeeded();
      await t.shot("s1-ground-reopened");

      // The sheet says the next test opens on it, and warns of another party.
      await openSheet();
      const note = sheetPanel.locator('[data-testid="test-fight-setup"]');
      await eventually(() => note.isVisible(), { label: "the sheet's set-up note" });
      check(/It opens on its saved set-up/.test(await note.innerText()), "the sheet says it opens on the set-up");
      check(!/another party/.test(await note.innerText()), "no warning for the party it was saved with");
      await t.tap(sheetPanel.getByText("Characters you pick", { exact: true }));
      await eventually(async () => /another party than the set-up was saved with/.test(await note.innerText()), { label: "the warning for another party" });
      // The library's characters in words, not their ids (the seed holds a
      // variant human).
      await eventually(() => sheetPanel.locator("[data-test-pick]").count(), { label: "the library to pick from" });
      const picks = await sheetPanel.locator("[data-test-pick]").allInnerTexts();
      soft(!picks.some((text) => /_|srd-/.test(text)), `the characters are described in words (${picks.join(" | ").slice(0, 300)})`);
      await note.scrollIntoViewIfNeeded();
      await themes("s2-sheet-setup-warning", '[data-testid="test-fight-sheet"]');
      await t.tap(sheetPanel.getByText("The stand-in party", { exact: true }));
      await eventually(async () => !/another party/.test(await note.innerText()), { label: "the warning gone for the stand-ins" });
      await t.tap(startButton);
      await eventually(async () => {
        const at = (await t.url()).pathname;
        return at.startsWith("/campaigns/") && !at.includes(tableId);
      }, { timeoutMs: 60_000, label: "the next test table" });
      tableId = (await t.url()).pathname.split("/")[2];
      const opened = page.getByText(/Opened from the fight's saved set-up/).locator("visible=true").first();
      // On a phone the table turns to the board once the fight's order is
      // in, which can land after a press of Table: Table is pressed again
      // until the chronicle shows.
      await eventually(
        async () => {
          if (await opened.isVisible().catch(() => false)) return true;
          if (phone && (await tableView.count())) await t.tap(tableView).catch(() => undefined);
          return false;
        },
        { timeoutMs: 60_000, every: 1_000, label: "the chronicle's set-up line" },
      );
      await opened.scrollIntoViewIfNeeded().catch(() => undefined);
      await themes("s6-opened-from-setup");

      // ---- 7. An AI-run test: the GM console, no monsters' Hand ----
      const pointed = await api.patch(`${base}/api/campaigns/${workshopId}/story-settings`, {
        data: { textProvider: "custom", customBaseUrl: `http://127.0.0.1:${port}/v1`, customModel: "fight-bench-narrator" },
      });
      check(pointed.ok(), `pointing the workshop at the stand-in answered ${pointed.status()}`);
      await openSheet();
      await eventually(() => sheetPanel.getByRole("radio", { name: /The AI GM/ }).count(), { label: "the AI GM to choose" });
      check(await sheetPanel.getByRole("radio", { name: /The AI GM/ }).isChecked(), "the AI GM runs it by default");
      await t.tap(startButton);
      await eventually(async () => {
        const at = (await t.url()).pathname;
        return at.startsWith("/campaigns/") && !at.includes(tableId);
      }, { timeoutMs: 60_000, label: "the AI-run test table" });
      tableId = (await t.url()).pathname.split("/")[2];
      await eventually(() => model.state.asked > 0, { timeoutMs: 60_000, label: "the AI GM asked to open the fight" });
      // The opening settles first: on a phone the table turns to the board
      // when the fight's order lands, and a banner read before that went
      // from under the read (it waited 30 seconds for a banner the board hid).
      await eventually(async () => {
        const data = await (await api.get(`${base}/api/campaigns/${tableId}`)).json();
        return data.encounter?.orderReady;
      }, { timeoutMs: 60_000, label: "the AI-run fight's order" });
      await untilStill(page).catch(() => undefined);
      await showBanner();
      // A phone leaves the sentence out while a Hand is dealt (hand.css).
      if (!phone) check(/the AI GM runs the enemies/.test((await banner.innerText()).replace(/\s+/g, " ")), "the banner says the AI GM runs it");
      // Then look for the monsters' Hand.
      check(!(await page.locator(`${root}section[aria-label="The monsters' hand"]`).locator("visible=true").count()), "no monsters' Hand at a test the AI runs");
      await t.shot("s7-ai-table");
      await openPanelTab(t, "dm");
      const console_ = page.locator(`${root}[data-tour="dm-queue"]`).locator("visible=true").first();
      await eventually(() => console_.isVisible(), { timeoutMs: 30_000, label: "the GM console" });
      check(!(await page.locator(`${root}section[aria-label="The monsters' hand"]`).locator("visible=true").count()), "no monsters' Hand beside the console");
      await themes("s7-ai-console");
      // End it from the banner.
      await showBanner();
      await t.tap(banner.getByRole("button", { name: "End the test" }));
      const end = page.getByRole("dialog", { name: "End the test" }).locator("visible=true").first();
      await eventually(() => end.isVisible(), { label: "the end confirm" });
      await t.tap(end.getByRole("button", { name: "End the test" }));
      await eventually(async () => (await t.url()).pathname === `/workshop/${workshopId}`, { timeoutMs: 60_000, label: "back in the workshop" });

      // ---- 1, again: Remove its set-up from the row's menu ----
      await eventually(() => setupRow.isVisible(), { timeoutMs: 30_000, label: "the row's set-up before removing it" });
      await t.tap(rowMenu);
      const removeItem = page.getByRole("menuitem", { name: "Remove its set-up" }).locator("visible=true").first();
      await eventually(() => removeItem.isVisible(), { label: "Remove its set-up in the row's menu" });
      await themes("s1-row-menu");
      await t.tap(removeItem);
      const removeConfirm = page.getByRole("dialog").filter({ hasText: "Remove the saved set-up" }).locator("visible=true").first();
      await eventually(() => removeConfirm.isVisible(), { label: "the removal's confirm" });
      await t.tap(removeConfirm.getByRole("button", { name: "Remove the set-up" }));
      await eventually(async () => !(await page.locator(`${root}[data-encounter-setup="${templateId}"]`).count()), { timeoutMs: 20_000, label: "the set-up gone from the row" });
      check(!(await templateNow())?.setup, "the fight has no set-up");
      await t.shot("s1-row-setup-removed");

      // ---- 8. Resolve as played on a player's Web card ----
      const resolveTable = ids.resolveTables[t.viewport];
      const signed = await playerApi.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player's sign-in answered ${signed.status()}`);
      const posted = await playerApi.post(`${base}/api/campaigns/${resolveTable.id}/actions`, {
        data: { kind: "do", characterId: resolveTable.iris, content: "I cast Web on (5,4) using a level 2 slot.", intent: { card: "spell", spell: "Web", slotLevel: 2, atX: 5, atY: 4 } },
      });
      check(posted.status() === 202, `the player's Web card waits for the GM (${posted.status()}: ${(await posted.text()).slice(0, 200)})`);
      const cardId = (await posted.json()).messageId;
      await t.open(`/campaigns/${resolveTable.id}`);
      await openPanelTab(t, "dm");
      const queue = page.locator(`${root}[data-tour="dm-queue"]`).locator("visible=true").first();
      await eventually(() => queue.isVisible(), { timeoutMs: 30_000, label: "Waiting on you" });
      const resolveButton = queue.getByRole("button", { name: "Resolve as played" });
      await eventually(() => resolveButton.isVisible(), { timeoutMs: 30_000, label: "Resolve as played on the Web card" });
      check(/Iris Vane/.test(await queue.innerText()), "the row names the player's wizard");
      const resolveBox = await resolveButton.boundingBox();
      soft(resolveBox && resolveBox.height >= 40, `Resolve as played is finger-sized (${resolveBox?.height})`);
      await queue.scrollIntoViewIfNeeded();
      await themes("s8-waiting", `${root}[data-tour="dm-queue"]`);
      await t.tap(resolveButton);
      await eventually(async () => !(await queue.getByRole("button", { name: "Resolve as played" }).count()), { timeoutMs: 30_000, label: "the row resolved" });
      await eventually(async () => {
        const data = await (await api.get(`${base}/api/campaigns/${resolveTable.id}/messages?limit=40`)).json();
        return (data.messages ?? []).find((message) => message.id === cardId)?.cardResolvedAt;
      }, { timeoutMs: 20_000, label: "the card answered" });
      await untilStill(page).catch(() => undefined);
      await t.shot("s8-resolved");

      check(!faults.length, `faults on the bench's screens:\n${faults.join("\n")}`);
    } finally {
      model.close();
      await playerApi.dispose().catch(() => {});
      await api.delete(`${base}/api/workshops/${workshopId}`).catch(() => undefined);
      await api.delete(`${base}/api/characters/${allyId}`).catch(() => undefined);
    }
  },
};
