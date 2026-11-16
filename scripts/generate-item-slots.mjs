// Reads the Open5e content pack's items into src/lib/classes/item-slots.json:
// where on the body each wearable one goes (issue 412; SRD 5.1, Magic Items,
// Wearing and Wielding Items: "boots go on the feet, gloves on the hands,
// hats and helmets on the head, and rings on the finger"). The engines look
// an item up by its whole name (src/lib/srd/wear-slots.ts), never by words
// read inside a name someone wrote, so the place is read here, once, from
// the English rows' names and categories, and from a row's own rules text
// where its name does not say what it is: Wings of Flying is a cloak ("While
// wearing this cloak, you can use an action to speak its command word"), and
// before the text was read it had no place, so it counted beside a second
// cloak.
//
// Armor and shields are left out: the armor engine (src/lib/srd/armor.ts)
// already knows a suit from a shield. So is anything carried rather than
// worn (a Belt Pouch is a pouch, a Wand of Webs is held).
//
// Like the magic-item generator, the OUTPUT IS COMMITTED and loaded at
// runtime (the sheet reads it in the browser, which has no content DB). Run
// by hand when the content pack changes:
//
//   node scripts/generate-item-slots.mjs          # write the file
//   node scripts/generate-item-slots.mjs --check  # fail if stale
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3-multiple-ciphers";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contentDb = join(root, "data", "content", "open5e.sqlite");
const outPath = join(root, "src", "lib", "classes", "item-slots.json");

// The SRD's kinds of worn item, checked in order: the first a name holds
// wins ("Cloak of the Bat" is a cloak whatever else it says).
const SLOT_WORDS = [
  ["cloak", "cloaks?|capes?|mantles?"],
  ["head", "helms?|helmets?|hats?|caps?|circlets?|crowns?|diadems?|headbands?|tiaras?|hoods?|coronets?|headdress"],
  ["feet", "boots|slippers|sandals|shoes|footwear"],
  ["hands", "gloves?|gauntlets?"],
  ["wrists", "bracers?|vambraces?"],
  ["neck", "amulets?|necklaces?|periapts?|medallions?|pendants?|torcs?|brooch(?:es)?"],
  ["waist", "belts?|girdles?"],
  ["ring", "rings?"],
  ["eyes", "goggles|lenses|spectacles|glasses"],
  ["robe", "robes?"],
];
// A word that owns the next one names someone else, not the item:
// "Culdarath the Ninth Ring's True Name" is a slip of parchment.
const NAME_WORDS = SLOT_WORDS.map(([slot, words]) => [slot, new RegExp(`\\b(?:${words})\\b(?!['’]s\\b)${slot === "eyes" ? "|^eyes of\\b" : ""}`, "i")]);

// Held or carried, never worn, whatever else the name says.
const CARRIED = /\b(?:wand|rod|staff|potion|philter|elixir|scroll|oil|dust|ammunition|arrows?|bolts?|bag|pouch|deck|figurine|horn|pipes|drum|lute|harp|candle|orb|stone|feather token|bead)\b/i;

// Suits, shields and weapons are the armor and weapon engines' own.
const NOT_WORN_HERE = /armor|shield|weapon/i;

// What the rules text calls the thing its wearer has on, for a row whose
// name does not say. Only the text's own words for wearing it count: "while
// wearing this cloak" (Wings of Flying), "while you wear these gauntlets", or
// the thing named in the opening sentence and worn as "it" or "them" after
// ("this cap has 9 charges ... while wearing it"). A word that only
// describes the next one is not the thing (a belt pouch, a belt quiver, a
// belt buckle), and neither is what the wearer has on beside it ("if you are
// wearing armor").
const ANY_WORD = SLOT_WORDS.map(([, words]) => words).join("|");
const ITS_KIND = `(?:(?!(?:as|or|and|a|an|of|in|on|with|to|from|is|are|that|which|it|its|you|your)\\b)[\\w'’,-]+\\s+){0,4}?(${ANY_WORD})\\b(?!\\s+(?:pouch|quiver|buckle|clasp|pin|case)\\b)`;
const WORN_AS = new RegExp(`\\b(?:wear|wears|wearing|worn)\\s+(?:and\\s+attuned\\s+to\\s+)?(?:this|these|the)\\s+${ITS_KIND}`, "i");
const NAMED_FIRST = new RegExp(`\\b(?:this|these)\\s+${ITS_KIND}`, "i");
const WORN_AFTER = /\b(?:wear|wears|wearing)\s+(?:it|them)\b/i;
const placeOfWord = (word) => SLOT_WORDS.find(([, words]) => new RegExp(`^(?:${words})$`, "i").test(word))?.[0] ?? null;

