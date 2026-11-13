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
import type { Ability, AuthoredEffect, AuthoredEntry } from "@/lib/srd/authored-effects-types";
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

const EVERY: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

const row = (classId: string, feature: string, effects: AuthoredEffect[], more: Partial<AuthoredEntry> = {}): GenreRow => ({
  feature,
  classes: [classId],
  entry: { subclass: "genre", effects, ...more },
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
];
