// Issue 845, away from the Hand: a spell wears the glyph its card wears
// wherever else it is drawn, the party panel's concentration chip, the
// sheet's spellbook, the workshop's homebrew list and the research desk's
// results, and no per-spell
// painting is asked for. Sister Ama holds Spirit Guardians at the quiet
// table (radiant), and her book holds Bless (a boon) and Cure Wounds
// (healing). A workshop spell wears the glyph of the spell it runs as, and
// one that runs as nothing wears the unknown glyph; one with a mechanics
// block of its own wears what that block deals, as its card does. Night
// and day.
import { check, eventually, untilStill } from "../lib.mjs";

// The website serves icons under /assets/icons, the app shell under /game/icons.
const glyphOf = (src) => /\/icons\/glyph\/spell-([a-z]+)\.webp(?:[?#]|$)/.exec(src ?? "")?.[1] ?? null;

// Every image inside a scope: where it comes from and whether it drew.
const images = (locator) =>
  locator.evaluate((node) =>
    [...node.querySelectorAll("img")].map((img) => ({ src: img.getAttribute("src") ?? "", drawn: img.complete && img.naturalWidth > 0 })),
  );

export default {
  name: "spell-glyphs-away",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    const asked = [];
    page.on("request", (request) => {
      if (/\/icons\/spell\//.test(request.url())) asked.push(request.url());
    });

    // ---- the party panel's chip ----
    await t.open(`/campaigns/${ids.quietId}`);
    const card = page.locator(`${root}button[title="View full character sheet"]`).filter({ hasText: "Sister Ama" }).locator("visible=true").first();
    for (const selector of [`${root}[data-tour="tab-party"]`, `${root}.cine-party button`]) {
      if (await card.count()) break;
      const door = page.locator(selector).locator("visible=true").first();
      if (await door.count()) {
        await t.tap(door);
        await eventually(() => card.count(), { timeoutMs: 800 }).catch(() => 0);
      }
    }
    await eventually(() => card.count(), { timeoutMs: 20_000, label: "Sister Ama's party card" });
    const chip = page.locator(`${root}[title="Concentrating on this spell"]`).filter({ hasText: "Spirit Guardians" }).locator("visible=true").first();
    await eventually(() => chip.count(), { timeoutMs: 20_000, label: "the concentration chip" });
    await untilStill(page);
    const [chipArt] = await images(chip);
    check(glyphOf(chipArt?.src) === "radiant" && chipArt.drawn, `the chip wears the radiant glyph (${chipArt?.src}, drawn ${chipArt?.drawn})`);
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      await untilStill(page);
      await t.shot(`party-${theme === "dark" ? "night" : "day"}`);
    }
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

    // ---- the sheet's spellbook ----
    await t.tap(card);
    const sheet = page.locator(`${root}[role="dialog"]`).filter({ has: page.locator(".spell-tile") }).first();
    await eventually(() => sheet.locator(".spell-tile img").count(), { timeoutMs: 20_000, label: "the tiles of Ama's spellbook" });
    // The book sits below the sheet's fold, and an image off screen may wait
    // to load: bring it into view and give its images their time.
    await sheet.locator(".spell-tile").first().scrollIntoViewIfNeeded();
    await untilStill(page);
    const readTiles = () =>
      sheet.evaluate((dialog) =>
        [...dialog.querySelectorAll(".spell-tile")].map((tile) => {
          const img = tile.querySelector("img");
          return { text: tile.textContent?.replace(/\s+/g, " ").trim() ?? "", src: img?.getAttribute("src") ?? "", drawn: Boolean(img?.complete && img.naturalWidth > 0) };
        }),
      );
    await eventually(async () => (await readTiles()).every((entry) => entry.drawn), { timeoutMs: 10_000, label: "the spellbook's glyphs loaded" }).catch(() => undefined);
    const tiles = await readTiles();
    const tile = (name) => tiles.find((entry) => entry.text.startsWith(name));
    check(glyphOf(tile("Bless")?.src) === "buff", `Bless wears the boon glyph (${tile("Bless")?.src})`);
    check(glyphOf(tile("Cure Wounds")?.src) === "heal", `Cure Wounds wears the healing glyph (${tile("Cure Wounds")?.src})`);
    const off = tiles.filter((entry) => !glyphOf(entry.src) || !entry.drawn || entry.src.endsWith("spell-unknown.webp"));
    check(tiles.length >= 2 && off.length === 0, `every tile of the level shown draws a known glyph (${tiles.length} tiles; ${off.map((entry) => `${entry.text}: ${entry.src}`).join(" | ")})`);
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      await untilStill(page);
      await t.shot(`spellbook-${theme === "dark" ? "night" : "day"}`);
    }
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    await page.keyboard.press("Escape");

    // ---- the workshop's homebrew list ----
    const stamp = `${t.viewport[0]}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    const made = [];
    let workshopId = null;
    try {
      const workshop = await api.post(`${base}/api/workshops`, { data: { title: `Glyphs ${stamp}`, description: "" } });
      check(workshop.ok(), "a workshop for the check");
      workshopId = (await workshop.json()).workshop.id;
      const spell = async (name, extra) => {
        const kept = await api.post(`${base}/api/homebrew`, {
          data: { kind: "spell", name, data: { desc: "A test spell.", level: 4, school: "Evocation", casting_time: "1 action", range: "300 feet", components: "V, S", duration: "Instantaneous", ...extra } },
        });
        check(kept.ok(), `the workshop keeps ${name} (${kept.status()})`);
        made.push((await kept.json()).entry?.id);
      };
      const runs = `Frostfire Orb ${stamp}`;
      const bare = `Quiet Hum ${stamp}`;
      // A copy of Fireball the table rewrote to deal cold: its card reads
      // its own block first, so its row does too.
      const block = `Rime Ball ${stamp}`;
      await spell(runs, { runsAs: "Ice Storm" });
      await spell(bare, {});
      await spell(block, { runsAs: "Fireball", mech: { resolution: "save", save: "dex", halfOnSave: true, damageType: "cold" } });
      await t.open(`/workshop/${workshopId}?system=homebrew`);
      const kinds = page.locator(`${root}[data-tour="homebrew-kinds"]`).locator("visible=true").first();
      await eventually(() => kinds.isVisible(), { timeoutMs: 30_000, label: "the kinds of homebrew" });
      await t.tap(kinds.getByRole("radio", { name: /^Spells/ }));
      const row = (name) => page.locator(`${root}li, ${root}[role="listitem"]`).filter({ hasText: name }).locator("visible=true").first();
      await eventually(() => row(runs).count(), { timeoutMs: 20_000, label: `${runs} in the list` });
      await eventually(() => row(bare).count(), { timeoutMs: 20_000, label: `${bare} in the list` });
      await eventually(() => row(block).count(), { timeoutMs: 20_000, label: `${block} in the list` });
      await untilStill(page);
      const runsArt = await images(row(runs));
      const bareArt = await images(row(bare));
      const blockArt = await images(row(block));
      check(runsArt.length === 1 && glyphOf(runsArt[0].src) === "cold" && runsArt[0].drawn, `a spell run as Ice Storm wears its cold glyph, alone (${runsArt.map((img) => img.src).join(", ")})`);
      check(bareArt.length === 1 && glyphOf(bareArt[0].src) === "unknown" && bareArt[0].drawn, `a spell run as nothing wears the unknown glyph, alone (${bareArt.map((img) => img.src).join(", ")})`);
      check(blockArt.length === 1 && glyphOf(blockArt[0].src) === "cold" && blockArt[0].drawn, `a Fireball rewritten to deal cold wears cold, as its card does (${blockArt.map((img) => img.src).join(", ")})`);
      for (const theme of ["dark", "light"]) {
        await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
        await untilStill(page);
        await t.shot(`workshop-${theme === "dark" ? "night" : "day"}`);
      }
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    } finally {
      for (const id of made.filter(Boolean)) {
        await api.delete(`${base}/api/homebrew/${id}`).catch(() => undefined);
        await api.delete(`${base}/api/homebrew/${id}?purge=1`).catch(() => undefined);
      }
      if (workshopId) await api.delete(`${base}/api/workshops/${workshopId}`).catch(() => undefined);
    }

    // ---- the research desk's spell results ----
    // They drew the per-spell painting too, so the same spell had two faces.
    await t.open(`/reference`);
    const spellsTab = page.locator(`${root}[role="tab"]`).filter({ hasText: /^\s*Spells\s*$/ }).locator("visible=true").first();
    await eventually(() => spellsTab.count(), { timeoutMs: 30_000, label: "the research desk's Spells tab" });
    await t.tap(spellsTab);
    const search = page.locator(`${root}input[aria-label="Search"]`).locator("visible=true").first();
    await search.fill("Fireball");
    const result = page.locator(`${root}li`).filter({ hasText: "Fireball" }).filter({ hasNotText: "Delayed" }).locator("visible=true").first();
    const found = await eventually(() => result.count(), { timeoutMs: 15_000, label: "Fireball among the spells" }).then(() => true, () => false);
    if (found) {
      await untilStill(page);
      // The school badge beside the name keeps its school mark.
      const art = (await images(result)).filter((img) => !img.src.includes("/icons/family/"));
      check(art.length === 1 && glyphOf(art[0].src) === "fire" && art[0].drawn, `the research desk's Fireball wears the fire glyph, alone (${art.map((img) => img.src).join(", ")})`);
      await t.shot("reference");
    } else {
      // A server with no content pack lists no spells here to draw.
      check(!(await page.locator(`${root}li img[src*="/icons/spell/"]`).count()), "no spell result draws a painting");
    }

    check(asked.length === 0, `no per-spell painting is asked for (${asked.slice(0, 5).join(", ")})`);
  },
};
