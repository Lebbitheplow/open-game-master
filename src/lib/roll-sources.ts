// The source of a roll nobody at the table made (issue 915, ruling 2): a
// trap, a fall, a poisoned draught, the effect of a spell or feature with no
// caster at the table, a hazard the GM named, or the GM's own dice for harm
// nothing names. It is the roll's attacker (src/lib/db/rolls.ts RollSource),
// so it goes in front of the roll's card, and the character or creature the
// roll lands on is its target.
//
// Every source is built here: no other module writes one out
// (scripts/test-roll-labels.mjs holds that). What it is goes in a field
// (`hazard`), set from what its site knows it to be, so no reader works that
// out from its name.
//
// The name is what a sentence calls it ("damage from the fall", "from a
// trap"), which is where a hit's record is read (src/lib/dm/last-hit.ts). A
// source that was given a name keeps it and shows it in front of its rolls.
// The two that never are (a fall, the GM's own dice) are worded there by the
// field, in the table's language (src/lib/roll-labels.ts).
//
// A hit's record names the same sources: it is handed the roll's own value
// where one site writes both.
//
// Pure (type imports only), so client components and test scripts import it.

import type { HazardKind, RollSource } from "@/lib/db/rolls";

// The longest name a source keeps.
const NAME_MAX = 80;

function source(hazard: HazardKind, name: string): RollSource {
  return { kind: "hazard", id: null, name, hazard };
}

// A source by the name it was given. With none it is the GM's own dice,
// which a sentence calls by `unnamed` ("a trap", "the effect").
function named(hazard: HazardKind, said: string | null | undefined, unnamed?: string): RollSource {
  const name = (said ?? "").trim().slice(0, NAME_MAX);
  return name ? source(hazard, name) : gmSource(unnamed);
}

// A fall, whatever its height.
export const fallSource = (): RollSource => source("fall", "the fall");

// Dice the GM threw for harm that no creature made and nothing names.
// `words` is what a sentence calls that harm where its site has some ("a
// trap", "the hazard"); in front of a roll it is the GM's all the same.
export const gmSource = (words?: string): RollSource => source("gm", (words ?? "").trim().slice(0, NAME_MAX) || "the GM");

// A trap, by its name in the catalog or the words the GM gave it.
export const trapSource = (name: string | null | undefined, unnamed?: string): RollSource => named("trap", name, unnamed);

// An item that harms whoever uses it (a potion of poison).
export const itemSource = (name: string | null | undefined): RollSource => named("item", name);

// The effect of a spell or a feature: of one whose caster is nobody at the
// table or has left it, and of a creature's own in a hit's record of harm no
// attack made, which names no creature.
export const effectSource = (name: string | null | undefined, unnamed?: string): RollSource => named("effect", name, unnamed);

// A hazard in the words the GM gave it ("a gout of flame").
export const namedSource = (said: string | null | undefined, unnamed?: string): RollSource => named("named", said, unnamed);

// What a spell, trap or hazard with no creature behind it is the roll of,
// from what its call says: the source it names (a trap, when the call says
// it is one), else its spell, else the GM's own dice.
export function castSource(said: string | null | undefined, spell: string | null | undefined, trap = false, unnamed?: string): RollSource {
  const words = (said ?? "").trim();
  return words ? (trap ? trapSource(words) : namedSource(words)) : effectSource(spell, unnamed);
}

// Harm the GM deals with dice of their own and no creature (apply_damage,
// damage_enemy, an area): the spell it is, else the words they gave for it,
// else their own dice.
export function harmSource(spell: string | null | undefined, reason: string | null | undefined, unnamed?: string): RollSource {
  return (spell ?? "").trim() ? effectSource(spell) : namedSource(reason, unnamed);
}

// What a sentence calls harm the GM dealt with a tool of their own and named
// nothing for: its dice (ai-gate.ts) and its record (mutations.ts) both say so.
export const UNNAMED_HARM = "the harm";

// The source behind a hit's record no creature made, as a roll names it. A
// record written before it said what it is reads as a hazard by its name.
export function recordSource(attacker: { name: string; hazard?: HazardKind }): RollSource {
  return named(attacker.hazard ?? "named", attacker.name);
}
