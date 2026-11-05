// What a content pack item is, read from its English name and its category,
// for src/lib/classes/item-tags.json (scripts/generate-item-tags.mjs). These
// are the rules the engines applied to any name written on a sheet; read
// once here over the pack's own English names, the engines read the tags the
// table gives each row (src/lib/srd/item-tags.ts) and never the words of a
// name someone wrote, which are the table's language.

// Used up when used: a potion, a scroll, food, a torch, a flask thrown, a
// pinch of dust. They win over the durable words, so an Oil of Sharpness or
// a Scroll of Fireball counts down and a Necklace of Fireballs does not.
const CONSUMABLE = /\b(potions?|scrolls?|oils?|elixirs?|philters?|draughts?|vials?|flasks?|rations?|food|water|waterskin|torch(?:es)?|candles?|antitoxin|acid|alchemist'?s? fire|holy water|ball bearings|caltrops|chalk|incense|dust|beads?|pills?|salves?|ointments?|herbs?|berry|berries|bread|meat|ale|wine|arrows?|bolts?|bullets?|needles?|darts?|javelins?|daggers?|tinderbox|matches|smoke|grenade|bomb)\b/i;
// Worn, wielded or kept, never used up: a wand spends charges, a Bag of
// Holding holds things, a ring is worn.
const DURABLE = /\b(cases?|tubes?|quivers?|wands?|staffs?|staves|rods?|rings?|amulets?|cloaks?|capes?|mantles?|robes?|boots|slippers|bags?|belts?|bracers|gauntlets|gloves|helms?|circlets?|headbands?|crowns?|orbs?|figurines?|decks?|horns?|lanterns?|lamps?|mirrors?|necklaces?|periapts?|medallions?|brooches?|pipes|carpets?|brooms?|instruments?|lyres?|drums?|books?|tomes?|manuals?|stones?|gems?|cubes?|spheres?|chimes?|goggles|lenses|eyes of|cap of|hat of|portable hole|rope of|apparatus|armou?r|shields?)\b/i;
// Kept though their names hold a consumable's word: a waterskin is drunk
// from and refilled, a Necklace of Prayer Beads keeps its beads.
// SRD 5.1 Adventuring Gear used again and again, never used up: manacles
// bind, a hunting trap is set and reset, a climber's kit anchors its user
// (issue #570, EQP-23: use_item deleted them), and the tools that work the
// same way.
const DURABLE_GEAR = /\b(manacles|hunting traps?|climber'?s kits?|block and tackle|crowbars?|grappling hooks?|spyglass(?:es)?|magnifying glass(?:es)?|hourglass(?:es)?|ram, portable|portable rams?|shovels?|pick, miner'?s|miner'?s picks?|ladders?|poles?)\b/i;
const KEPT = /\b(water ?skins?|canteens?|necklaces?|prayer beads)\b/i;
// Used up though their names hold a durable word (SRD 5.1, Magic Items,
// Consumables: "Some items are used up when they are activated"): a Necklace
// of Fireballs' beads are thrown and detonate, its charges counting them
// (scripts/lib/magic-item-riders.mjs), and an Elemental Gem is broken to
// summon its elemental, "and the gem's magic is lost".
const USED_UP = /\b(necklace of fireballs|elemental gem)\b/i;
const HEALING = { vessel: /potion|vial|elixir|flask|draught|philter/i, heals: /heal|life|cure/i, not: /vitality|elixir of health/i };
// Lamp oil, never a magic oil: an Oil of Sharpness is not burned in a lantern.
const LAMP_OIL = /\boil\b(?!\s+of\b)/i;
const FOCI = [
  ["arcane_focus", /arcane focus|\bcrystal\b|\borb\b|\brod\b|\bstaff\b|\bwand\b/i],
  ["holy_symbol", /holy symbol|\bamulet\b|\bemblem\b|\breliquary\b/i],
  ["druidic_focus", /druidic focus|mistletoe|\btotem\b|yew wand|wooden staff|\bstaff\b/i],
  ["instrument", /\blute\b|\blyre\b|\bflute\b|\bdrum\b|\bhorn\b|bagpipes|dulcimer|shawm|\bviol\b|instrument/i],
  ["tools", /thieves'? tools|artisan'?s? tools|\btools\b|infused/i],
];
const AMMO = [
  ["arrows", /\barrows?\b/i],
  ["bolts", /\b(bolts?|quarrels?)\b/i],
  ["bullets", /\b(bullets?|cartridges?|shot)\b/i],
  ["needles", /\bneedles?\b/i],
];
const GEMS =
  /\b(gem|gems|gemstone|jewel|jewels|jewelry|jewellery|ruby|rubies|sapphire|emerald|diamond|pearl|opal|topaz|garnet|amethyst|jade|jasper|onyx|agate|quartz|citrine|carnelian|chrysoberyl|chrysoprase|chalcedony|coral|jet|tourmaline|zircon|spinel|peridot|obsidian|bloodstone|moonstone|alexandrite|aquamarine|azurite|hematite|lapis lazuli|malachite|turquoise|tiger eye|sardonyx|jacinth|sard)\b/i;
const ART =
  /\b(art object|statuette|idol|chalice|goblet|necklace|bracelet|brooch|circlet|crown|tiara|scepter|sceptre|tapestry|painting|figurine of gold|gold ring|silver ring|anklet|locket|mask of gold|icon)\b/i;
const TRADE_GOODS =
  /\b(ingot|bar of (?:gold|silver|platinum|iron|copper)|(?:gold|silver|platinum) bars?|trade goods?|bolt of (?:silk|linen|cloth|canvas)|pound of (?:saffron|cinnamon|pepper|cloves|ginger|salt)|lb\.? of (?:saffron|cinnamon|pepper|cloves|ginger|salt|silk|iron|copper|silver|gold|platinum))\b/i;
// Held or carried, never worn (the sheet's wear toggle).
const CARRIED_ONLY = /\b(wand|rod|staff|potion|philter|elixir|scroll|oil|dust|ammunition|arrows?|bolts?|bag|pouch|deck|figurine|horn|pipes|drum|lute|harp|candle|orb|stone|feather token|bead)\b/i;

// A magic item's category, where the pack gives it, says what the name may
// not ("Philter of Love" is a potion, "Wand of Wonder" a wand). Gear's
// categories are the pack's shelving, not what a thing is (a Torch is filed
// under weapons, a map case under scrolls), so they are not read.
const MAGIC_CATEGORY = {
  potion: ["consumable", "potion", "carried"],
  scroll: ["consumable", "scroll", "carried"],
  wand: ["durable", "wand", "carried"],
  rod: ["durable", "rod", "carried"],
  staff: ["durable", "staff", "carried"],
  ring: ["durable"],
  ammunition: ["consumable", "carried"],
  "weapon (arrow)": ["consumable", "arrows", "carried"],
};

// The tags of one pack row, from its English name, its kind and its
// category.
export function tagsOfPackItem(name, kind, category) {
  const magic = kind === "magic_item";
  const tags = new Set(magic ? (MAGIC_CATEGORY[category] ?? []) : []);
  const add = (tag, when) => when && tags.add(tag);
  const usedUp = USED_UP.test(name);
  const kept = KEPT.test(name) && !usedUp;
  add("kept", kept);
  // A container is kept whatever it holds (a map or scroll case, a quiver).
  add("consumable", usedUp || (!kept && !tags.has("durable") && CONSUMABLE.test(name) && !/\b(wand|staff|rod|ring|case|tube|quiver)\b/i.test(name)));
  add("durable", !kept && !tags.has("consumable") && (DURABLE.test(name) || (!magic && DURABLE_GEAR.test(name))));
  add("potion", /\b(potion|elixir|philter)\b/i.test(name));
  add("healing_potion", HEALING.vessel.test(name) && HEALING.heals.test(name) && !HEALING.not.test(name));
  // A scroll, never a scroll's case (the pack files the map case under
  // scrolls).
  add("scroll", (magic && category === "scroll") || /\b(spell scroll|scroll of)\b/i.test(name));
  add("food", /\b(ration|rations|trail ?rations?|iron rations?|food)\b/i.test(name));
  // Drinking water: never holy water, nor a magic item's water (Water
  // Breathing, Water Walking).
  add("water", !magic && !/holy water/i.test(name) && /\bwater ?skin\b|\bcanteen\b|\bflask of water\b|\bwater\b/i.test(name));
  add("everburning_light", /everburning|sunrod|glowstone/i.test(name));
  add("bullseye_lantern", /bullseye lantern|lantern, bullseye/i.test(name));
  add("lantern", /lantern/i.test(name) && !/bullseye/i.test(name));
  add("torch", /torch/i.test(name));
  add("candle", /candle/i.test(name));
  // The SRD's lamp (light-timers.ts): an oil lamp, never a magic lamp.
  add("lamp", !magic && /^lamps?$/i.test(name));
  add("lamp_oil", !magic && LAMP_OIL.test(name));
  add("cold_weather_gear", /cold[- ]weather gear|winter (?:clothes|clothing|gear)|fur cloak/i.test(name));
  add("heavy_clothing", /heavy clothing/i.test(name));
  add("component_pouch", /component pouch/i.test(name));
  for (const [tag, pattern] of FOCI) {
    add(tag, pattern.test(name));
  }
  add("wand", /\bwand\b/i.test(name));
  add("staff", /\bstaff\b/i.test(name));
  add("rod", /\brod\b/i.test(name));
  // Ammunition by the weapon that fires it, for rows that are ammunition (a
  // Wand of Lightning Bolts is not crossbow bolts).
  const ammunition = /ammunition|arrow/.test(category) || (magic && category === "weapon");
  for (const [tag, pattern] of AMMO) {
    add(tag, ammunition && pattern.test(name));
  }
  add("silvered", /\bsilvered\b/i.test(name));
  add("adamantine", /\badamantine\b/i.test(name));
  // Treasure keeps its value; a magic item never is treasure by its
  // material (a Gem of Seeing, a Necklace of Fireballs).
  if (!magic) {
    add("gem", GEMS.test(name));
    add("art_object", ART.test(name));
    add("trade_good", TRADE_GOODS.test(name) || category === "trade good");
  }
  add("carried", CARRIED_ONLY.test(name));
  return [...tags];
}

// ---- a magic item no word of its name places ----
//
// A Prayer Mat, an Apron of the Eager Artisan or a Bow of Accuracy has no word
// in its name that says whether it is kept or used up, and use_item took any
// such item out of the pack as if drunk (src/lib/dm/item-logic.ts). SRD 5.1,
// Magic Items, Consumables: "Some items are used up when they are
// activated"; the rest are kept. So an item nothing above places is read from
// its own text: used up when the text says using it uses it up (it "is
// destroyed", "crumbles", "for one use", eaten or drunk, shattering on
// impact, ammunition spent by the shot), kept otherwise.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// The nouns the item's own text calls it by: the last word of its name
// before any "of" ("Air Seed", "Feather Token", "Iron Bands of Binding"), in
// the singular and the plural.
function headNouns(name) {
  const before = name.toLowerCase().replace(/[’']s\b/g, "").split(/\s+of\s+/)[0];
  const heads = before.split(/\s+(?:and|&)\s+/).map((part) => part.split(/[^a-z]+/).filter(Boolean).pop()).filter((w) => w && w.length >= 3);
  return [...new Set(heads.flatMap((w) => [w, w.replace(/(?:es|s)$/, "")]).filter((w) => w.length >= 3))];
}
const SPENT = "(?:(?:is|are) (?:then |also |immediately |instantly |permanently |completely |irrevocably )?(?:destroyed|consumed|used up|expended|absorbed)|crumbles?|vanish(?:es)?|disappears?|disintegrates?|dissolves?|shatters?|evaporates?|melts? away|burns? (?:away|up)|turns? (?:in)?to (?:dust|ash(?:es)?|powder)|loses (?:all )?(?:of )?(?:its )?magic(?:al properties)?|becomes? (?:a )?(?:mundane|nonmagical))\\b";
const EAT = "(?:eat|eats|eating|drink|drinks|drinking|consume|consumes|consuming|swallow|swallows|swallowing|ingest|ingests|ingesting|chew|chews|chewing|quaff|quaffs|imbibe|imbibes)";
const CONTAINER = "(?:bottle|vial|jar|flask|phial|globe|urn|jug|box|container)";
const GENERIC = [
  /\b(?:shatters|crumbles|explodes|bursts|breaks)\b[^.]{0,40}?\bon impact\b/i,
  /\bthrow (?:the|this|a|an|one) [^.]*?\bit (?:shatters|explodes|breaks|bursts)\b/i,
  /\bpour (?:out )?(?:all )?(?:of )?the (?:contents|liquid)\b/i,
  /\bdrains (?:the [a-z’']+|its) magic\b/i,
  /\bloses (?:all )?(?:of )?(?:its )?magic(?:al)?(?: properties)? and becomes (?:a )?(?:mundane|nonmagical)\b/i,
  /^afterwards?,? [^.]*?\b(?:becomes (?:a )?(?:mundane|nonmagical)|is destroyed|crumbles)\b/i,
  /\b(?:single[- ]use|for (?:a single|one) use|can (?:only )?be used (?:only )?once|can(?:not|'t|’t) be used again(?! until| for| before))/i,
];
// Words before the match that make it a condition or the end of many uses,
// not what using the item does: "If the stake is removed", "On a 1", "When
// the shaker is empty", "Once you've used all four symbols", "20 times", a
// "50 percent chance", a roll table's row.
const IF_BEFORE = /\b(?:if|unless|should|exposed|reduced to|drops? to|hit points|whenever|empty|used all|\d+ times|last charge|chance|check)\b|\bon an? (?:1|roll|result|success)\b|\b(?:when|until|after) $/i;
// A second, destructive use beside a lasting one ("Alternatively, you can
// break the whistle"): the item is kept, and the GM removes it when broken.
const DUAL = /\b(?:alternatively|additionally|instead of)\b/i;

// The words of an item's own text that say using it uses it up, or null for
// an item that is kept. Ammunition is spent by the shot.
export function usedUpWords(name, category, desc) {
  if (/ammunition|\barrows?\b|\bbolts?\b|\bbullets?\b/i.test(category)) {
    return `its category, "${category}"`;
  }
  if (/\b(?:ammunition|arrows?|bolts?|bullets?|sling stones?)\b/i.test(name)) {
    return `its name, "${name}"`;
  }
  const nouns = headNouns(name).map(esc).join("|");
  // "the seed", "this item", never "the liquid in the retort" or "the
  // writing on the parchment".
  const noun = `(?:the|this|that|each|its|one|a|an) (?:magic(?:al)? )?(?:item|${nouns})(?:s|es)?`;
  const self = `(?<!\\b(?:in|of|from|into|inside|within|on|onto|with|to|by|at) )\\b${noun}`;
  const own = [
    new RegExp(`${self}(?: (?!(?:the|a|an|its)\\b)[a-z’']+){0,6}? ${SPENT}`, "i"),
    new RegExp(`${self} [^,.;]*? and (?:is|are) (?:then )?(?:destroyed|consumed)\\b`, "i"),
    new RegExp(`${self} (?:is|are) (?:eaten|drunk|swallowed|ingested|chewed)\\b`, "i"),
    new RegExp(`\\b${EAT} (?:all of |some of )?${self}\\b`, "i"),
    new RegExp(`\\b(?:destroy|destroys|destroying) (?:it|them|${noun}|the ${CONTAINER})\\b`, "i"),
  ];
  const named = new RegExp(`\\b(?:${nouns})`, "i");
  const pronoun = /\b(?:it|they) (?:is|are) (?:then |also )?(?:destroyed|consumed|used up)\b|\b(?:it|they) (?:crumbles?|vanish(?:es)?|disintegrates?|dissolves?|becomes? (?:a )?(?:mundane|nonmagical))\b/i;
  // A roll table's rows are outcomes the dice pick, not what using it does.
  const prose = desc.split("\n").filter((line) => !line.trim().startsWith("|")).join(" ").replace(/\s+/g, " ").replace(/[_*]/g, "");
  for (const sentence of prose.split(/(?<=[.!?])\s+/)) {
    if (DUAL.test(sentence)) {
      return null;
    }
    const hits = [...own, ...GENERIC, ...(named.test(sentence) ? [pronoun] : [])].map((re) => re.exec(sentence)).filter(Boolean);
    const hit = hits.sort((a, b) => a.index - b.index).find((m) => !IF_BEFORE.test(sentence.slice(0, m.index)));
    if (hit) {
      return hit[0].trim();
    }
  }
  return null;
}

// Whether the rules above left an item unplaced: no word of its name or
// category says it is used up or kept.
export function unplaced(tags) {
  return !tags.some((tag) => tag === "consumable" || tag === "durable" || tag === "kept");
}

// The magic item table's rows (src/lib/classes/magic-items.json), by slug or
// whole name: use_item keeps each of them unless its tags call it consumable
// (src/lib/dm/item-logic.ts), so only the rest are read from their text.
export function inMagicTable(tableItems) {
  const key = (name) => name.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9']+/g, " ").trim();
  const names = new Set(tableItems.flatMap((row) => [row.name, ...(row.aliases ?? [])]).map(key));
  const slugs = new Set(tableItems.flatMap((row) => row.slugs ?? []));
  return (name, slug) => slugs.has(slug) || names.has(key(name));
}
