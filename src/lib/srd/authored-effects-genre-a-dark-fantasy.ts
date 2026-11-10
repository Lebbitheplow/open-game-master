// The dark fantasy classes' features that wave 2's last round built, as the
// authored layer's rows (WAVE2 D5, R11: a genre counter whose text states a
// number, a save, a condition or damage is built). Registered with one line in
// src/lib/srd/authored-effects-genre-a.ts. Each spend pays its own counter
// (src/lib/classes/resources.json) and replaces the counter's one-target save,
// which rolled the text's dice on one creature and dropped the rest.
//
// An area the text places nowhere (a 15-foot cube, a 15-foot cone) is held as
// the creatures of the player's choice within that many feet of the holder:
// every creature a cube or a cone laid against the holder can catch stands
// there, and the call names the ones it caught. Each takes the action: the text
// names no cost, and an area attack on the holder's turn is an action in
// SRD 5.1 (a breath weapon, Channel Divinity).
import type { AuthoredEffect, AuthoredEntry } from "@/lib/srd/authored-effects-types";
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

const counted = (classId: string, feature: string, counter: string, entry: Omit<AuthoredEntry, "subclass" | "counter">): GenreRow => ({
  feature,
  classes: [classId],
  entry: { subclass: "genre", counter, ...entry },
});

// "wreathe yourself in gray flame for 1 minute": what the flame switches on.
const IMMOLATED = { condition: "immolate the sin", because: "the gray flame of Immolate the Sin" } as const;
const IMMOLATE_EFFECTS: AuthoredEffect[] = [
  { kind: "hit_rider", dice: "2d8", type: "fire", gate: IMMOLATED },
  { kind: "immune_damage", types: ["fire"], gate: IMMOLATED },
];

export const GENRE_A_DARK_FANTASY: GenreRow[] = [
  // "A low hum: one enemy within 30 ft subtracts 1d4 from its next attack roll
  // (WIS save negates)", at will. An action, as a cantrip that lays a penalty
  // is (Vicious Mockery).
  { feature: "Dirge of Sorrow", classes: ["dirgesinger"], entry: { subclass: "genre", spends: [{ name: "Dirge of Sorrow", action: "action", does: { kind: "dark_fantasy", play: "dirge" } }] } },
  // "spectral hands erupt in a 15-ft cube: creatures save (STR) or are
  // restrained until your next turn"
  counted("grave_knight", "Grave Grip", "dark_fantasy_grave_grip", {
    spends: [{
      name: "Grave Grip",
      pool: { id: "dark_fantasy_grave_grip" },
      action: "action",
      does: { kind: "save_area", save: "str", dcAbility: "spell", rangeFt: 15, chosen: true, condition: "restrained", untilNextTurn: true },
    }],
  }),
  // "a scream: creatures in a 15-ft cone save (CON) or take 3d6 fire and are
  // deafened for 1 minute": the penitent casts no spells, so the DC is their
  // Wisdom's, the ability their discipline runs on.
  counted("penitent", "Voice Like Embers", "dark_fantasy_voice_like_embers", {
    spends: [{
      name: "Voice Like Embers",
      pool: { id: "dark_fantasy_voice_like_embers" },
      action: "action",
      does: { kind: "save_area", save: "con", dcAbility: "wis", rangeFt: 15, chosen: true, dice: "3d6", type: "fire", condition: "deafened", rounds: 10 },
    }],
  }),
  // "a wheeling flock blinds enemies in a 20-ft radius for 1 minute (CON save
  // each turn)": every enemy within 20 feet of the doctor, each blinded until
  // it saves at the end of one of its turns, a minute at most.
  counted("plague_doctor", "Murder of Crows", "dark_fantasy_murder_of_crows", {
    spends: [{
      name: "Murder of Crows",
      pool: { id: "dark_fantasy_murder_of_crows" },
      action: "action",
      does: { kind: "save_area", save: "con", dcAbility: "spell", rangeFt: 20, condition: "blinded", rounds: 10, saveEnds: true },
    }],
  }),
  // "for 1 minute: +2d8 fire on your attacks and immunity to fire"
  counted("penitent", "Immolate the Sin", "dark_fantasy_immolate_the_sin", {
    effects: IMMOLATE_EFFECTS,
    spends: [{ name: "Immolate the Sin", pool: { id: "dark_fantasy_immolate_the_sin" }, action: "none", does: { kind: "buff", condition: "immolate the sin", rounds: 10 } }],
  }),
];
