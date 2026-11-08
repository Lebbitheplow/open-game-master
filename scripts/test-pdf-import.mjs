// The adventure PDF import (src/lib/pdf-import/*, src/app/api/pdf-imports):
// a book made on the spot (scripts/lib/pdf-fixture.mjs) is read the way the
// page reads it, laid out (two columns, chapters, a read-aloud box, a keyed
// site, a d6 table, a stat block, a gridded map with room numbers, a
// portrait, a corner ornament on every page), drafted without a model,
// read again with a stand-in model, and landed as a new workshop and into a
// WorldForge. Also the gaps fixed beside it: the binder reading a PDF's
// words from the page, a copied rules PDF read for the table it lands on,
// and a book's workshop staying private through Duplicate and a bundle.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { hasPack, openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { adventurePdf, gridMap, MAP_CELL } from "./lib/pdf-fixture.mjs";
import { readPdfInNode } from "./lib/pdf-read-node.mjs";

const { test, finish } = suite("test-pdf-import");

// Files an import writes (its pictures, the uploads a landing makes) go to
// a scratch folder, never the checkout.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "odm-pdf-import-"));
process.chdir(scratch);

// The stand-in story model: answers each piece of the book with what a
// model would find in it, the way models answer (a preamble, a fence).
const requests = [];
let failing = false;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    if (req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push(body);
    if (failing) {
      res.writeHead(500).end("down");
      return;
    }
    const user = String(body.messages?.at(-1)?.content ?? "");
    const found = {
      npcs: [
        { name: "Mother Reed", role: "hag of the mill", gender: "female", attitude: "hostile", description: "A gaunt woman in a cloak of river weed.", goals: "To ring the bell and call back the drowned.", secret: "She drowned the lower village herself.", location: "2. Grinding Room", statBlock: "Bog Hag" },
        { name: "a guard", role: "nobody" },
      ],
      places: [{ name: "Marrowford", description: "A village half under the river.", connections: ["The Sunken Mill"] }, { name: "Cellar", description: "The bell hangs here." }],
      factions: [{ name: "The Reed Covenant", goal: "Keep the river high.", attitude: "hostile", members: ["Mother Reed"] }],
      items: [{ name: "The Drowned Bell", kind: "magic_item", rarity: "rare", attunement: false, description: "When rung underwater, the drowned rise to listen." }, { name: "Nothing at all" }],
      encounters: [{ name: "Eels in the Cellar", place: "3. Cellar", creatures: [{ name: "Giant Eel", count: 4 }], notes: "They guard the bell." }],
      scenes: [
        { title: "The flooded road", kind: "hook", summary: "The heroes reach Marrowford as the rain keeps falling.", place: "Marrowford" },
        { title: "The wheel that turns", kind: "event", summary: "The heroes find the mill's wheel turning with no current.", place: "1. Waterwheel" },
        { title: "Mother Reed's bargain", kind: "npc_moment", summary: "Mother Reed offers the bell for a name.", npc: "Mother Reed", place: "2. Grinding Room" },
      ],
      secrets: [{ title: "Who drowned the village", about: "Mother Reed", notes: "She opened the sluice.", knownBy: ["Mother Reed"] }],
      links: [{ from: "Mother Reed", to: "The Reed Covenant", label: "member of" }, { from: "Mother Reed", to: "Mother Reed", label: "self" }],
    };
    const content = /Chapter 1|Chapter 2|pages/i.test(user) ? `Here is what the pages hold:\n\`\`\`json\n${JSON.stringify(found)}\n\`\`\`` : "{}";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
process.env.DEFAULT_TEXT_PROVIDER = "custom";
process.env.OPENAI_COMPAT_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
process.env.OPENAI_COMPAT_MODEL = "stand-in";

const world = await openWorld();
const { layoutBlocks } = await import("../src/lib/pdf-import/layout-logic.ts");
const { sectionsOf } = await import("../src/lib/pdf-import/sections-logic.ts");
const { findStatBlocks } = await import("../src/lib/pdf-import/statblock-text-logic.ts");
const { furnitureIds, describePictures, detectGrid, gridFit, averageHash } = await import("../src/lib/pdf-import/picture-logic.ts");
const { buildDraft, partyOf } = await import("../src/lib/pdf-import/draft-logic.ts");
const { chunkChars, chunksOf, readChunkReply, mergeFindings, matchKey } = await import("../src/lib/pdf-import/ai-logic.ts");
const { draftToBundle, takenRecords } = await import("../src/lib/pdf-import/bundle-logic.ts");
const { startImportJob, resumeIfStranded, answerKey } = await import("../src/lib/pdf-import/job.ts");
const { settleMonsters } = await import("../src/lib/pdf-import/equivalents.ts");
const { applyMatches } = await import("../src/lib/pdf-import/matches.ts");
const { chooseMatches } = await import("../src/lib/pdf-import/match-logic.ts");
const { landImport } = await import("../src/lib/pdf-import/land.ts");
const { reviewView } = await import("../src/lib/pdf-import/view.ts");
const pdfImports = await import("../src/lib/db/pdf-imports.ts");
const { privateSourceOf, privateSourceOfEntries } = await import("../src/lib/db/private-sources.ts");
const { exportWorldForge, importWorldForge } = await import("../src/lib/db/world-forge-io.ts");
const { workshopBundleSchema, readBundle } = await import("../src/lib/workshop/bundle.ts");
const { exportWorkshopBundle, importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { workshopPrivateSource } = await import("../src/lib/db/workshop-bundle-export.ts");
const { upsertNpc } = await import("../src/lib/db/npcs.ts");
const { cloneCampaign } = await import("../src/lib/db/campaign-clone.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { worldView } = await import("../src/lib/db/world-forge.ts");
const { listHomebrewMonsters } = await import("../src/lib/bestiary/homebrew-monsters.ts");
const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");
const { hostOffers } = await import("../src/lib/use-capabilities.ts");
const { writeUploadedPdf, readUploadedPdfText, writeUploadedPdfText } = await import("../src/lib/uploads-store.ts");
const { pdfTextFilesOf } = await import("../src/lib/pdf-text-files.ts");
const { removeFile } = await import("../src/lib/image-files.ts");
const { insertLoreEntry, getLoreEntry } = await import("../src/lib/db/lore.ts");
const { ingestLoreAttachment } = await import("../src/lib/dm/lore-attachments.ts");
const { runContentImport } = await import("../src/lib/db/content-import.ts");

const book = await adventurePdf();
const reading = await readPdfInNode(book, { fileName: "sunken-mill.pdf" });
const blocks = layoutBlocks(reading.pages, reading.fonts);
const sections = sectionsOf(blocks, reading.outline);
const text = (block) => block.text.replace(/\*\*/g, "");

await test("The layout reads chapters as level 1 under a bigger cover title, and keyed rooms, tables and boxes in reading order.", () => {
  const chapters = blocks.filter((block) => block.kind === "heading" && block.level === 1 && /^Chapter|^Appendix/.test(block.text)).map(text);
  assert.deepEqual(chapters, ["Chapter 1: The Drowned Village", "Chapter 2: The Mill", "Appendix: Creatures"]);
  const boxed = blocks.find((block) => block.kind === "boxed");
  assert.match(boxed.text, /^Black water laps/);
  assert.ok(!boxed.text.includes("Mother Reed"), "the paragraph after the box was read as boxed");
  const table = blocks.find((block) => block.kind === "table");
  assert.equal(table.rows.length, 7);
  assert.deepEqual(table.rows[0], ["d6", "Encounter"]);
  // Running feet and page numbers never reach the reading.
  assert.ok(!blocks.some((block) => /^\d$/.test(text(block)) && block.y > 700), "a page number was read as text");
  assert.ok(!blocks.some((block) => text(block) === "The Sunken Mill" && block.page > 1), "the running foot was read as text");
  // Column order: the left column is finished before the right begins.
  const order = blocks.filter((block) => block.page === 2).map(text);
  assert.ok(order.findIndex((line) => line.startsWith("Rain has fallen")) < order.findIndex((line) => line.startsWith("When the heroes reach")));
});

await test("A printed stat block reads into the bestiary's own record: AC, HP, the six scores split over two lines, the attack's dice.", () => {
  const found = findStatBlocks(sections.flatMap((section) => (section.heading ? [section.heading, ...section.blocks] : section.blocks)));
  assert.equal(found.length, 1);
  const monster = found[0].monster;
  assert.equal(monster.name, "Bog Hag");
  assert.equal(monster.armor_class, 13);
  assert.equal(monster.hit_points, 39);
  assert.deepEqual([monster.strength, monster.dexterity, monster.constitution, monster.intelligence, monster.wisdom, monster.charisma], [16, 12, 14, 11, 13, 15]);
  assert.equal(monster.cr, 2);
  assert.deepEqual(monster.speed, { walk: 30, swim: 30 });
  const stats = parseMonster(monster, monster.cr);
  assert.equal(stats.ac, 13);
  assert.equal(stats.maxHp, 39);
  assert.equal(stats.attacks[0].name, "Claws");
  assert.equal(stats.attacks[0].damage, "2d6+3");
  assert.equal(stats.attacksPerTurn, 2);
});

await test("Pictures: the corner ornament on every page is furniture; the map is a map with its room numbers and its grid; the portrait is art.", () => {
  const furniture = furnitureIds(reading.pages);
  for (const page of reading.pages) assert.ok(furniture.has(page.pictures[0].id), `page ${page.n}'s ornament was kept`);
  const map = reading.pages[2].pictures.find((picture) => !furniture.has(picture.id));
  const portrait = reading.pages[1].pictures.find((picture) => !furniture.has(picture.id));
  const described = describePictures(reading.pages, [
    { picture: map, page: 3, width: 480, height: 360, grid: { cell: MAP_CELL, offsetX: 0, offsetY: 0, confidence: 0.9 } },
    { picture: portrait, page: 2, width: 160, height: 200, grid: null },
  ]);
  assert.equal(described[0].kind, "map");
  assert.equal(described[0].near, "Map 1: The Sunken Mill");
  assert.deepEqual(described[0].keys.map((key) => key.key), ["1", "2", "3"]);
  assert.equal(described[1].kind, "art");
  assert.equal(described[1].near, "Mother Reed");
  assert.equal(averageHash([1, 2, 3]), "", "too few pixels still gave a hash");
});

await test("The grid on a battle map is found from its pixels, and the board fits the picture square for square.", () => {
  const width = 480;
  const height = 360;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const line = x % MAP_CELL === 0 || y % MAP_CELL === 0;
      const at = (y * width + x) * 4;
      rgba.set(line ? [40, 40, 40, 255] : [((x * 7 + y * 3) % 30) + 150, 140, 120, 255], at);
    }
  }
  const grid = detectGrid(rgba, width, height);
  assert.ok(grid, "no grid found");
  assert.ok(Math.abs(grid.cell - MAP_CELL) < 0.5, `cell ${grid.cell}`);
  const fit = gridFit(width, height, grid);
  assert.equal(fit.width, 20);
  assert.equal(fit.height, 15);
  // A picture with no grid gets 30 squares on its long edge.
  const plain = new Uint8ClampedArray(width * height * 4).fill(128);
  assert.equal(detectGrid(plain, width, height), null);
  assert.deepEqual(gridFit(480, 360, null), { width: 30, height: 23, scale: 1, offsetX: 0, offsetY: 0 });
  assert.ok(gridMap().length > 100);
});

const pictures = (() => {
  const furniture = furnitureIds(reading.pages);
  return reading.pages.flatMap((page) => page.pictures.filter((picture) => !furniture.has(picture.id)).map((picture) => ({ picture, page: page.n, width: picture.pw, height: picture.ph, grid: page.n === 3 ? { cell: MAP_CELL, offsetX: 0, offsetY: 0, confidence: 0.9 } : null })));
})();

let draft;
await test("Without a model the draft holds the book's text, the stat block, the d6 table, the keyed site and its rooms, the map, the portrait and a card per story chapter.", () => {
  draft = buildDraft(reading, describePictures(reading.pages, pictures));
  settleMonsters(draft);
  const of = (kind) => draft.records.filter((record) => record.kind === kind);
  assert.equal(draft.title, "The Sunken Mill");
  assert.deepEqual(draft.party, { size: 4, level: 3, stated: true });
  // A size the book does not give is the workshop's default, not a claim;
  // a range of levels keeps its top.
  assert.deepEqual(partyOf("An adventure for characters of levels 3 to 5"), { size: 4, level: 3, levelTo: 5 });
  assert.equal(of("monster")[0].name, "Bog Hag");
  assert.equal(of("monster")[0].data.stats.ac, 13);
  assert.equal(of("table")[0].name, "Random Encounters");
  assert.equal(of("table")[0].data.die, 6);
  assert.equal(of("table")[0].data.entries.length, 6);
  const site = of("location").find((record) => record.name === "Chapter 2: The Mill");
  assert.ok(site, "the keyed site is missing");
  assert.deepEqual(of("location").filter((record) => record.data.partOf === site.name).map((record) => record.name), ["1. Waterwheel", "2. Grinding Room", "3. Cellar"]);
  assert.equal(of("map")[0].data.site, site.key);
  assert.equal(of("map")[0].name, "Map 1: The Sunken Mill");
  assert.equal(of("art")[0].name, "Mother Reed");
  // The appendix is about the book, not its story: lore, no card.
  assert.deepEqual(of("beat").map((record) => record.name), ["Chapter 1: The Drowned Village", "Chapter 2: The Mill"]);
  assert.match(of("beat")[0].data.body, /Read aloud: Black water/);
  const lore = of("lore").map((record) => record.data.body).join("\n");
  assert.match(lore, /> Black water laps/);
  assert.ok(!lore.includes("Armor Class"), "the stat block was left in the prose too");
  assert.ok(of("lore").every((record) => record.data.visibility === "dm"));
});

await test("The draft becomes a bundle the bundle import's own schema takes, links by index, the map squared to its grid.", () => {
  const bundle = draftToBundle(draft, "sunken-mill.pdf", () => "");
  const parsed = workshopBundleSchema.safeParse(bundle);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3)));
  const data = parsed.data;
  assert.equal(data.maps[0].width, 20);
  assert.equal(data.maps[0].terrain.length, 20 * 15);
  assert.deepEqual(data.maps[0].labels.map((label) => label.text), ["1", "2", "3"]);
  const site = data.locations.findIndex((location) => location.name === "Chapter 2: The Mill");
  assert.equal(data.locations[site].map, 0);
  assert.equal(data.storyboard[0].edges[0], 1);
  assert.equal(data.monsters[0].name, "Bog Hag");
  assert.equal(data.tables[0].entries[0].text, "Two hungry wolves");
});

