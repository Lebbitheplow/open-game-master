// The cyberpunk, dark fantasy and horror capstones and the other once-a-rest
// spends whose text states what they do (WAVE2 D5, R11): a mark laid by the
// spend and what it switches on while it holds, an area that turns the
// creatures it names. Before this each was a counter whose spend moved the
// counter and handed the GM its guidance line.
//
// The slotless casts the marks pay for are src/lib/dm/genre-a-casts.ts (the
// cast guard reads them); the twin each mark switches on is
// src/lib/dm/authored-reaper.ts (cast_at_enemy with secondTargetEnemyId).
import type { AuthoredEffect } from "@/lib/srd/authored-effects-types";
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

const counted = (classId: string, feature: string, counter: string, entry: Omit<GenreRow["entry"], "subclass" | "counter">): GenreRow => ({
  feature,
  classes: [classId],
  entry: { subclass: "genre", counter, ...entry },
});

// A second target for the spell cast while the mark holds, at any distance.
const twinWhile = (mark: string, minLevel: number, maxLevel: number): AuthoredEffect => ({
  kind: "twin_spell",
  school: "",
  anySchool: true,
  minLevel,
  maxLevel,
  anyRange: true,
  gate: { condition: mark },
});

// The companions, built by their spend as the steel defender is
// (src/lib/dm/genre-a-summons.ts holds the text's stats).
const companion = (classId: string, feature: string, kind: "drones" | "dire_rat"): GenreRow => ({
  feature,
  classes: [classId],
  entry: { subclass: "genre", spends: [{ name: feature, action: "none", fight: "out", does: { kind: "genre_summon", companion: kind } }] },
});

export const GENRE_A_CAPSTONES: GenreRow[] = [
  companion("rigger", "Drone Companion", "drones"),
  companion("vermin_lord", "Favored of the Swarm", "dire_rat"),
  // "1/long rest, summon a giant rat pack: four allied giant-rat-statted
  // beasts serve for 10 minutes"
  counted("vermin_lord", "King Below the Streets", "dark_fantasy_king_below_the_streets", {
    spends: [{ name: "King Below the Streets", pool: { id: "dark_fantasy_king_below_the_streets" }, action: "action", does: { kind: "genre_summon", companion: "rat_pack" } }],
  }),
  // "1/long rest, fly 30 ft for 10 minutes"
  counted("esper", "Psychic Flight", "cyberpunk_psychic_flight", {
    effects: [{ kind: "move", fly: 30, gate: { condition: "psychic flight" } }],
    spends: [{ name: "Psychic Flight", pool: { id: "cyberpunk_psychic_flight" }, action: "none", does: { kind: "buff", condition: "psychic flight", rounds: 100 } }],
  }),
  // "1/long rest, for 1 minute make one additional blade attack on each of
  // your turns": the mark adds the swing to the Attack action
  // (genre-a-feature-defs.ts GENRE_A_MARK_ATTACKS, read by combatRiders).
  counted("street_samurai", "Storm of Blades", "cyberpunk_storm_of_blades", {
    spends: [{ name: "Storm of Blades", pool: { id: "cyberpunk_storm_of_blades" }, action: "none", does: { kind: "buff", condition: "storm of blades", rounds: 10 } }],
  }),
  // "1/long rest, cast a psionic of 5th level or lower without a slot at two
  // targets": the mark lasts the turn; the cast it pays for clears it.
  counted("esper", "Singularity", "cyberpunk_singularity", {
    effects: [twinWhile("singularity", 1, 5)],
    spends: [{ name: "Singularity", pool: { id: "cyberpunk_singularity" }, action: "none", does: { kind: "buff", condition: "singularity", rounds: 1 } }],
  }),
  // "1/long rest, cast any warlock spell of 5th level or lower without a
  // slot, twinned to two targets"
  counted("occultist", "Author of the Unwritten", "horror_author_of_the_unwritten", {
    effects: [twinWhile("author of the unwritten", 1, 5)],
    spends: [{ name: "Author of the Unwritten", pool: { id: "horror_author_of_the_unwritten" }, action: "none", does: { kind: "buff", condition: "author of the unwritten", rounds: 1 } }],
  }),
  // "1/long rest, spectral voices join you for 1 minute: your dirges affect
  // one additional target"
  counted("dirgesinger", "The Grave Chorus", "dark_fantasy_the_grave_chorus", {
    effects: [twinWhile("the grave chorus", 0, 9)],
    spends: [{ name: "The Grave Chorus", pool: { id: "dark_fantasy_the_grave_chorus" }, action: "none", does: { kind: "buff", condition: "the grave chorus", rounds: 10 } }],
  }),
  // "1/long rest, you and up to three allies see and strike into the Ethereal
  // Plane for 1 minute": See Invisibility's sight, which reaches into the
  // Ethereal Plane, is the nearest SRD mechanic.
  counted("parapsychologist", "Beyond the Veil", "horror_beyond_the_veil", {
    spends: [{ name: "Beyond the Veil", pool: { id: "horror_beyond_the_veil" }, action: "none", does: { kind: "buff", condition: "beyond the veil", rounds: 10, target: "allies", count: "3", rangeFt: 30 } }],
  }),
  // "Action: fiends, undead, and spirits within 30 ft save (WIS) or must move
  // away from you for 1 minute": Turn Undead's turned (a spirit is an undead
  // in the SRD's types).
  counted("exorcist", "Rite of Repulsion", "horror_rite_of_repulsion", {
    spends: [{
      name: "Rite of Repulsion",
      pool: { id: "horror_rite_of_repulsion" },
      action: "action",
      // What Binding Words, Voice of Authority and Greater Rite add to it:
      // src/lib/dm/genre-a-horror-spends.ts horrorSaveArea.
      does: { kind: "save_area", save: "wis", dcAbility: "wis", rangeFt: 30, types: ["fiend", "undead"], condition: "turned", rounds: 10, onFail: "must move away from the exorcist for a minute" },
    }],
  }),
];