export function slotInText(text) {
  const body = String(text ?? "");
  const worn = body.match(WORN_AS);
  if (worn) {
    return placeOfWord(worn[1]);
  }
  const opening = body.split(/(?<=[.!?])\s/)[0] ?? "";
  const named = WORN_AFTER.test(body) ? opening.match(NAMED_FIRST) : null;
  return named ? placeOfWord(named[1]) : null;
}

export function slotOf(name, kind, category, text) {
  if (kind === "armor" || kind === "weapon" || NOT_WORN_HERE.test(category ?? "")) {
    return null;
  }
  if ((category ?? "").toLowerCase() === "ring") {
    return "ring";
  }
  // The text speaks last, and over a carried word in the name: a Potion Belt
  // is a belt ("While wearing the belt, you can use an action...").
  // A carried word counts where it is the thing, not what the thing is of:
  // a Belt of Stone Giant Strength is a belt, a Belt Pouch a pouch.
  const named = CARRIED.test(name.split(/\s+of\s+/i)[0]) ? null :(NAME_WORDS.find(([, words]) => words.test(name))?.[0] ?? null);
  return named ?? slotInText(text);
}

if (!existsSync(contentDb)) {
  console.error(`content DB not found at ${contentDb}; cannot generate.`);
  process.exit(1);
}

const db = new Database(contentDb, { readonly: true });
const rows = db
  .prepare("SELECT name, kind, category, data_json FROM items ORDER BY name")
  .all()
  .map((row) => ({ name: row.name, kind: row.kind, category: row.category, text: JSON.parse(row.data_json).desc }));
db.close();
// The magic-item table's own rows too (scripts/generate-magic-items.mjs): it
// splits a pack row into the variants the engines read ("Belt of Hill Giant
// Strength"). A row with a base weapon or suit is the armor engine's.
const magic = JSON.parse(readFileSync(join(root, "src", "lib", "classes", "magic-items.json"), "utf8")).items;
for (const item of magic) {
  rows.push({ name: item.name, kind: item.base ? item.base.kind : "magic_item", category: "" });
}
rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

const slots = {};
for (const [slot] of SLOT_WORDS) {
  slots[slot] = [];
}
const seen = new Set();
for (const row of rows) {
  const slot = slotOf(row.name, row.kind, row.category, row.text);
  const key = row.name.trim().toLowerCase();
  if (!slot || seen.has(key)) {
    continue;
  }
  seen.add(key);
  slots[slot].push(row.name.trim());
}

const generated = {
  _note:
    "GENERATED by scripts/generate-item-slots.mjs from the Open5e content DB: where each wearable item goes on the body, by its whole name. Do not edit by hand; re-run the script instead.",
  slots,
};
const serialized = `${JSON.stringify(generated, null, 2)}\n`;
const count = Object.values(slots).reduce((sum, names) => sum + names.length, 0);

if (process.argv.includes("--check")) {
  // Compare on content, not line endings (a Windows checkout's CRLF copy).
  const current = existsSync(outPath) ? readFileSync(outPath, "utf8").replace(/\r\n/g, "\n") : "";
  if (current !== serialized) {
    console.error("item-slots.json is stale; re-run node scripts/generate-item-slots.mjs");
    process.exit(1);
  }
  console.log(`item-slots.json is current (${count} items).`);
} else {
  writeFileSync(outPath, serialized);
  console.log(`Wrote ${count} wearable items to src/lib/classes/item-slots.json`);
}
