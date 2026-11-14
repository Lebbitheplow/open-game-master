// Horror features wired in the cc1113 genre-c completeness pass (ids GH..),
// as rows of the authored layer the way authored-effects-genre-a-horror.ts
// holds the earlier rounds'. Each row names its class so a same-named
// feature of another class never runs as this one; their text is
// src/lib/classes/horror-features.json, and the ledger
// (scripts/clauses/genre-horror.json) says which clause each row holds.
// Registered in GENRE_AUTHORED (src/lib/srd/authored-effects-genre.ts) with
// one line. Their counters are src/lib/classes/resources.json rows.
//
// Pure data; no database.
import type { AuthoredEntry, SpendAction } from "@/lib/srd/authored-effects-types";
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

const row = (feature: string, classes: string[], entry: Omit<AuthoredEntry, "subclass">): GenreRow => ({ feature, classes, entry: { subclass: "genre", ...entry } });

// A counter whose spend src/lib/dm/genre-gh-horror-plays.ts plays.
// `aim`: the card asks for the ally or the creature the spend is given to.
const played = (classId: string, feature: string, counter: string, action: SpendAction, play: string, aim?: "enemy" | "ally", more: Omit<AuthoredEntry, "subclass" | "counter" | "spends"> = {}): GenreRow =>
  row(feature, [classId], { counter, ...more, spends: [{ name: feature, pool: { id: counter }, action, does: { kind: "horror_spend", play, ...(aim ? { aim } : {}) } }] });

export const GENRE_GH_AUTHORED: GenreRow[] = [
  // "1/rest, when an ally fails an INT, WIS, or CHA save within 30 ft, let
  // them reroll with your guidance": no action is named, so it costs none.
  played("parapsychologist", "Peer Review", "horror_peer_review", "none", "peer_review", "ally"),
  // "1/long rest, reroll any one die you or a creature within 60 ft just
  // rolled; the reroll stands": a save or check by the spend; an attack roll
  // that hit the occultist or an ally, from a creature within 60 feet, by the
  // reaction (the new roll stands, high or low).
  played("occultist", "The Final Chapter", "horror_the_final_chapter", "none", "final_chapter", undefined, {
    reactions: [{ name: "The Final Chapter", pool: { id: "horror_the_final_chapter" }, sees: "attacker", does: { kind: "reroll_hit", rangeFt: 60, roller: true } }],
  }),
  // "1/long rest, a 1-minute ritual expels a possessing entity from a host
  // (contested WIS, you have advantage)": a minute's ritual, so the action.
  played("exorcist", "Rite of Severance", "horror_rite_of_severance", "action", "rite_of_severance", "ally"),
  // "1/long rest, close a portal, summoning, or breach of CR/level 5 or lower as an action".
  played("occultist", "Stitch the Tear", "horror_stitch_the_tear", "action", "stitch_the_tear", "enemy"),
];