await test("A model's answer is coerced: an unnamed person, an item with no words and a link to oneself are dropped; a known room is merged, not doubled.", () => {
  const found = readChunkReply('Sure!\n```json\n{"npcs":[{"name":"a guard"},{"name":"Mother Reed","gender":"witch","attitude":"furious"}],"items":[{"name":"x"}],"links":[{"from":"A","to":"a","label":"self"}],"places":[{"name":"Cellar","description":"Wet."}]}\n```');
  assert.deepEqual(found.npcs.map((npc) => npc.name), ["Mother Reed"]);
  assert.equal(found.npcs[0].gender, "");
  assert.equal(found.npcs[0].attitude, "indifferent");
  assert.equal(found.items.length, 0);
  assert.equal(found.links.length, 0);
  assert.equal(readChunkReply("I could not read that."), null);
  const merged = mergeFindings(draft, [{ chunk: { index: 0, title: "x", path: [], pages: [3, 3], text: "" }, found }]);
  assert.equal(merged.records.filter((record) => record.kind === "location" && matchKey(record.name) === "cellar").length, 1);
  assert.match(merged.records.find((record) => record.name === "3. Cellar").data.layoutDescription, /Wet\./);
});

await test("A piece of the book fits the model's window: a 16K local model reads small pieces, a large one big pieces.", () => {
  assert.equal(chunkChars(16_384), 16_384);
  assert.equal(chunkChars(2_048), 4_000);
  assert.equal(chunkChars(400_000), 48_000);
  const pieces = chunksOf(draft.sections, 4_000);
  assert.ok(pieces.length >= 1);
  assert.ok(pieces.every((piece) => piece.text.length <= 4_000));
});

