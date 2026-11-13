// The cyberpunk, dark fantasy and mystery features the creator audit of
// 2026-11-13 (its second genre pass) wired into the engine: rows of the
// authored layer in the shapes of src/lib/srd/authored-effects-genre-a.ts,
// each held to its class so a shared name never runs as another class's
// feature. The ledgers (scripts/clauses/genre-cyberpunk.json,
// genre-dark-fantasy.json, genre-mystery.json) say which clause each row
// holds. Kept apart from the older genre files so the genre branches each
// append to a file of their own.
//
// Pure data; no database.
import type { Ability, AuthoredEffect, AuthoredEntry, SpendAction, SpendDoes } from "@/lib/srd/authored-effects-types";
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

const EVERY: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

const row = (classId: string, feature: string, effects: AuthoredEffect[], more: Partial<AuthoredEntry> = {}): GenreRow => ({
  feature,
  classes: [classId],
  entry: { subclass: "genre", effects, ...more },
});

// A spend on the feature's own counter.
const counted = (classId: string, feature: string, counter: string, action: SpendAction, does: SpendDoes): GenreRow => ({
  feature,
  classes: [classId],
  entry: { subclass: "genre", counter, spends: [{ name: feature, pool: { id: counter }, action, does }] },
});

export const GENRE_CC_A_AUTHORED: GenreRow[] = [
  // "Advantage on CHA checks with mourners, undead, and those who serve
  // death": a check about an undead creature (the roll's `creature`), or
  // about the mourners and servants of death (the roll's `about`).
  row("grave_knight", "Funerary Grace", [
    { kind: "check_adv", abilities: ["cha"], creatures: ["undead"] },
    { kind: "check_adv", abilities: ["cha"], about: "death_rites" },
  ]),
  // "Advantage on checks to source rare reagents, poisons, and cadavers in
  // any settlement": any check the GM calls about that sourcing.
  row("plague_doctor", "Guild Dues", [{ kind: "check_adv", abilities: EVERY, about: "rare_reagents" }]),

  // "1/short rest, reroll a failed Deception or Persuasion check": the
  // grifter's last failed check of either skill, rolled again
  // (src/lib/dm/genre-cc-a-checks.ts rerollFailedCheck through the mystery
  // spends); refused with nothing spent when the last failure was another.
  // The dark fantasy areas (src/lib/battlemap/zones-genre-cc-a.ts).
  // "1/long rest, a 20-ft radius circle for 10 minutes: enemies treat it as
  // difficult terrain and take 2d6 poison entering (CON save halves)".
  counted("plague_doctor", "Quarantine Ring", "dark_fantasy_quarantine_ring", "action", { kind: "zone", lays: "quarantine ring", dcAbility: "int" }),
  // "1/long rest, a 20-ft radius garden of black roses for 1 minute: allies
  // in it regain 1d6 HP per turn, enemies are slowed".
  counted("grave_knight", "Garden of Grief", "dark_fantasy_garden_of_grief", "action", { kind: "zone", lays: "garden of grief" }),
  // "1/rest, a swarm floods a 15-ft cube" (src/lib/dm/genre-cc-a-spends.ts).
  counted("vermin_lord", "Rat Tide", "dark_fantasy_rat_tide", "action", { kind: "genre_cc", play: "rat_tide" }),
  // "1/long rest, for 1 minute every enemy within 30 ft is swarmed".
  counted("vermin_lord", "The Crown Descends", "dark_fantasy_the_crown_descends", "action", { kind: "genre_cc", play: "crown" }),

  {
    feature: "Silver Tongue",
    classes: ["grifter"],
    entry: { subclass: "genre", counter: "mystery_silver_tongue", spends: [{ name: "Silver Tongue", pool: { id: "mystery_silver_tongue" }, action: "none", does: { kind: "mystery", effect: "silver_tongue" } }] },
  },
];
