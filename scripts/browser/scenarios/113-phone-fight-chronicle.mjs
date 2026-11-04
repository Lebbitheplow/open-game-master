// Issue 713 (2): at phone width in a fight the Table tab had no room for the
// chronicle. A test fight's banner, the round bar, the Hand and the box filled
// a 375 by 667 screen, the chronicle was 0 px tall, and a line sent with Enter
// left the box and seemed to vanish. The chronicle keeps about three lines
// now and the Hand is what gives way (it scrolls in what is left, as it does
// under a short window), so a sent line is always seen.
// Measured on the phones the issue names, day and night; a phone on its
// side is only photographed (hand.css says why); the desktop arrangement is
// 18-table-layout's. A hit still open adds the box's Speaking as row: the Hand
// fell to 0 px under it and the box went under the tab bar, on the runs whose
// goblins went first and hit, so it is forced here on every run.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const sheet = (name) => ({
  name,
  race: "human",
  class: "fighter",
  subclass: "",
  background: "soldier",
  alignment: "N",
  abilities: { str: 16, dex: 15, con: 14, int: 13, wis: 11, cha: 9 },
  maxHp: 12,
  ac: 18,
  acOverride: false,
  speed: 30,
  hitDice: { die: "d10", total: 1, spent: 0 },
  proficiencies: {
    saves: ["str", "con"],
    skills: ["perception", "survival", "athletics", "intimidation"],
    expertise: [],
    languages: ["Common", "Dwarvish"],
    tools: ["dice set", "vehicles (land)"],
    armor: ["light", "medium", "heavy", "shields"],
    weapons: ["simple", "martial"],
  },
  equipment: [{ name: "Longsword", qty: 1 }, { name: "Chain Mail", qty: 1 }, { name: "Shield", qty: 1 }],
  gold: 10,
  copper: 0,
  feats: [],
  features: [{ name: "Fighting Style: Defense", source: "choice" }],
  asiChoices: [],
  spellcasting: null,
  notes: "",
  backstory: "",
});

// About three lines of the chronicle (hand.css gives it 4.5rem).
const THREE_LINES = 72;

