// Genre features of the horror, post-apocalyptic and steampunk classes wired
// in the cc1113 completeness pass (ids GB..), as rows of the authored layer the
// way src/lib/srd/authored-effects-genre-b.ts holds the earlier passes'. Each
// row names its class so a same-named feature of another class never runs as
// this one; their text is src/lib/classes/<genre>-features.json. Registered in
// GENRE_AUTHORED (src/lib/srd/authored-effects-genre.ts) with one line.
//
// Pure data; no database.
import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

const row = (feature: string, classes: string[], entry: Omit<AuthoredEntry, "subclass">): GenreRow => ({
  feature,
  classes,
  entry: { subclass: "genre", ...entry },
});

export const GENRE_GB_AUTHORED: GenreRow[] = [
  // ---- checks about a circumstance (src/lib/dm/roll-about.ts CHECK_ABOUT) ----
  // The GM's call names what the check is about; the server asks when a
  // trait the roller holds would answer one, so none is lost to wording.
  // "Advantage to spot traps, ambushes, and unstable ground": spotting is a
  // Perception or an Investigation check.
  row("Trap Eye", ["scavenger"], { effects: [{ kind: "check_adv", skills: ["perception", "investigation"], about: "traps" }] }),
  // "Advantage on Stealth while in ruins or wreckage".
  row("Silent Salvage", ["scavenger"], { effects: [{ kind: "check_adv", skills: ["stealth"], about: "ruins" }] }),
  // "Advantage on checks to climb, balance, and keep footing": Athletics to
  // climb, Acrobatics to balance and to stay standing.
  row("Sky Legs", ["aeronaut"], { effects: [{ kind: "check_adv", skills: ["athletics", "acrobatics"], about: "footing" }] }),
  // "Advantage on Intimidation and Persuasion aboard ships and in ports".
  row("Corsair's Swagger", ["aeronaut"], { effects: [{ kind: "check_adv", skills: ["intimidation", "persuasion"], about: "ships" }] }),
  // "Advantage on Investigation checks in places where someone died violently".
  row("Automatic Writing", ["parapsychologist"], { effects: [{ kind: "check_adv", skills: ["investigation"], about: "violent_death" }] }),

  // ---- checks against a kind of creature (the call's `creature`) ----
  // "Advantage on Intimidation against travelers, traders, and rival crews".
  row("Reaver's Toll", ["road_warrior"], { effects: [{ kind: "check_adv", skills: ["intimidation"], creatures: ["traveler", "trader", "merchant", "crew"] }] }),
  // "Advantage on Intimidation and Persuasion against raiders, cultists, and
  // the desperate": a raider is the SRD's bandit, a cultist its cultist.
  row("Shepherd's Stare", ["waste_preacher"], { effects: [{ kind: "check_adv", skills: ["intimidation", "persuasion"], creatures: ["raider", "bandit", "cultist", "desperate"] }] }),
];
