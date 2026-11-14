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

// A ward set out of a fight; `counter`: its uses (Grounding Rig's one a long rest).
const ward = (classId: string, feature: string, play: string, why: string, counter?: string): GenreRow =>
  row(feature, [classId], {
    ...(counter ? { counter } : {}),
    spends: [{ name: feature, ...(counter ? { pool: { id: counter } } : {}), action: "none", fight: "out", outOfFightWhy: why, does: { kind: "horror_spend", play } }],
  });

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
  // "1/long rest, your next apparatus spell is cast at maximum effect and
  // cannot be resisted by legendary resistance": the mark of the turn
  // (src/lib/dm/genre-gh-proof.ts reads it).
  row("Proof", ["parapsychologist"], { counter: "horror_proof", spends: [{ name: "Proof", pool: { id: "horror_proof" }, action: "none", does: { kind: "buff", condition: "proof", rounds: 1 } }] }),
  // "1/long rest, duplicate a stigmata of 2nd level or lower you just cast
  // at a second target for free": the mark of the turn, which the next cast
  // of 2nd level or lower spends in place of a slot (src/lib/dm/genre-a-casts.ts).
  row("Ritual Echo", ["apostate"], { counter: "horror_ritual_echo", spends: [{ name: "Ritual Echo", pool: { id: "horror_ritual_echo" }, action: "none", does: { kind: "buff", condition: "ritual echo", rounds: 1 } }] }),
  // "1/long rest, for 1 minute your stigmata cost no verbal or somatic
  // components and cannot be counterspelled" (src/lib/dm/genre-gh-proof.ts).
  row("The Rite Completed", ["apostate"], { counter: "horror_the_rite_completed", spends: [{ name: "The Rite Completed", pool: { id: "horror_the_rite_completed" }, action: "none", does: { kind: "buff", condition: "the rite completed", rounds: 10 } }] }),
  // The wards (src/lib/dm/genre-gh-wards.ts): minutes of work, so never in a
  // fight; the area holds at the place it was set for the hours given.
  ward("exorcist", "Sanctified Ground", "sanctified_ground", "is ten minutes of ritual (one with Wax and Wick), never made in the middle of a fight"),
  ward("occultist", "Warding Sigil", "warding_sigil", "is a minute of chalk-work, never made in the middle of a fight"),
  ward("parapsychologist", "Grounding Rig", "grounding_rig", "is a ten-minute setup, never made in the middle of a fight", "horror_grounding_rig"),
  // "Craft stakes, salt lines, and wardings during a rest; a warding gives one
  // ally +2 AC against one monster type for a night" (the whole party with
  // Stake and Salt): src/lib/dm/genre-gh-wards.ts huntersKit.
  row("Hunter's Kit", ["slayer"], { spends: [{ name: "Hunter's Kit", aliases: ["Warding"], action: "none", fight: "out", outOfFightWhy: "is crafted during a rest, never in the middle of a fight", does: { kind: "horror_spend", play: "hunters_kit", aim: "ally" } }] }),
  played("occultist", "Stitch the Tear", "horror_stitch_the_tear", "action", "stitch_the_tear", "enemy"),
];