export default {
  name: "phone-fight-chronicle",
  viewports: ["phone"],
  async run(t) {
    const { page, base, api, root } = t;
    const stamp = `${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    const made = await api.post(`${base}/api/characters`, { data: { level: 1, role: "pc", sheet: sheet(`Phone Hero ${stamp}`) } });
    check(made.ok(), `a library character (${made.status()})`);
    const characterId = (await made.json()).character.id;
    const shop = await api.post(`${base}/api/workshops`, { data: { title: `Phone fights ${stamp}`, description: "" } });
    check(shop.ok(), "a workshop");
    const workshopId = (await shop.json()).workshop.id;
    let tableId = "";
    try {
      const fight = await api.post(`${base}/api/campaigns/${workshopId}/dm/encounter-templates`, {
        data: { name: `Goblin pair ${stamp}`, enemies: "goblin x2", battlefield: "a muddy lane", notes: "" },
      });
      check(fight.ok(), `a prepared fight (${fight.status()})`);
      const templateId = (await fight.json()).template.id;

      // The author runs it (no model on this server), with the stand-ins.
      await t.open(`/workshop/${workshopId}?system=encounters`);
      const button = page.locator(`${root}[data-encounter-deploy="${templateId}"]`).locator("visible=true").first();
      await eventually(() => button.count(), { timeoutMs: 30_000, label: "the fight's button" });
      await t.tap(button);
      const sheetPanel = page.locator('[data-testid="test-fight-sheet"]').locator("visible=true").first();
      await eventually(() => sheetPanel.isVisible(), { timeoutMs: 15_000, label: "the Test fight sheet" });
      const start = sheetPanel.getByRole("button", { name: /Start the test fight/ });
      await eventually(() => start.isEnabled(), { timeoutMs: 15_000, label: "Start" });
      await untilStill(page);
      await t.tap(start);
      await eventually(async () => (await t.url()).pathname.startsWith("/campaigns/"), { timeoutMs: 60_000, label: "the table the author runs" });
      tableId = (await t.url()).pathname.split("/")[2];

      // Round to the hero's turn, so the party's Hand is dealt under the box.
      await t.tap(page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true }));
      const fightNow = async () => (await (await api.get(`${base}/api/campaigns/${tableId}`)).json()).encounter;
      const theirs = page.locator(`${root}section[aria-label="The monsters' hand"]`).locator("visible=true").first();
      for (let step = 0; step < 6; step += 1) {
        const now = await fightNow();
        if (!now?.enemiesDue?.length) break;
        await eventually(() => theirs.isVisible(), { timeoutMs: 30_000, label: "the monsters' hand" });
        await t.tap(theirs.getByRole("button", { name: "Play the rest for me" }));
        await eventually(async () => !(await fightNow()).enemiesDue?.length, { timeoutMs: 30_000, label: "the enemies played" });
      }
      const hand = page.locator(`${root}section[aria-label="Your hand"]`).locator("visible=true").first();
      await eventually(() => hand.isVisible(), { timeoutMs: 30_000, label: "the party's hand on the hero's turn" });

      // Not filtered on visible: a chronicle 0 px tall is what this measures.
      const log = page.locator(`${root}.cine-chat:has(.hand) > .session-transcript`).first();
      const box = page.locator(`${root}[data-tour="composer-input"] textarea`).locator("visible=true").first();
      const sizes = [
        { width: 375, height: 667, name: "375x667" },
        { width: 360, height: 640, name: "360x640" },
      ];
      // Not filtered on visible either: a Hand 0 px tall is what this measures,
      // and a filtered locator waits 30 s for it and says nothing of why.
      const handBox = page.locator(`${root}.cine-chat section[aria-label="Your hand"]`).first();
      const tabs = page.locator(`${root}nav.cine-bottombar`).locator("visible=true").first();
      const fits = async (size, theme) => {
        const height = await log.evaluate((node) => node.getBoundingClientRect().height);
        check(height >= THREE_LINES, `the chronicle keeps about three lines at ${size.name} in the ${theme} theme (${Math.round(height)} px)`);
        // The Hand gave way, but its name stays in view and its cards
        // scroll inside its own box.
        const strip = await handBox.evaluate((node) => node.getBoundingClientRect().height);
        check(strip >= 16, `the Hand keeps its name in view at ${size.name} (${Math.round(strip)} px)`);
        check(await handBox.evaluate((node) => getComputedStyle(node).overflowY === "auto"), "the Hand scrolls inside its own box");
        const field = await box.boundingBox();
        const bar = await tabs.boundingBox();
        check(field && bar && field.y >= 0 && field.y + field.height <= bar.y + 1, `the box is above the tab bar at ${size.name} (${JSON.stringify(field)}, the bar at ${bar?.y})`);
      };
      let sent = 0;
      for (const size of sizes) {
        await page.setViewportSize({ width: size.width, height: size.height });
        for (const theme of ["dark", "light"]) {
          await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
          await untilStill(page);
          await fits(size, theme);
          // A line sent with Enter lands where it can be read.
          sent += 1;
          const words = `A line sent at ${size.name} ${theme} ${stamp}-${sent}`;
          await box.fill(words);
          await box.press("Enter");
          const line = log.getByText(words, { exact: false }).first();
          await eventually(() => line.count(), { timeoutMs: 15_000, label: `the sent line at ${size.name}` });
          // Its last line at least: a bubble taller than three lines shows
          // its end, scrolled to the bottom as the newest always is.
          await eventually(async () => {
            const at = await line.boundingBox();
            const pane = await log.boundingBox();
            const end = at ? at.y + at.height : 0;
            return Boolean(at && pane && end <= pane.y + pane.height + 1 && end >= pane.y + 20);
          }, { timeoutMs: 10_000, label: `the sent line seen in the chronicle at ${size.name} in the ${theme} theme` });
          await t.shot(`${size.name}-${theme}`);
        }
      }
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

      // A hit still open on the hero whose turn it is: a goblin that has not
      // acted, its die set to hit, whichever way the order and the dice fell.
      const added = await api.post(`${base}/api/campaigns/${tableId}/dm/invoke`, { data: { name: "add_enemies", args: { enemies: [{ monster: "goblin", count: 1 }] } } });
      check(added.ok(), `a fresh goblin (${added.status()}: ${(await added.text()).slice(0, 200)})`);
      const scripted = await api.put(`${base}/api/campaigns/${tableId}/dice-script`, { data: { seed: null, queue: [{ roller: "enemy", kind: "attack", face: 20 }] } });
      check(scripted.ok(), `the goblin's die (${scripted.status()})`);
      const fighting = await fightNow();
      const fresh = fighting.enemies.find((enemy) => enemy.status === "alive" && !enemy.actions?.acted);
      check(fresh, "a goblin that has not acted");
      // The board is drawn from the fight's random id, and about one in 60 leaves
      // a new goblin no firing position this turn. Beside the hero it always has one.
      const heroId = fighting.order[fighting.turnIndex].id;
      const board = (await (await api.get(`${base}/api/campaigns/${tableId}/battle-map`)).json()).view;
      const at = board.tokens.find((token) => token.refId === heroId);
      const goblinToken = board.tokens.find((token) => token.refId === fresh.id);
      check(at && goblinToken, "the hero and the goblin on the board");
      let beside = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        if (beside) break;
        const moved = await api.post(`${base}/api/campaigns/${tableId}/dm/invoke`, { data: { name: "move_token", args: { token: goblinToken.id, x: at.x + dx, y: at.y + dy, teleport: true } } });
        beside = moved.ok();
      }
      check(beside, "the goblin beside the hero");
      const struck = await api.post(`${base}/api/campaigns/${tableId}/dm/invoke`, {
        data: { name: "enemy_attack", args: { enemyId: fresh.id, targetCharacterId: heroId, attack: "Shortbow" } },
      });
      check(struck.ok(), `the goblin's attack (${struck.status()}: ${(await struck.text()).slice(0, 200)})`);
      const speaking = page.locator(`${root}[data-react-as]`).locator("visible=true").first();
      await eventually(() => speaking.isVisible(), { timeoutMs: 15_000, label: "Speaking as, with a hit open" });
      for (const size of sizes) {
        await page.setViewportSize({ width: size.width, height: size.height });
        for (const theme of ["dark", "light"]) {
          await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
          await untilStill(page);
          await fits(size, theme);
          // The bench's one sideways row: its buttons named and reachable.
          const problems = await axeViolations(page, `${root}.test-fight-banner`.trim());
          check(problems.length === 0, `the bench row passes axe at ${size.name} in the ${theme} theme: ${JSON.stringify(problems)}`);
          await t.shot(`${size.name}-${theme}-hit-open`);
        }
      }
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
      // All five of the test bench's buttons are still there, on one row.
      const bench = page.locator(`${root}.test-fight-banner`).locator("visible=true").first();
      check((await bench.getByRole("button").count()) + (await bench.getByRole("link").count()) === 5, "the test bench keeps its five buttons with a hit open");

      // A phone on its side is shorter than the box and the round alone
      // (hand.css): it keeps the arrangement it had, seen here for the record.
      await page.setViewportSize({ width: 667, height: 375 });
      await untilStill(page);
      await t.shot("667x375-dark");

      // Issue 713 (3): what the person running the table rolls and changes
      // from the console is in the chronicle, a roll card and a line, as an
      // AI-run table's rolls are. It used to reach the table only as toasts.
      await page.setViewportSize({ width: 375, height: 667 });
      const hero = (await (await api.get(`${base}/api/campaigns/${tableId}`)).json()).sheets[0];
      const invoke = (name, args) => api.post(`${base}/api/campaigns/${tableId}/dm/invoke`, { data: { name, args } });
      const rolled = await invoke("request_roll", { characterId: hero.id, kind: "ability_check", ability: "str", dc: 10, reason: "a stuck door" });
      check(rolled.ok(), `the console's roll (${rolled.status()}: ${(await rolled.text()).slice(0, 200)})`);
      const hurt = await invoke("apply_damage", { characterId: hero.id, amount: 2, type: "slashing", reason: "a splinter" });
      check(hurt.ok(), `the console's damage (${hurt.status()}: ${(await hurt.text()).slice(0, 200)})`);
      const cards = log.locator("[data-rolled-note]");
      await eventually(async () => (await cards.count()) > 0, { timeoutMs: 15_000, label: "the console's roll as a card in the chronicle" });
      const said = log.getByText(`${hero.name} takes 2 damage`, { exact: false }).last();
      await eventually(() => said.isVisible(), { timeoutMs: 15_000, label: "the console's damage as a line in the chronicle" });
      // The rolls ride beside the words, never in them: a screen built
      // before the cards reads the same note as a plain sentence.
      check(await cards.filter({ hasText: `${hero.name} rolls a check` }).count(), "the roll's own sentence under its card");
      check(!(await log.innerText()).includes("[roll:"), "no roll marker in the chronicle's words");
      await untilStill(page);
      await t.shot("person-record");
      // The scroll beside the board on a wide screen draws the same note.
      await page.setViewportSize({ width: 1920, height: 1080 });
      const scroll = page.locator(`${root}.cine-chronicle`).locator("visible=true").first();
      await eventually(() => scroll.isVisible(), { timeoutMs: 15_000, label: "the scroll beside the board" });
      await eventually(async () => (await scroll.locator(".cine-chronicle-roll").count()) > 0, { timeoutMs: 15_000, label: "the console's roll on the scroll" });
      check(await scroll.getByText(`${hero.name} takes 2 damage`, { exact: false }).count(), "the console's damage on the scroll");
      await t.shot("person-record-wide");
    } finally {
      if (tableId) await api.delete(`${base}/api/campaigns/${tableId}`);
      await api.delete(`${base}/api/workshops/${workshopId}`);
      await api.delete(`${base}/api/characters/${characterId}`);
    }
  },
};