// ---- other systems and SRD 5.1 equivalents ----

const { detectSystem, readBxLine, findCreatureTables, crFromXp } = await import("../src/lib/pdf-import/foreign-statblock-logic.ts");
const { buildIndex, matchSrdName, bonusItem, withoutCount, oneOf } = await import("../src/lib/pdf-import/srd-names-logic.ts");
const block = (text, extra = {}) => ({ page: 1, kind: "text", level: 0, text, size: 10, bold: false, italic: false, x: 0, y: 0, w: 100, h: 10, ...extra });

await test("A book's system is told from its stat blocks: B/X lines, Pathfinder saves, the 2024 printing, plain 5e.", () => {
  assert.equal(detectSystem([block("AC 7 [12], HD 2+2 (11hp), Att 1 × bite (1d6), THAC0 17 [+2], MV 180' (60'), SV D12 W13 P14 B15 S16 (1), ML 6, AL Neutral, XP 25")]), "bx");
  assert.equal(detectSystem([block("AC 16; Fort +5, Ref +7, Will +3"), block("Creature 1")]), "pathfinder");
  assert.equal(detectSystem([block("Initiative +2 (12)"), block("CR 1/4 (XP 50; PB +2)")]), "5e-2024");
  assert.equal(detectSystem([block("**Armor Class** 13"), block("**Challenge** 2 (450 XP)")]), "5e");
  assert.equal(detectSystem([block("A short one-shot.")], "Night_Market_5E.pdf"), "5e");
  assert.equal(detectSystem([block("A short one-shot.")], "night-market.pdf"), "unknown");
});

await test("A B/X stat line becomes SRD 5.1 numbers: ascending AC, hit points, the encounter speed, an attack the dice can roll.", () => {
  const wolf = readBxLine("Marsh Wolves", "AC 7 [12], HD 2+2 (11hp), Att 1 × bite (1d6), THAC0 17 [+2], MV 180' (60'), SV D12 W13 P14 B15 S16 (1), ML 6, AL Neutral, XP 25", [block("**► Pack:** Packs of four or more fight on.")]);
  assert.equal(wolf.armor_class, 12);
  assert.equal(wolf.hit_points, 11);
  assert.deepEqual(wolf.speed, { walk: 60 });
  assert.equal(wolf.type, "beast");
  assert.match(wolf.actions[0].desc, /\+2 to hit, reach 5 ft\.,.*Hit: 3 \(1d6\) piercing damage/);
  assert.equal(wolf.special_abilities[0].name, "Pack");
  const golem = readBxLine("Glass Golem", "AC 3 [16], HD 6** (27hp), Att 2 × fist (1d8), THAC0 14 [+5], MV 90' (30'), ML 12, AL Lawful", []);
  assert.equal(golem.type, "construct");
  assert.equal(golem.actions[0].name, "Multiattack");
  assert.ok(golem.cr >= 3, `CR ${golem.cr}`);
  assert.equal(readBxLine("Nobody", "No stats here", []), null);
});

await test("A compact creature table (one row a creature) is read row by row; XP gives the challenge.", () => {
  const table = block("", { kind: "table", rows: [["Creatures", "STR DEX CON INT", "WIS", "CHA HP", "AC", "Hit", "Dmg", "XP"], ["Marsh Hag", "+2", "+1", "+1", "+0", "+1", "+2", "22", "13", "+4", "1d8", "100"], ["Bad row"]] });
  const [hag] = findCreatureTables([table]);
  assert.equal(hag.monster.name, "Marsh Hag");
  assert.equal(hag.monster.hit_points, 22);
  assert.equal(hag.monster.armor_class, 13);
  assert.equal(hag.monster.strength, 14);
  assert.equal(hag.monster.cr, 0.5);
  assert.equal(crFromXp(450), 2);
  assert.ok(hag.table);
});

