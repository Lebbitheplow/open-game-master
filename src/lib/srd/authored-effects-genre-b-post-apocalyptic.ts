// The post-apocalyptic classes' features built in the fifth pass of wave 2
// (WAVE2 D5: "The genre classes' text is the rule, played on the SRD 5.1
// engine"), as rows of the authored layer the way
// src/lib/srd/authored-effects-genre-b.ts holds the earlier passes'. Their text
// is src/lib/classes/post-apocalyptic-features.json; each row names its class
// so a same-named feature of another class never runs as this one. Registered
// in GENRE_AUTHORED (src/lib/srd/authored-effects-genre.ts) with one line.
//
// Pure data; no database.
import type { AuthoredEntry, SpendAction, SpendDoes } from "@/lib/srd/authored-effects-types";
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

const row = (feature: string, classes: string[], entry: Omit<AuthoredEntry, "subclass">): GenreRow => ({
  feature,
  classes,
  entry: { subclass: "genre", ...entry },
});

function spend(feature: string, classes: string[], counter: string, action: SpendAction | undefined, does: SpendDoes): GenreRow {
  return { feature, classes, entry: { subclass: "genre", counter, spends: [{ name: feature, pool: { id: counter }, ...(action ? { action } : {}), does }] } };
}

const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];

export const GENRE_B_PA_AUTHORED: GenreRow[] = [
  // ---- passives on the engine's own readers ----
  // "Constructs and automated defenses must save (WIS) to target you over other
  // creatures": a construct that attacks the salvage tech first saves or loses
  // the attack (src/lib/dm/authored-hooks.ts authoredIncomingAttack, as Among
  // the Dead wards against undead). An automated defense is a construct on the
  // SRD engine.
  row("Machine Empathy", ["salvage_tech"], { effects: [{ kind: "ward_vs", types: ["construct"], save: "wis" }] }),
  // "You sense radiation precisely and are resistant to its effects" and
  // "Immunity to radiant and necrotic damage from tech and radiation sources":
  // radiation burns as radiant and withers as necrotic on the SRD engine
  // (Meltdown Ward names the two), and in this genre a tech effect is what a
  // spell is, so the engine has no radiant or necrotic blow to tell apart from
  // them: the resistance, then the immunity, holds against both types.
  row("Geiger Sense", ["salvage_tech"], { effects: [{ kind: "resist", types: ["radiant", "necrotic"] }] }),
  row("Meltdown Ward", ["salvage_tech"], { effects: [{ kind: "immune_damage", types: ["radiant", "necrotic"] }] }),
  // "Resistance to two damage types of your choice, chosen each dawn": named
  // one at a time, the third choice replacing the oldest
  // (src/lib/dm/genre-b-post-apocalyptic-spends.ts genome).
  row("Apex Genome", ["aberrant"], {
    spends: [{ name: "Apex Genome", action: "none", fight: "out", does: { kind: "variants", options: Object.fromEntries(DAMAGE_TYPES.map((type) => [type, { does: { kind: "wastes", call: "genome" } as SpendDoes }])) } }],
  }),
  // "Rapid Adaptation ... can also grant a climb or swim speed for an hour":
  // a use of Rapid Adaptation's counter, which the damage path spends for the
  // resistance (src/lib/dm/genre-b-post-apocalyptic-blows.ts paDamaged).
  row("Second Adaptation", ["aberrant"], {
    counter: "post_apocalyptic_rapid_adaptation",
    spends: [{
      name: "Second Adaptation",
      pool: { id: "post_apocalyptic_rapid_adaptation" },
      does: { kind: "variants", options: { climb: { does: { kind: "buff", condition: "adapted (climb)", rounds: 600 } }, swim: { does: { kind: "buff", condition: "adapted (swim)", rounds: 600 } } } },
    }],
  }),
  // "1/rest, an audible sermon gives allies within 30 ft advantage on their
  // next save against fear or despair."
  spend("Testify", ["waste_preacher"], "post_apocalyptic_testify", undefined, { kind: "wastes", call: "testify", rangeFt: 30 }),

  // ---- the packmaster's beasts (src/lib/dm/genre-b-post-apocalyptic-beast.ts) ----
  // "A loyal wasteland beast fights beside you (AC 13 + your proficiency, HP 5
  // x level, attack 1d8 + WIS, obeys your commands)": the call that brings it
  // to the board; War Beast and Twin Bond change what is bonded.
  row("Bonded Beast", ["packmaster"], { spends: [{ name: "Bonded Beast", action: "none", does: { kind: "pack", call: "bonded" } }] }),
  // "1/long rest, summon 1d4 local beasts (wolf stats) to aid you for 10 minutes."
  spend("Call the Wild", ["packmaster"], "post_apocalyptic_call_the_wild", "action", { kind: "pack", call: "wild" }),
  // "1/long rest, your beast grows monstrous for 1 minute: double HP, +10 ft
  // speed, attacks deal +2d8 and frighten (WIS save)."
  spend("Legend of the Pack", ["packmaster"], "post_apocalyptic_legend_of_the_pack", undefined, { kind: "pack", call: "legend" }),
];
