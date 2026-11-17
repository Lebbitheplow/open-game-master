// What a Hand card shows at render time, beyond the words its builder keyed:
// a card's name in the reader's language, and an engine condition word as
// the reader reads it. Pure and database-free, like the hand modules; the
// engine-facing half of a card (its id, its intent, the sentences it
// composes) never passes through here.
//
// card.name itself is display-only in the UI flow — the commit keys off
// card.id, and a card's intent carries its own engine names — so a name is
// translated where it is displayed, the way contentName (names.ts) works for
// every other table. What reaches the engine and the protocol stays English.
import type { HandCard } from "@/lib/battlemap/hand-core";
import { contentName } from "@/lib/content/names";
import { frTables } from "@/lib/i18n/fr-tables";
import { resourceDisplayName } from "@/lib/srd/class-resources-fr";
import { textKey } from "@/lib/language/text-logic";
import { translate, type Locale } from "@/lib/messages-logic";

type T = (key: string, vars?: Record<string, string | number>) => string;
const enT: T = (key, vars) => translate("en", key, vars);

// ---- condition words ----

// The engine's own condition words a card may carry on its Applies row and
// hand-cond span (hand-play.ts builds the row, HandCardFace the span): the
// words the spell-mechanics rows (mech.condition?.name), the resource tables'
// effects and the authored effects store. Keyed to the reader's word the way
// hand.ts's DTYPE_KEY keys a damage type; the SRD's own fifteen conditions
// are NOT keyed — contentName("conditions") gives them the official French
// print, and English passes through it untouched.
const CONDITION_WORD: Record<string, string> = {
  raging: "raging",
  baned: "baned",
  banished: "banished",
  calmed: "calmed",
  commanded: "commanded",
  confused: "confused",
  dancing: "dancing",
  enclosed: "enclosed",
  "faerie fire": "faerie fire",
  feebleminded: "feebleminded",
  levitating: "levitating",
  mazed: "mazed",
  mocked: "mocked",
  slowed: "slowed",
  suggested: "suggested",
  "aspect of the wyrm: frighten": "aspect of the wyrm: frighten",
  bladesong: "bladesong",
  "celestial revelation: heavenly wings": "celestial revelation: heavenly wings",
  "fighting spirit": "fighting spirit",
  flying: "flying",
  "form of dread": "form of dread",
  "giant's might": "giant's might",
  "manifest mind": "manifest mind",
  "mantle of majesty": "mantle of majesty",
  "spirit projection": "spirit projection",
  "spirit totem: bear": "spirit totem: bear",
  "starry form: archer": "starry form: archer",
  "tentacle of the deep": "tentacle of the deep",
  "trance of order": "trance of order",
  // The whole templates ride their parenthetical in the reader's words; a
  // bracket the map does not carry ("unsettled (d8)") keeps it as stored.
  "dark one's own luck (d10)": "dark one's own luck (d10)",
  "blessing of the forge (armor)": "blessing of the forge (armor)",
  "storm aura (desert)": "storm aura (desert)",
  "storm aura (sea)": "storm aura (sea)",
  unsettled: "unsettled",
};

// A condition word as the reader reads it: the keyed engine words first,
// then a "head (note)" rides its bracket on the head's word, then the SRD's
// official print through the conditions table, then the word as stored. The
// basics' own conditions (Dodging, Grappled…) are keyed by their builders
// already and fall through untouched, as does a card's own Concentration.
export function conditionWord(condition: string, t: T = enT, locale: Locale = "en"): string {
  const raw = condition.trim();
  if (!raw) return raw;
  const key = CONDITION_WORD[raw];
  if (key) return t(key);
  const bracketed = /^(.*\S)\s*\(([^()]*)\)$/.exec(raw);
  if (bracketed) {
    const head = CONDITION_WORD[bracketed[1].trim()];
    if (head) return `${t(head)} (${bracketed[2]})`;
  }
  return contentName("conditions", raw, locale);
}

// ---- feature and spell chip names ----

