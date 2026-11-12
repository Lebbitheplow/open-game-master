// A spell card's glyph and the words beside it (issue 845). A painting per
// spell did not say what the spell does: Animate Dead, Blight and Sapping
// Sting were the same green skull, and a homebrew spell had none. A glyph
// says one thing, read from the spell's own data: the damage it leads with,
// or else what it does. The card's text still names the spell, its dice and
// any second damage type.
//
// The words beside it are who or what the casting takes ("20-ft sphere",
// "Up to 3", "You"), read from the card the engine dealt, so they say what
// this casting at this slot does. No picture of a target: the council found
// a target picture was one more thing to learn, and the words already said
// it.
//
// Pure: hand-spells.ts asks it for each spell card, and
// scripts/test-spell-glyphs.mjs drives it over every spell in the manifest.
import { SPELL_GLYPH_NAMES } from "@/lib/battlemap/spell-glyph-names";
import type { HandCard } from "@/lib/battlemap/hand-core";
import type { SpellMech } from "@/lib/srd/spell-mech-types";
import { textKey } from "@/lib/language/text-logic";

export const DAMAGE_GLYPHS = [
  "acid",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "physical",
  "poison",
  "psychic",
  "radiant",
  "thunder",
] as const;

export const EFFECT_GLYPHS = ["heal", "restore", "guard", "dispel", "buff", "debuff", "summon", "teleport", "detection", "utility"] as const;

// choice: the caster (or a die) picks the damage type as the spell is cast.
// unknown: nobody has said what the spell does, a workshop spell with no
// block of its own, or a pack spell whose text the reader could not place.
export const SPELL_GLYPHS = [...DAMAGE_GLYPHS, ...EFFECT_GLYPHS, "choice", "unknown"] as const;

export type SpellGlyph = (typeof SPELL_GLYPHS)[number];

// The painting each glyph is drawn with (docs/art/spell-glyphs-2026-11-10).
export function spellGlyphSrc(glyph: SpellGlyph): string {
  return `/assets/icons/glyph/spell-${glyph}.webp`;
}

// An effect glyph in plain words, as the card's own lines are written:
// its id ("buff", "debuff") is game jargon, and "heal" or "summon" read as
// a verb after the card's cost ("Cure Wounds, Action, heal").
const EFFECT_WORDS: Record<(typeof EFFECT_GLYPHS)[number], string> = {
  heal: "healing",
  restore: "ends a condition",
  guard: "protection",
  dispel: "ends a spell",
  buff: "boon",
  debuff: "hindrance",
  summon: "summoning",
  teleport: "teleportation",
  detection: "detection",
  utility: "utility",
};

// The glyph in words, for a screen reader; "" where it would say nothing.
export function spellGlyphLabel(glyph: SpellGlyph): string {
  if (glyph === "unknown") return "";
  if (glyph === "choice") return "damage type of your choice";
  if (glyph === "physical") return "weapon damage";
  if (glyph in EFFECT_WORDS) return EFFECT_WORDS[glyph as keyof typeof EFFECT_WORDS];
  return `${glyph} damage`;
}

const BY_NAME = new Map<string, SpellGlyph>(
  Object.entries(SPELL_GLYPH_NAMES).flatMap(([glyph, names]) => (names ?? []).map((name) => [textKey(name), glyph as SpellGlyph] as const)),
);

const PHYSICAL = new Set(["slashing", "piercing", "bludgeoning", "physical"]);
const DAMAGE = new Set<string>(DAMAGE_GLYPHS);

// What a mechanics row says the spell does, or null when it does not say.
// Damage first: a spell that hurts and holds (Ray of Frost's slow) is read
// by its damage, as the card's dice line leads with it.
export function glyphFromMech(mech: SpellMech | null | undefined): SpellGlyph | null {
  if (!mech) return null;
  if (mech.damageType) {
    const type = textKey(mech.damageType);
    return PHYSICAL.has(type) ? "physical" : DAMAGE.has(type) ? (type as SpellGlyph) : null;
  }
  if (mech.resolution === "heal" || mech.revive) return "heal";
  if (mech.cures) return "restore";
  if (mech.resolution === "summon") return "summon";
  if (mech.condition) return "debuff";
  if (mech.resolution === "buff") return "buff";
  return null;
}

export type GlyphSpell = {
  name: string;
  // A table's workshop spell: the published spell it runs as, and whether
  // the table wrote it a mechanics block of its own.
  runsAs?: string;
  ownBlock?: boolean;
  // The row the engine casts it by (authored, overridden, or read from its
  // text); null when there is none.
  mech: SpellMech | null;
  // The published row of the spell it runs as, for a workshop block that
  // does not say.
  published?: SpellMech | null;
};

export function spellGlyph(spell: GlyphSpell): SpellGlyph {
  const named = (name: string | undefined) => (name ? BY_NAME.get(textKey(name)) ?? null : null);
  // A workshop block is what the server casts, so it is read first: a copy
  // of Fireball rewritten to deal cold wears cold. The published spell's
  // glyph is the fallback for a block that does not say.
  if (spell.ownBlock) return glyphFromMech(spell.mech) ?? named(spell.runsAs) ?? glyphFromMech(spell.published) ?? "unknown";
  return named(spell.name) ?? named(spell.runsAs) ?? glyphFromMech(spell.mech) ?? glyphFromMech(spell.published) ?? "unknown";
}

// The words beside the glyph: the area a blast or a lasting area covers,
// how many creatures or missiles the casting shares out, or whom it takes.
// "" for a spell that aims at nothing (Mage Hand, a ritual): an empty well
// beats a word that says nothing.
export function spellTargetWords(card: Pick<HandCard, "target" | "area" | "shares">): string {
  const blast = card.area?.blast;
  if (blast) {
    if (blast.self && (blast.shape === "sphere" || blast.shape === "cylinder")) return `${blast.feet} ft around you`;
    return `${blast.feet}-ft ${blast.shape}`;
  }
  const area = card.area;
  if (area && area.feet) {
    if (area.shape === "aura") return `${area.feet} ft around you`;
    return `${area.feet}-ft ${area.shape}`;
  }
  const shares = card.shares;
  if (shares && shares.count > 1) {
    return shares.unit === "creature" ? `Up to ${shares.count}` : `${shares.count} ${shares.unit}s`;
  }
  if (card.target === "self") return "You";
  // One creature, said so: beside an area or a count on the next card, a
  // blank well read as "no target" rather than "one".
  if (card.target === "enemy" || card.target === "ally") return "1 creature";
  return "";
}

// The words in at most two lines: the size or count on the first, what it
// counts on the second ("20-ft" over "sphere", "3" over "darts"), so the
// number reads first and the type can be as large as the well allows. A
// count that ends the words ("Up to 3") stays one line. The card sizes the
// type from the longest line and the line count.
export function targetLines(words: string): string[] {
  if (!words) return [];
  const parts = words.split(" ");
  let cut = parts.findIndex((part) => /\d/.test(part)) + 1;
  if (cut > 0 && parts[cut] === "ft") cut += 1;
  return cut > 0 && cut < parts.length ? [parts.slice(0, cut).join(" "), parts.slice(cut).join(" ")] : [words];
}