await test("A name finds its SRD 5.1 entry: a count, a plural, another spelling, another printing's name, a description in front, a title after.", () => {
  const index = buildIndex([{ name: "Kobold", slug: "kobold" }, { name: "Gray Ooze", slug: "gray-ooze" }, { name: "Specter", slug: "specter" }, { name: "Goblin", slug: "goblin" }, { name: "Wolf", slug: "wolf" }, { name: "Mummy", slug: "mummy" }, { name: "Weapon, +1, +2, or +3", slug: "weapon" }]);
  const hit = (name) => matchSrdName(name, index);
  assert.deepEqual([hit("12 Kobolds").entry.name, hit("12 Kobolds").via], ["Kobold", "exact"]);
  assert.equal(hit("Wolves").entry.name, "Wolf");
  assert.deepEqual([hit("Starved Grey Ooze").entry.name, hit("Starved Grey Ooze").via], ["Gray Ooze", "within"]);
  assert.equal(hit("The Spectre of Lady Wren").entry.name, "Specter");
  assert.equal(hit("Goblin Warrior").via, "alias");
  assert.equal(hit("Blind Dwarf Mummy").entry.name, "Mummy");
  assert.equal(hit("Wolf Rider's Lance"), null, "a creature's name at the front of another thing matched");
  assert.equal(hit("Snow Leopard Golem"), null);
  // A bonus counts only on gear the SRD has as a weapon, armor or shield.
  const gear = (base) => ({ longsword: "weapon", "chain mail": "armor" })[base.toLowerCase()] ?? null;
  assert.deepEqual(bonusItem("+1 Longsword", gear), { bonus: 1, base: "Longsword", family: "weapon" });
  assert.deepEqual(bonusItem("Chain Mail +2", gear), { bonus: 2, base: "Chain Mail", family: "armor" });
  assert.equal(bonusItem("Ring of Protection +1", gear), null);
  assert.equal(oneOf(withoutCount("1d6 Oil Beetles")), "Oil Beetle");
});

await test("A 2024-printing stat block reads with its short labels and score table, as SRD 5.1 terms.", () => {
  const blocks = [
    block("Bog Lurker", { kind: "heading", level: 3 }),
    block("Medium Monstrosity, Neutral"),
    block("**AC** 14 **Initiative** +2 (12)"),
    block("**HP** 27 (5d8 + 5)"),
    block("**Speed** 30 ft., swim 30 ft."),
    block("Str 14 +2 +2 Dex 14 +2 +2 Con 12 +1 +1 Int 6 -2 -2 Wis 12 +1 +1 Cha 6 -2 -2"),
    block("**CR** 1 (XP 200; PB +2)"),
    block("Actions"),
    block("**Bite.** Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 7 (2d4 + 2) piercing damage."),
  ];
  const [found] = findStatBlocks(blocks);
  assert.equal(found.monster.armor_class, 14);
  assert.equal(found.monster.hit_points, 27);
  assert.equal(found.monster.strength, 14);
  assert.equal(found.monster.cr, 1);
  assert.equal(parseMonster(found.monster, found.monster.cr).attacks[0].damage, "2d4+2");
});

if (hasPack) {
  await test("With the content pack, an Old-School book's creatures play as their SRD 5.1 equivalents; one with none is converted and marked.", async () => {
    const { settleMonsters } = await import("../src/lib/pdf-import/equivalents.ts");
    const { settleNames } = await import("../src/lib/pdf-import/matches.ts");
    const { unconfirmed } = await import("../src/lib/pdf-import/match-logic.ts");
    const record = (name, printed) => ({ key: `monster:${name}`, kind: "monster", name, pages: [1], source: "", check: [], include: true, from: "book", data: { printed } });
    const drafted = {
      title: "x",
      premise: "",
      party: null,
      system: "bx",
      sections: [],
      records: [
        record("12 Kobolds", readBxLine("12 Kobolds", "AC 7 [12], HD 1/2 (2hp), Att 1 × spear (1d6), THAC0 19 [0], MV 60' (20'), AL Chaotic", [])),
        record("Starved Grey Ooze", readBxLine("Starved Grey Ooze", "AC 8 [11], HD 3* (13hp), Att 1 × touch (2d8), THAC0 17 [+2], MV 10' (3'), AL Neutral", [])),
        record("Glass Golem", readBxLine("Glass Golem", "AC 3 [16], HD 6** (27hp), Att 2 × fist (1d8), THAC0 14 [+5], MV 90' (30'), AL Lawful", [])),
        { key: "encounter:x", kind: "encounter", name: "Ambush", pages: [1], source: "", check: [], include: true, from: "model", data: { creatures: [{ name: "Skeletons", count: 4 }, { name: "Marsh Thing", count: 1 }] } },
      ],
    };
    const copy = structuredClone(drafted);
    settleMonsters(drafted);
    const byName = (name) => drafted.records.find((entry) => entry.name === name);
    const checks = (record) => [...record.check, ...(record.data.matchCheck ?? [])].join(" ");
    assert.equal(byName("Kobold").data.srd, "Kobold");
    assert.equal(byName("Kobold").data.stats, null, "the SRD's own kobold was copied");
    // A name that only ends in an SRD one is a suggestion, not a match.
    assert.equal(byName("Starved Grey Ooze").data.srd, undefined);
    assert.equal(byName("Starved Grey Ooze").data.nameHit, "Gray Ooze");
    assert.ok(byName("Glass Golem").data.converted);
    assert.match(checks(byName("Glass Golem")), /Converted from Old-School Essentials/);
    // The model's pick of an equivalent is taken only from the SRD's list.
    let asked = [];
    await settleNames(drafted, async (asks) => {
      asked = asks;
      return new Map(asks.map((entry) => [entry.name, entry.name === "Glass Golem" ? entry.candidates.find((name) => /golem/i.test(name)) ?? entry.candidates[0] : "Not A Real Creature"]));
    });
    const golemAsk = asked.find((entry) => entry.name === "Glass Golem");
    assert.ok(golemAsk.candidates.length > 0 && golemAsk.candidates.length <= 30, "the golem was offered the whole SRD");
    assert.equal(golemAsk.details.length, golemAsk.candidates.length, "the model was not told what each candidate is");
    assert.ok(!asked.some((entry) => entry.name === "Starved Grey Ooze"), "the model was asked about a creature its name already suggests");
    const ask = (name) => drafted.matches.find((entry) => entry.name === name);
    assert.deepEqual(drafted.matches.map((entry) => entry.name).sort(), ["Glass Golem", "Marsh Thing", "Starved Grey Ooze"]);
    assert.equal(ask("Starved Grey Ooze").suggested, "Gray Ooze");
    assert.equal(ask("Starved Grey Ooze").how, "name");
    assert.equal(ask("Glass Golem").how, "model");
    assert.ok(golemAsk.candidates.includes(ask("Glass Golem").suggested), "a pick from outside its list was taken");
    assert.notEqual(ask("Marsh Thing").suggested, "Not A Real Creature");
    assert.ok(ask("Glass Golem").options.length > 1 && ask("Glass Golem").options[0].name === ask("Glass Golem").suggested);
    assert.ok(ask("Glass Golem").own, "a converted creature's own numbers cannot be kept");
    assert.ok(!ask("Marsh Thing").own);
    // The suggestion plays in the draft, and every one waits for the GM.
    assert.equal(byName("Starved Grey Ooze").data.srd, "Gray Ooze");
    assert.equal(byName("Starved Grey Ooze").data.asSrd, true);
    assert.equal(byName("Glass Golem").data.srd, ask("Glass Golem").suggested);
    assert.ok(!checks(byName("Glass Golem")).includes("Converted from"));
    assert.equal(unconfirmed(drafted.matches), 3);
    const fight = byName("Ambush");
    assert.equal(fight.data.creatures[0].name, "Skeleton");
    // Nothing ties a bare name to an SRD creature: it waits, unmatched.
    assert.equal(ask("Marsh Thing").how, "none");
    assert.equal(fight.data.creatures[1].name, "Marsh Thing");
    // The GM keeps the golem's own numbers and gives the marsh thing none:
    // each comes back as the book had it.
    drafted.matches = chooseMatches(drafted.matches, {
      [ask("Glass Golem").key]: { srd: null, confirmed: true },
      [ask("Marsh Thing").key]: { srd: null, confirmed: true },
      [ask("Starved Grey Ooze").key]: { srd: "Gray Ooze", confirmed: true },
    });
    applyMatches(drafted);
    assert.equal(unconfirmed(drafted.matches), 0);
    assert.equal(byName("Glass Golem").data.srd, undefined);
    assert.ok(byName("Glass Golem").data.converted);
    assert.deepEqual(byName("Glass Golem").data.stats, byName("Glass Golem").data.bookStats);
    assert.match(checks(byName("Glass Golem")), /Converted from/);
    assert.equal(fight.data.creatures[1].name, "Marsh Thing");
    assert.equal(fight.data.creatures[1].asked, undefined);
    assert.match(checks(fight), /No stat block or SRD 5\.1 creature was found for Marsh Thing/);

    // Without a model, the closest guess is the suggestion: a golem among
    // the SRD's golems.
    settleMonsters(copy);
    await settleNames(copy, null);
    const guessed = copy.matches.find((entry) => entry.name === "Glass Golem");
    assert.equal(guessed.how, "guess");
    assert.match(guessed.suggested, /Golem$/);
    assert.equal(unconfirmed(copy.matches), 3);
  });

  await test("The closest guess is a creature of its kind: people are matched to people, beasts to beasts, near their challenge.", async () => {
    const { guessCreatures } = await import("../src/lib/pdf-import/match-logic.ts");
    const { srdCreatures } = await import("../src/lib/pdf-import/srd-match.ts");
    const catalog = srdCreatures();
    const top = (subject) => guessCreatures({ size: "", text: "", ...subject }, catalog, 3).map((guess) => guess.candidate);
    for (const pick of top({ name: "Poachers", type: "humanoid", size: "Medium", cr: 0.25 })) assert.equal(pick.type, "humanoid", `${pick.name} for a band of poachers`);
    for (const pick of top({ name: "Cave Lizard", type: "beast", size: "Medium", cr: 0.5 })) assert.equal(pick.type, "beast", `${pick.name} for a lizard`);
    const spider = top({ name: "Rhagodessa", type: "beast", size: "Large", cr: 1, text: "A huge spider with powerful pincers grabs its prey." });
    assert.ok(spider.some((pick) => /spider/i.test(pick.name)), `no spider among ${spider.map((pick) => pick.name).join(", ")}`);
    const dragon = top({ name: "Young Blue Wyrm", type: "dragon", size: "Large", cr: 9 });
    assert.equal(dragon[0].name, "Young Blue Dragon");
    assert.ok(dragon.every((pick) => pick.type === "dragon" && Math.abs(pick.cr - 9) <= 4), dragon.map((pick) => `${pick.name} ${pick.cr}`).join(", "));
  });
}

