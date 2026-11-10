// The cyberpunk, dark fantasy and horror classes' features, as the authored
// layer's rows (WAVE2 D5: "The genre classes' text is the rule, played on the
// SRD 5.1 engine"). Each row is found by its feature's name (authored-effects.ts
// heldAuthored), with `classes` naming the class it belongs to so a name another
// genre class uses means only that class's feature. The text each row holds is
// the catalog's (src/lib/classes/<genre>-features.json); the ledgers
// (scripts/clauses/genre-<genre>.json) say which clause each row holds.
//
// Before this every one of these was a line of the GM's prompt and nothing
// else: Chrome Constitution resisted no poison, Iron Constitution let a poison
// land, Hypervigilant was surprised with the rest of the party.
import type { AuthoredEffect, AuthoredEntry } from "@/lib/srd/authored-effects-types";
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

const row = (classId: string, feature: string, effects: AuthoredEffect[], more: Partial<AuthoredEntry> = {}): GenreRow => ({
  feature,
  classes: [classId],
  entry: { subclass: "genre", effects, ...more },
});

const FEAR: AuthoredEffect = { kind: "save_adv", against: ["frightened"] };

// ---- passive defenses, saves and senses ----
const PASSIVES: GenreRow[] = [
  // cyberpunk
  row("netrunner", "Ghost in the Feed", [{ kind: "check_adv", skills: ["stealth"], creatures: ["construct"], note: "Advantage on Stealth against a construct; cameras and sensors are the GM's to name as constructs." }]),
  row("netrunner", "Neural Firewall", (["int", "wis", "cha"] as const).map((ability): AuthoredEffect => ({ kind: "save_adv", ability, magical: true }))),
  // "cannot be surprised while conscious"; its +2 to initiative is the
  // feature-effects entry (genre-a-feature-defs.ts).
  row("street_samurai", "Chrome Reflexes", [{ kind: "no_surprise" }]),
  row("street_samurai", "Subdermal Plating", [{ kind: "ac", amount: 1, gate: { notHeavy: true } }]),
  row("street_samurai", "Chrome Constitution", [{ kind: "save_adv", ability: "con" }, { kind: "resist", types: ["poison"] }]),
  row("esper", "Thought Shield", [{ kind: "save_bonus", amount: 2, ability: "wis", note: "+2 on WIS saves; a mind that cannot be read is the GM's to keep." }]),
  row("esper", "Mind Fortress", [{ kind: "resist", types: ["psychic"] }, { kind: "save_adv", against: ["charmed", "frightened"] }]),
  row("esper", "Ascendant Mind", [{ kind: "immune_damage", types: ["psychic"] }]),
  // dark fantasy
  row("witch_hunter", "Grim Resolve", [FEAR]),
  row("witch_hunter", "Iron Will", [{ kind: "save_adv", against: ["charmed"] }]),
  row("plague_doctor", "Miasma Ward", [{ kind: "resist", types: ["poison"] }, { kind: "save_adv", against: ["disease"] }]),
  row("plague_doctor", "Beaked Mask", [FEAR]),
  row("plague_doctor", "Iron Constitution", [{ kind: "immune_damage", types: ["poison"] }, { kind: "immune_condition", conditions: ["poisoned", "diseased"] }]),
  row("plague_doctor", "Miasma Mantle", [{ kind: "resist", types: ["necrotic"] }]),
  row("grave_knight", "Knight of Dust", [{ kind: "resist", types: ["necrotic"] }]),
  row("grave_knight", "Wight-Iron Will", [{ kind: "immune_condition", conditions: ["frightened", "charmed"] }]),
  row("penitent", "Scarred Hide", [{ kind: "resist", types: ["slashing"], nonmagical: true }]),
  row("penitent", "Flagellant's Trance", [FEAR]),
  // "when a creature hits you in melee, it takes your WIS mod in fire damage"
  row("penitent", "Robes of Soot", [{ kind: "resist", types: ["fire"] }, { kind: "retaliate", formula: "wis", type: "fire", melee: true }]),
  row("dirgesinger", "Songs of the Barrow", [{ kind: "save_adv", against: ["frightened", "necrotic"] }]),
  row("vermin_lord", "Plaguebearer's Immunity", [{ kind: "immune_condition", conditions: ["diseased"] }, { kind: "resist", types: ["poison"] }]),
  // horror
  row("exorcist", "Litany of Defense", [FEAR]),
  row("exorcist", "Unshakeable Faith", [{ kind: "immune_condition", conditions: ["frightened"] }, { kind: "save_adv", against: ["charmed"] }]),
  row("exorcist", "Sacred Bulwark", [{ kind: "resist", types: ["necrotic", "psychic"] }]),
  row("occultist", "Palimpsest Soul", [{ kind: "resist", types: ["psychic"] }]),
  row("occultist", "Unblinking Study", [{ kind: "no_surprise", types: ["aberration", "fiend", "undead"] }]),
  row("survivor", "Read the Room", [{ kind: "init_adv" }]),
  row("survivor", "Hypervigilant", [{ kind: "no_surprise" }]),
  row("slayer", "Iron Stomach", [{ kind: "save_adv", against: ["poisoned", "disease"] }]),
  row("slayer", "Flinchless", [FEAR]),
  row("slayer", "Veteran's Guard", [{ kind: "ac", amount: 1 }, { kind: "oa_disadv" }]),
  row("parapsychologist", "Rational Mind", [{ kind: "save_adv", against: ["charmed", "frightened"] }]),
  row("parapsychologist", "Controlled Exposure", [{ kind: "resist", types: ["psychic"] }]),
  row("parapsychologist", "Clinical Detachment", [{ kind: "immune_condition", conditions: ["frightened"], note: "While the instruments are in hand: the GM says when they are not." }]),
  row("apostate", "Scar Tissue", [{ kind: "resist", types: ["necrotic"] }]),
  row("apostate", "Hunted Instincts", [{ kind: "no_surprise", slugs: ["cultist", "cult_fanatic"] }]),
];

export const GENRE_A_AUTHORED: GenreRow[] = [...PASSIVES];