// The hand's reaction and option cards carry the feature's, the spell's or
// the maneuver's own name as the engine and the sheet matching read it
// (holdsFeature, isNamed, option-costs), so the builders keep those names
// English and the render maps them here — the boundary the engineRefusalKey
// pattern sets. A name the FR SRD carries renders in its official print: the
// spells and feats through contentName, the class features through their
// names-fr row (keyed class:feature, read directly — a chip carries no
// class). A name the FR datasets do not carry (the PHB-only oaths, domains
// and maneuvers — every candidate verified absent from names-fr.ts and the
// FR rulebook) takes the dictionary's coinage, the same conventions the
// option notes already hold (Frappe rapide for Rapid Strike).
const CHIP_COINED_KEY: Record<string, string> = {
  "vow of enmity": "Vow of Enmity",
  "soul of vengeance": "Soul of Vengeance",
  "circle of the moon": "Circle of the Moon",
  "rapid strike": "Rapid Strike",
  rally: "Rally",
  "commander's strike": "Commander's Strike",
  "war priest": "War Priest",
  "unwavering mark": "Unwavering Mark",
  "hungry jaws": "Hungry Jaws",
  "pistol and blade": "Pistol and Blade",
  "abjure enemy": "Abjure Enemy",
  "control undead": "Control Undead",
  "conquering presence": "Conquering Presence",
  "dreadful aspect": "Dreadful Aspect",
  "arcane abjuration": "Arcane Abjuration",
  "destructive wrath": "Destructive Wrath",
  "guided strike": "Guided Strike",
  "war god's blessing": "War God's Blessing",
  "touch of death": "Touch of Death",
};

// The features whose official print the FR SRD carries under a compound key
// ("Conduit divin : Renvoi des morts-vivants"): the names-fr classFeatures
// key that holds it. A chip names the bare feature, so a compound's tail
// after its colon is what shows ("Turn Undead" -> "Renvoi des morts-vivants").
const CHIP_FEATURE_ROW: Record<string, string> = {
  "uncanny dodge": "rogue:uncanny-dodge",
  "deflect missiles": "monk:deflect-missiles",
  "slow fall": "monk:slow-fall",
  "cutting words": "bard:cutting-words",
  "divine smite": "paladin:divine-smite",
  "hurl through hell": "warlock:hurl-through-hell",
  "turn undead": "cleric:channel-divinity-turn-undead",
  "turn the unholy": "paladin:channel-divinity-turn-the-unholy",
  "preserve life": "cleric:channel-divinity-preserve-life",
};

// A feature, maneuver, spell or feat chip name as the reader reads it.
export function chipName(name: string, locale: Locale): string {
  if (locale !== "fr" || !name) return name;
  const key = textKey(name);
  const coined = CHIP_COINED_KEY[key];
  if (coined) return translate("fr", coined);
  const row = CHIP_FEATURE_ROW[key];
  if (row) {
    const print = frTables()?.names.classFeatures?.[row];
    if (print) {
      const bare = name.includes(":") ? print : print.includes(": ") ? print.split(": ").slice(1).join(": ") : print;
      return bare || print;
    }
  }
  const spell = contentName("spells", name, locale);
  if (spell !== name) return spell;
  return contentName("feats", name, locale);
}

// ---- card names ----

// A card's name in the reader's language, from the table the card came from.
// The id prefix is the discriminator, not the type: a spell and a class
// feature can both be dealt as mend or ward cards, and the basics, the gear
// moves and the monsters' cards already carry the reader's words from their
// builders (they return unchanged). Attack cards' names are the carried
// lines' own names (sheet equipment), so they read the item tables — a
// carried Shield is the armor row, a Longsword the weapon row, a Potion of
// healing the gear row; a name no table carries (a magic item's engraving,
// a natural weapon, "Unarmed strike") stays as it was spelled.
export function cardDisplayName(card: HandCard, locale: Locale): string {
  if (locale !== "fr" || !card.name) {
    return card.name;
  }
  const id = card.id;
  if (id.startsWith("spell:")) {
    return contentName("spells", card.name, locale);
  }
  if (id.startsWith("feature:")) {
    // The resource id rides on the card: the pool it spends, else the id
    // itself ("feature:second_wind").
    const resourceId = card.pool ?? id.slice("feature:".length);
    return resourceDisplayName(resourceId, locale) ?? card.name;
  }
  if (id.startsWith("rider:")) {
    return contentName("feats", card.name, locale);
  }
  if (id.startsWith("attack:") || id.startsWith("offhand:")) {
    return contentName("items", card.name, locale);
  }
  // The reaction and option cards wear the feature's, spell's or maneuver's
  // own name (chipName above); the granted attacks wear the spell that laid
  // the condition, the same tables read it.
  if (id.startsWith("reaction:") || id.startsWith("option:") || id.startsWith("attack:granted:")) {
    return chipName(card.name, locale);
  }
  return card.name;
}