// ---- the job and the landing, in a scratch world ----

const owner = createUser(`importer${Date.now().toString(36)}`, "x", { isAdmin: true });

async function openImport(campaignId = null) {
  const item = pdfImports.createPdfImport({ userId: owner.id, campaignId, fileName: "sunken-mill.pdf", title: "", pageCount: reading.pageCount, outline: reading.outline });
  pdfImports.savePages(item.id, reading.fonts, reading.pages);
  for (const upload of pictures) fs.writeFileSync(path.join(pdfImports.importDir(item.id), `${upload.picture.id}.png`), gridMap());
  pdfImports.savePictures(item.id, pictures);
  return item;
}

// The GM accepts every suggested match, as "Accept the rest" does.
function confirmEvery(id) {
  const draft = pdfImports.readDraft(id);
  draft.matches = chooseMatches(draft.matches ?? [], Object.fromEntries((draft.matches ?? []).map((ask) => [ask.key, { srd: ask.current, confirmed: true }])));
  applyMatches(draft);
  pdfImports.saveDraft(id, draft);
}

async function settle(id, ms = 30_000) {
  const started = Date.now();
  for (;;) {
    const item = pdfImports.getPdfImport(id);
    if (item.state !== "working" && item.state !== "ready") return item;
    if (Date.now() - started > ms) throw new Error(`still ${item.state}: ${item.step}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

let landedWorkshop = "";
await test("The job reads the layout, then the book with the model, and the review holds people, a faction, treasure, a fight and the story.", async () => {
  const item = await openImport();
  pdfImports.setImportState(item.id, { useModel: true });
  startImportJob(item.id);
  const done = await settle(item.id);
  assert.equal(done.state, "review", done.reason);
  const review = reviewView(pdfImports.readDraft(item.id));
  const named = (kind) => review.records.filter((record) => record.kind === kind).map((record) => record.name);
  assert.ok(named("npc").includes("Mother Reed"));
  assert.ok(!named("npc").includes("a guard"));
  assert.deepEqual(named("faction"), ["The Reed Covenant"]);
  assert.deepEqual(named("item"), ["The Drowned Bell"]);
  assert.deepEqual(named("encounter"), ["Eels in the Cellar"]);
  assert.ok(named("beat").includes("Mother Reed's bargain"));
  // The chapter cards stay, the model's scenes between them in page order.
  const order = review.records.filter((record) => record.kind === "beat").map((record) => record.name);
  assert.ok(order.includes("Chapter 1: The Drowned Village"));
  assert.equal(review.modelUsed, true);
  // Every piece of the book was asked the reading prompt (the SRD 5.1
  // equivalents are a prompt of their own).
  const reads = requests.filter((request) => !request.messages[0].content.includes("System Reference Document"));
  assert.ok(reads.length > 0 && reads.every((request) => request.messages[0].content.includes("tabletop roleplaying adventure")));

  // The GM leaves the portrait out and renames the workshop.
  const art = review.records.find((record) => record.kind === "art");
  const kept = pdfImports.readDraft(item.id);
  kept.records.find((record) => record.key === art.key).include = false;
  kept.title = "Marrowford";
  pdfImports.saveDraft(item.id, kept);

  // A creature's match waits for the GM's yes: the import is refused until
  // then.
  // (Without the content pack there is no SRD to match to, and nothing to
  // confirm.)
  if (hasPack) {
    assert.ok(kept.matches.length > 0, "the model's fight brought no creature to match");
    const refused = landImport(pdfImports.getPdfImport(item.id), { id: owner.id, isAdmin: true }, "workshop");
    assert.equal(refused.status, 409);
    assert.match(refused.error, /Confirm the SRD 5\.1 match/);
    confirmEvery(item.id);
  } else assert.equal(kept.matches?.length ?? 0, 0);

  const landed = landImport(pdfImports.getPdfImport(item.id), { id: owner.id, isAdmin: true }, "workshop");
  assert.ok(landed.workshopId, landed.error);
  landedWorkshop = landed.workshopId;
  const db = getDatabase();
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE campaign_id = ?`).get(landed.workshopId).n;
  assert.equal(db.prepare("SELECT title FROM campaigns WHERE id = ?").get(landed.workshopId).title, "Marrowford");
  // The book's own words, minus what became places, creatures and tables.
  const lore = db.prepare("SELECT title, body FROM lore_entries WHERE campaign_id = ?").all(landed.workshopId);
  assert.ok(lore.some((entry) => entry.title === "Chapter 1: The Drowned Village" && /> Black water laps/.test(entry.body)));
  assert.ok(count("locations") >= 5);
  assert.equal(count("npcs"), 1);
  assert.equal(count("factions"), 1);
  assert.equal(count("prepared_maps"), 1);
  assert.equal(count("roll_tables"), 1);
  const npc = db.prepare("SELECT stat_block, trait, goals_json, personality_json FROM npcs WHERE campaign_id = ?").get(landed.workshopId);
  assert.equal(npc.stat_block, "Bog Hag");
  assert.match(npc.trait, /cloak of river weed/);
  assert.equal(JSON.parse(npc.goals_json).ambition, "To ring the bell and call back the drowned.");
  assert.ok(listHomebrewMonsters(owner.id).some((monster) => monster.draft.name === "Bog Hag"), "the stat block did not reach the shelf");
  const map = db.prepare("SELECT backdrop_path FROM prepared_maps WHERE campaign_id = ?").get(landed.workshopId);
  assert.match(map.backdrop_path, /^\/uploads\//);
  const { doc } = worldView(landed.workshopId);
  assert.ok(doc.links.some((link) => link.label === "member of"));
  assert.ok(doc.secrets.some((secret) => secret.title === "Who drowned the village"));
  // The import lets its pages and pictures go once it has landed.
  const after = pdfImports.getPdfImport(item.id);
  assert.equal(after.state, "imported");
  assert.equal(after.pagesReceived, 0);
  assert.ok(!fs.existsSync(pdfImports.importDir(item.id)));
});

await test("A book's workshop stays private: marked, and the mark rides Duplicate and a bundle file.", () => {
  assert.match(privateSourceOf(landedWorkshop), /sunken-mill\.pdf/);
  const copy = cloneCampaign(owner.id, landedWorkshop);
  assert.ok(copy.campaign, copy.error);
  assert.equal(privateSourceOf(copy.campaign.id), privateSourceOf(landedWorkshop));
  const exported = exportWorkshopBundle(landedWorkshop, { name: "Marrowford", blurb: "x", inspiredBy: "x" });
  assert.ok(exported.bundle, exported.error);
  assert.equal(exported.bundle.privateSource, privateSourceOf(landedWorkshop));
  const read = readBundle(JSON.stringify(exported.bundle));
  const again = importWorkshopBundle(owner.id, read.bundle, { isAdmin: true });
  assert.ok(again.workshopId, again.error);
  assert.equal(privateSourceOf(again.workshopId), privateSourceOf(landedWorkshop));
});

await test("Begun in WorldForge, the book's people, places, factions, lore, ties and scenes land in that world, its creatures on the shelf.", async () => {
  const workshop = createWorkshop(owner.id, { title: "The River Lands" });
  const item = await openImport(workshop.id);
  pdfImports.setImportState(item.id, { useModel: true });
  startImportJob(item.id);
  assert.equal((await settle(item.id)).state, "review");
  confirmEvery(item.id);
  const landed = landImport(pdfImports.getPdfImport(item.id), { id: owner.id, isAdmin: true }, "world");
  assert.equal(landed.workshopId, workshop.id, landed.error);
  const names = worldView(workshop.id).entities.map((entity) => entity.name);
  for (const name of ["Mother Reed", "The Reed Covenant", "Marrowford", "1. Waterwheel"]) assert.ok(names.includes(name), `${name} is not in the world`);
  const reed = worldView(workshop.id).entities.find((entity) => entity.name === "Mother Reed");
  assert.match(reed.entry.hiddenTruth, /drowned the lower village/);
  assert.ok(privateSourceOf(workshop.id));
});

await test("A job the server was running when it stopped picks up where it was, asking the model only for the pieces it had not answered.", async () => {
  const item = await openImport();
  pdfImports.setImportState(item.id, { useModel: true, state: "working", boot: "an-earlier-process" });
  // The first piece's answer, kept under what the piece holds.
  const first = chunksOf(buildDraft(reading, []).sections, chunkChars(16_384))[0];
  pdfImports.saveModelAnswers(item.id, { [answerKey(first)]: { npcs: [], places: [], factions: [], items: [], encounters: [], scenes: [], secrets: [], links: [] } });
  const before = requests.length;
  resumeIfStranded(pdfImports.getPdfImport(item.id));
  assert.equal((await settle(item.id)).state, "review");
  const pieces = chunksOf(pdfImports.readDraft(item.id).sections, chunkChars(16_384)).length;
  assert.equal(requests.length - before, Math.max(0, pieces - 1));
  pdfImports.deletePdfImport(item.id);
});

await test("A model that cannot be reached leaves the import with what the layout gives, and says so.", async () => {
  failing = true;
  try {
    const item = await openImport();
    pdfImports.setImportState(item.id, { useModel: true });
    startImportJob(item.id);
    const done = await settle(item.id);
    assert.equal(done.state, "review");
    const review = reviewView(pdfImports.readDraft(item.id));
    assert.ok(review.records.some((record) => record.kind === "monster"));
    assert.match(review.modelNote, /could not read/);
    pdfImports.deletePdfImport(item.id);
  } finally {
    failing = false;
  }
});

await test("Stale imports and folders left by a deleted account are swept by the daily tidy.", async () => {
  const item = await openImport();
  getDatabase().prepare("UPDATE pdf_imports SET updated_at = ? WHERE id = ?").run(new Date(Date.now() - pdfImports.STALE_IMPORT_MS - 60_000).toISOString(), item.id);
  const orphan = path.join(pdfImports.importsDir(), crypto.randomUUID());
  fs.mkdirSync(orphan, { recursive: true });
  assert.ok(pdfImports.sweepPdfImports() >= 2);
  assert.equal(pdfImports.getPdfImport(item.id), null);
  assert.ok(!fs.existsSync(orphan));
});

await test("An older host that does not offer the import hides it; a host not yet heard from offers it.", () => {
  assert.equal(hostOffers({ story: { configured: true }, features: {} }, "pdfImport"), false);
  assert.equal(hostOffers({ story: { configured: true }, features: { pdfImport: true } }, "pdfImport"), true);
  assert.equal(hostOffers(null, "pdfImport"), true);
});

await test("The binder reads a rules PDF's words as the page read them, not the server's glyph codes.", async () => {
  const pageWords = blocks.map((block) => text(block)).join("\n\n");
  const written = await writeUploadedPdf(book, pageWords);
  assert.equal(await readUploadedPdfText(written.url), pageWords);
  const entry = insertLoreEntry({ campaignId: world.campaignId, category: "other", title: "The Sunken Mill", body: "The book.", tags: ["rules"], attachmentPath: written.url });
  const chunks = await ingestLoreAttachment(getLoreEntry(entry.id));
  assert.ok(chunks > 0);
  const stored = getDatabase().prepare("SELECT text FROM rule_chunks WHERE campaign_id = ? AND source = ?").all(world.campaignId, entry.id).map((row) => row.text).join(" ");
  assert.match(stored, /Mother Reed/);
});

await test("A rules PDF copied from a workshop to a table is read for that table, not left without passages.", async () => {
  const source = createWorkshop(owner.id, { title: "Rules shelf" });
  const written = await writeUploadedPdf(book, "Marrowford's bell is rung under water.");
  insertLoreEntry({ campaignId: source.id, category: "other", title: "House book", body: "A book.", tags: ["rules"], attachmentPath: written.url });
  const target = createWorkshop(owner.id, { title: "Table" });
  const outcome = runContentImport({ sourceId: source.id, campaignId: target.id, selection: ["lore"], houseRulesMode: "append" });
  assert.ok(!outcome.error, outcome.error);
  const started = Date.now();
  let stored = "";
  while (!stored && Date.now() - started < 5_000) {
    stored = getDatabase().prepare("SELECT GROUP_CONCAT(text, ' ') AS t FROM rule_chunks WHERE campaign_id = ?").get(target.id).t ?? "";
    if (!stored) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.match(stored, /rung under water/);
});

await test("A piece the model failed is asked again when the book is read again, and only the pieces still missing are.", async () => {
  failing = true;
  const item = await openImport();
  try {
    pdfImports.setImportState(item.id, { useModel: true });
    startImportJob(item.id);
    assert.equal((await settle(item.id)).state, "review");
    assert.ok(reviewView(pdfImports.readDraft(item.id)).modelFailed > 0, "the review does not offer to read the missed pieces again");
  } finally {
    failing = false;
  }
  // "Read the missed pieces again" (the route's start from review).
  getDatabase().prepare("UPDATE pdf_imports SET draft_blob = NULL WHERE id = ?").run(item.id);
  pdfImports.setImportState(item.id, { state: "ready", useModel: true, done: 0, total: 0 });
  const before = requests.length;
  startImportJob(item.id);
  assert.equal((await settle(item.id)).state, "review");
  const draft = pdfImports.readDraft(item.id);
  assert.equal(draft.model.used, true);
  assert.equal(draft.model.failed, 0);
  const pieces = chunksOf(draft.sections, chunkChars(16_384)).length;
  assert.ok(requests.length - before >= pieces, "a failed piece was not asked again");
  // A third reading asks nothing: every piece has its answer.
  getDatabase().prepare("UPDATE pdf_imports SET draft_blob = NULL WHERE id = ?").run(item.id);
  pdfImports.setImportState(item.id, { state: "ready", useModel: true, done: 0, total: 0 });
  const again = requests.length;
  startImportJob(item.id);
  await settle(item.id);
  assert.equal(requests.filter((_, index) => index >= again && !String(requests[index].messages?.[0]?.content ?? "").includes("System Reference Document")).length, 0);
  pdfImports.deletePdfImport(item.id);
});

await test("A WorldForge file of a book's workshop carries its mark, and a world read back from it is marked.", () => {
  const file = exportWorldForge(landedWorkshop);
  assert.equal(file.odmPrivateSource, privateSourceOf(landedWorkshop));
  const blank = createWorkshop(owner.id, { title: "Somewhere else" });
  const result = importWorldForge(blank.id, { id: owner.id, isAdmin: true }, JSON.parse(JSON.stringify(file)));
  assert.ok(!("error" in result), result.error);
  assert.equal(privateSourceOf(blank.id), privateSourceOf(landedWorkshop));
});

await test("A book's creatures on the shelf carry its mark: a bundle of any other workshop that takes them along is marked.", () => {
  const shelf = listHomebrewMonsters(owner.id);
  assert.ok(privateSourceOfEntries(shelf.map((monster) => monster.id)), "no shelf creature from the book is marked");
  const other = createWorkshop(owner.id, { title: "My own adventure" });
  assert.equal(privateSourceOf(other.id), "");
  const exported = exportWorkshopBundle(other.id, { name: "Mine", blurb: "x", inspiredBy: "x", shelf: "all" });
  assert.ok(exported.bundle, exported.error);
  assert.ok(exported.bundle.monsters.length > 0, "the shelf took no creature along");
  assert.ok(exported.bundle.privateSource, "a bundle carrying the book's creatures is unmarked");
});

await test("An account's unfinished imports are held to their room on disk, and a page sent twice counts once.", async () => {
  assert.equal(pdfImports.pendingImportRefusal(owner.id, pdfImports.MAX_PENDING_IMPORT_BYTES + 1)?.status, 413);
  assert.equal(pdfImports.pendingImportRefusal(owner.id, 1), null);
  const item = await openImport();
  const page = reading.pages[0];
  const once = pdfImports.importRuns(item.id);
  pdfImports.savePages(item.id, reading.fonts, [page]);
  assert.equal(pdfImports.importRuns(item.id), once);
  assert.equal(pdfImports.importRuns(item.id, [page.n]), once - page.runs.length);
  pdfImports.deletePdfImport(item.id);
});

await test("Leaving a creature out keeps it for the fights and people that use it; one that cannot be played is kept as the GM's lore.", () => {
  const draft = structuredClone(buildDraft(reading, []));
  const monster = draft.records.find((record) => record.kind === "monster");
  monster.include = false;
  draft.records.push({ key: "encounter:x", kind: "encounter", name: "At the wheel", pages: [1], source: "", check: [], include: true, from: "model", data: { creatures: [{ name: monster.name, count: 2 }] } });
  assert.ok(takenRecords(draft).includes(monster));
  draft.records.find((record) => record.key === "encounter:x").include = false;
  assert.ok(!takenRecords(draft).includes(monster));
  monster.include = true;
  monster.data.stats = null;
  delete monster.data.srd;
  const bundle = draftToBundle(draft, "sunken-mill.pdf", () => "");
  assert.ok(bundle.lore.some((entry) => entry.title === `Stat block: ${monster.name}` && entry.body.length > 20));
  assert.ok(!bundle.monsters.some((entry) => entry.name === monster.name));
});

await test("A rules PDF's reading is the uploader's; one given later is that campaign's alone, and all go with the PDF.", async () => {
  const written = await writeUploadedPdf(book, "The uploader's words.");
  const mine = createWorkshop(owner.id, { title: "Mine" });
  const theirs = createWorkshop(owner.id, { title: "Theirs" });
  await writeUploadedPdfText(written.url, "Someone else's words.", theirs.id);
  assert.equal(await readUploadedPdfText(written.url, mine.id), "The uploader's words.");
  assert.equal(await readUploadedPdfText(written.url, theirs.id), "Someone else's words.");
  assert.equal(await writeUploadedPdfText(written.url, "x", "../../etc"), false);
  assert.equal(pdfTextFilesOf(written.url).length, 2);
  removeFile(written.url);
  assert.equal(pdfTextFilesOf(written.url).length, 0);
});

await test("A workshop that fights with a book's creature from the shelf is refused as a pack or plugin, as the book's own workshop is.", () => {
  const book = listHomebrewMonsters(owner.id).find((monster) => privateSourceOfEntries([monster.id]));
  assert.ok(book, "no book creature on the shelf");
  const mine = createWorkshop(owner.id, { title: "Borrowing a creature" });
  assert.equal(workshopPrivateSource(mine.id), "");
  const npc = upsertNpc({ campaignId: mine.id, name: "Borrowed Bruiser" });
  getDatabase().prepare("UPDATE npcs SET stat_block = ? WHERE id = ?").run(`homebrew:${book.id}`, npc.id);
  assert.ok(workshopPrivateSource(mine.id), "a workshop using a book's creature reads as unmarked");
});

await test("A person read with their own stat block keeps it; a creature matched in the review fights as the SRD's, not the book's of that name.", async () => {
  const { settleNames } = await import("../src/lib/pdf-import/matches.ts");
  const monster = (key, name) => ({ key, kind: "monster", name, pages: [1], source: "", check: [], include: true, from: "book", data: { stats: { ac: 13, maxHp: 30, cr: 2 } } });
  const draft = {
    title: "x", premise: "", party: null, system: "5e", sections: [],
    records: [
      monster("monster:captain-varek", "Captain Varek"),
      monster("monster:ogre", "Ogre"),
      { key: "npc:varek", kind: "npc", name: "Captain Varek", pages: [1], source: "", check: [], include: true, from: "book", data: { statBlock: "monster:captain-varek" } },
      { key: "encounter:x", kind: "encounter", name: "At the gate", pages: [1], source: "", check: [], include: true, from: "model", data: { creatures: [{ name: "Ogre Brute", count: 1 }] } },
    ],
  };
  await settleNames(draft, null);
  assert.ok(!(draft.matches ?? []).some((ask) => ask.name.startsWith("monster:")), "a record key was put to the GM as a name");
  assert.equal(draft.records.find((record) => record.key === "npc:varek").data.statBlock, "monster:captain-varek");
  if (hasPack) {
    const brute = draft.matches.find((ask) => ask.name === "Ogre Brute");
    draft.matches = chooseMatches(draft.matches, { [brute.key]: { srd: "Ogre", confirmed: true } });
    applyMatches(draft);
    const bundle = draftToBundle(draft, "x.pdf", () => "");
    assert.deepEqual(bundle.encounters[0].enemies, [{ monster: "Ogre", count: 1 }], "the fight took the book's own Ogre");
    // Left out with nothing that uses it, a match waits for nobody.
    const { unconfirmed } = await import("../src/lib/pdf-import/match-logic.ts");
    draft.matches = draft.matches.map((ask) => ({ ...ask, confirmed: false }));
    draft.records.find((record) => record.key === "encounter:x").include = false;
    const taken = new Set(takenRecords(draft).map((record) => record.key));
    assert.equal(unconfirmed(draft.matches, (key) => taken.has(key)), 0);
  }
});

await test("A placeholder the model writes for a name (\"None\", \"N/A\") makes no record.", () => {
  const found = readChunkReply(JSON.stringify({ npcs: [{ name: "None", role: "x" }, { name: "Mother Reed", role: "hag" }], factions: [{ name: "N/A", goal: "x" }], places: [{ name: "unknown", description: "x" }] }));
  assert.deepEqual(found.npcs.map((npc) => npc.name), ["Mother Reed"]);
  assert.equal(found.factions.length, 0);
  assert.equal(found.places.length, 0);
});

if (hasPack) {
  await test("Items find their SRD 5.1 entry: a bonus on a ring is the ring, a bonus on a sword the +N weapon, gear the SRD's gear.", async () => {
    const { matchItem, matchCreature } = await import("../src/lib/pdf-import/srd-match.ts");
    const item = (name) => matchItem(name)?.entry.name ?? null;
    assert.equal(item("Ring of Protection +1"), "Ring of Protection");
    // The SRD's ring gives +1: a +2 one is the book's own.
    assert.equal(item("Ring of Protection +2"), null);
    assert.equal(item("Holy Avenger +1"), null);
    assert.equal(item("Scroll of the Ancients"), null);
    // One of a family: named, but the book's own item stays.
    assert.equal(matchItem("+3 Dagger")?.via, "family");
    assert.equal(matchItem("Scroll of Fireball")?.via, "family");
    const { settleItemsAndSpells } = await import("../src/lib/pdf-import/equivalents.ts");
    const items = { records: [{ key: "item:d", kind: "item", name: "+3 Dagger", pages: [1], source: "", check: [], include: true, from: "model", data: { kind: "magic_item", description: "A dagger." } }] };
    settleItemsAndSpells(items);
    settleItemsAndSpells(items);
    assert.equal(items.records[0].data.srdFamily, "Weapon, +1, +2, or +3");
    assert.equal(items.records[0].check.length, 1, "a second pass repeated its note");
    assert.equal(item("Wand of the War Mage +2"), "Wand of the War Mage, +1, +2, or +3");
    assert.equal(item("+1 Longsword"), "Weapon, +1, +2, or +3");
    assert.equal(item("Amulet +2"), null);
    assert.equal(item("Plate Armor"), "Plate");
    assert.equal(item("Chain Mail"), "Chain mail");
    assert.equal(item("Potion of Fire Giant Strength"), "Potion of Giant Strength");
    assert.equal(item("Scroll of Fireball"), "Spell Scroll");
    assert.equal(item("Bracers of Defence"), "Bracers of Defense");
    assert.equal(item("Luckstone"), "Stone of Good Luck (Luckstone)");
    assert.equal(item("Mage Armor"), null);
    assert.equal(matchCreature("Succubus")?.entry.name, "Succubus/Incubus");
    assert.equal(matchCreature("Svirfneblin")?.entry.name, "Deep Gnome (Svirfneblin)");
    assert.equal(matchCreature("Diseased"), null);
  });
}

server.close();
world.close?.();
finish();
