// The mystery classes' features the fifth pass built (WAVE2 D5: "The genre
// classes' text is the rule, played on the SRD 5.1 engine"), as rows of the
// authored layer beside src/lib/srd/authored-effects-genre-b.ts's: the text is
// src/lib/classes/mystery-features.json's, each row is found by feature name
// and held to its class so a name another class shares never runs as this one.
//
// A row here is read by the authored engines (passive effects, spends on the
// feature's own counter, reactions). What a feature does that no authored
// shape says lives in src/lib/dm/genre-b-mystery-*.ts, named beside its row.
//
// Pure data; no database.
import type { AuthoredEntry, ReactionDoes, SpendAction, SpendDoes } from "@/lib/srd/authored-effects-types";
import type { GenreRow } from "@/lib/srd/authored-effects-genre";
import { QUIET_COURT } from "@/lib/srd/genre-b-mystery-conditions";
import type { TriggerSpec } from "@/lib/srd/trigger-table";

const mystery = (effect: string, target?: "enemy" | "ally"): SpendDoes => ({ kind: "mystery", effect, ...(target ? { target } : {}) });

const row = (feature: string, classes: string[], entry: Omit<AuthoredEntry, "subclass">): GenreRow => ({
  feature,
  classes,
  entry: { subclass: "genre", ...entry },
});

function spend(feature: string, classes: string[], counter: string, action: SpendAction | undefined, does: SpendDoes): GenreRow {
  return { feature, classes, entry: { subclass: "genre", counter, spends: [{ name: feature, pool: { id: counter }, ...(action ? { action } : {}), does }] } };
}


// A spend with no counter: taken whenever the story allows, at no cost of the turn.
function atWill(feature: string, classes: string[], does: SpendDoes): GenreRow {
  return { feature, classes, entry: { subclass: "genre", spends: [{ name: feature, action: "none", does }] } };
}

function react(feature: string, classes: string[], counter: string, does: ReactionDoes): GenreRow {
  return { feature, classes, entry: { subclass: "genre", counter, reactions: [{ name: feature, pool: { id: counter }, does }] } };
}

export const GENRE_B_MYSTERY_AUTHORED: GenreRow[] = [
  // ---- enforcer ----
  // "Advantage against being moved, knocked prone, or grappled": the saves an
  // enemy's blow forces against being knocked prone or grappled
  // (src/lib/dm/enemy-hit.ts resolveOnHit names them); the escape from a
  // grapple is src/lib/srd/genre-b-combat.ts genreEscapeAdvantage, and "your
  // grapples escape at disadvantage" genreGripDisadvantage. No enemy rider or
  // area the engine rolls pushes a character on a save of its own, so being
  // moved has no roll to give advantage on.
  row("Immovable", ["enforcer"], { effects: [{ kind: "save_adv", against: ["prone", "grappled"] }] }),

  // "1/long rest, you and all allies within 30 ft each gain a reaction attack
  // when any one of you is hit, for 1 minute": the strike is called as one of
  // them is hit, with the enforcer's reaction, which spends the use, lays the
  // strike on those within 30 feet for the minute and is the enforcer's own
  // attack; after that each striker answers a hit on any of them with one
  // weapon attack at the creature that landed it. Every call is
  // src/lib/dm/genre-b-mystery-reactions.ts generalStrike; this row tells the
  // Hand and use_resource that the counter is the reaction's.
  {
    feature: "General Strike",
    classes: ["enforcer"],
    entry: {
      subclass: "genre",
      counter: "mystery_general_strike",
      reactions: [{ name: "General Strike", pool: { id: "mystery_general_strike" }, does: { kind: "attack", rangeFt: 600 } }],
    },
  },

  // ---- spirit medium ----
  // "Bonus action: a shielding spirit grants you or an ally +2 AC until your
  // next turn"; Chorus of the Dead: "Spirit Ward can protect two creatures at
  // once and also grants advantage on their next save".
  spend("Spirit Ward", ["spirit_medium"], "mystery_spirit_ward", "bonus", mystery("spirit_ward", "ally")),
  // Chorus of the Dead is read by Spirit Ward's spend; the row says where.
  row("Chorus of the Dead", ["spirit_medium"], { heldBy: { file: "src/lib/dm/genre-b-mystery-spends.ts", call: "spiritWard" } }),
  // "A bound protective spirit follows you: 1/rest, it negates one attack that
  // would hit you": taken as the blow lands, as every answer to a hit is on
  // the SRD 5.1 engine (a reaction, which the Hand deals with the hit), and
  // only for a hit on the medium (src/lib/dm/genre-b-mystery-reactions.ts).
  react("Guardian Shade", ["spirit_medium"], "mystery_guardian_shade", { kind: "force_miss", exhaustion: 0 }),
  // "1/long rest, lay a spirit to rest or release a possession without a
  // contest; hostile entities get a CHA save."
  spend("Ferrywoman's Due", ["spirit_medium"], "mystery_ferrywoman_s_due", "action", mystery("ferrywoman", "enemy")),
  // "1/long rest, when a creature within 30 ft dies, hold its spirit".
  spend("Anchor of the Living", ["spirit_medium"], "mystery_anchor_of_the_living", "none", mystery("anchor", "ally")),
  // "1/long rest, call a procession of spirits: for 1 minute they obscure,
  // terrify (WIS save), and strike (2d8 necrotic) as you direct."
  {
    feature: "Queen of the Quiet Court",
    classes: ["spirit_medium"],
    entry: {
      subclass: "genre",
      counter: "mystery_queen_of_the_quiet_court",
      spends: [
        { name: "Queen of the Quiet Court", pool: { id: "mystery_queen_of_the_quiet_court" }, action: "action", does: mystery("quiet_court", "enemy") },
        { name: "Direct the Procession", aliases: ["Quiet Court"], action: "action", gate: { condition: QUIET_COURT, because: "the procession is called (Queen of the Quiet Court)" }, does: mystery("quiet_court_direct", "enemy") },
      ],
    },
  },

  // ---- alienist ----
  // "During a short rest, one creature you counsel regains an extra hit die of
  // HP and ends one fear or charm effect"; Depth Analysis: "two creatures per
  // rest and also removes one level of exhaustion". The short rest applies
  // both as it ends.
  row("Talking Cure", ["alienist"], { heldBy: { file: "src/lib/dm/rest-tools.ts", call: "talkingCure(" } }),
  row("Depth Analysis", ["alienist"], { heldBy: { file: "src/lib/dm/genre-b-mystery-rest.ts", call: "Depth Analysis" } }),
  // "1/long rest, a willing or restrained creature answers three questions
  // truthfully under trance (WIS save resists if unwilling)."
  spend("Hypnotic Induction", ["alienist"], "mystery_hypnotic_induction", undefined, mystery("hypnotic", "enemy")),
  // "1/long rest, read a sleeping or unconscious creature's dreams for three
  // true impressions": refused for a creature that is awake.
  spend("The Unconscious Speaks", ["alienist"], "mystery_the_unconscious_speaks", undefined, mystery("dreams", "enemy")),
  // "1/long rest, cure a creature of a long-term madness, phobia, or
  // compulsion, including magical ones": what the board holds of them, a
  // madness the GM laid by name and the fear or charm a spell left
  // (src/lib/dm/genre-b-cure.ts). The text names no reach: the patient is in
  // the alienist's hearing, as Break the Delusion's is.
  spend("Radical Breakthrough", ["alienist"], "mystery_radical_breakthrough", undefined, { kind: "cure", ends: ["madness", "long-term madness", "indefinite madness", "phobia", "compulsion", "frightened", "charmed"], rangeFt: 30 }),

  // "your treatments treat one target's saving throw as if it rolled a 1":
  // the creature named, on its next save against the alienist's spell
  // (src/lib/dm/genre-b-mystery-dossier.ts treatmentUndoes).
  spend("Archetype Made Flesh", ["alienist"], "mystery_archetype_made_flesh", "none", mystery("archetype", "enemy")),
  // "cast one treatment of 5th level or lower without a slot; it cannot be
  // resisted by creatures you have a Trauma Map of" (the slotless mark is
  // src/lib/dm/genre-b-free-cast.ts's).
  spend("The Examined Mind", ["alienist"], "mystery_the_examined_mind", undefined, mystery("examined_mind")),
  // The files (src/lib/dm/genre-b-mystery-dossier.ts): at will, on a creature
  // of the fight or a person named in the variant.
  atWill("Trauma Map", ["alienist"], mystery("trauma_map", "enemy")),
  atWill("Case Study", ["alienist"], mystery("case_study", "enemy")),
  atWill("Nemesis Study", ["detective"], mystery("nemesis", "enemy")),
  // "A creature that has believed one of your lies has disadvantage on Insight
  // against you thereafter": social_check keeps the file and reads it.
  row("Sunk Cost", ["grifter"], { heldBy: { file: "src/lib/dm/social-tools.ts", call: "socialEdge(" } }),

  // "Advantage on Persuasion with laborers, dockhands, and the working poor":
  // the people the enforcer has on file as working folk (the same files).
  atWill("Working Class Hero", ["enforcer"], mystery("working_folk", "enemy")),

  // ---- muckraker ----
  // "A creature you surprise with a question answers before thinking: one
  // truthful sentence (WIS save negates)."
  atWill("Doorstep Ambush", ["muckraker"], mystery("doorstep", "enemy")),
  // "you cannot be surprised by creatures you have investigated": the creature
  // named goes on file; "Advantage on initiative" is the row's own effect.
  { feature: "Two Steps Ahead", classes: ["muckraker"], entry: { subclass: "genre", effects: [{ kind: "init_adv" }], spends: [{ name: "Investigated", aliases: ["Two Steps Ahead"], action: "none", does: mystery("investigated", "enemy") }] } },
  // "Advantage on checks made under time pressure": whether the clock is on a
  // check is the GM's to say, so the spend is theirs (no card in the Hand).
  { feature: "Print Deadline", classes: ["muckraker"], entry: { subclass: "genre", spends: [{ name: "Print Deadline", action: "none", gm: true, does: mystery("deadline") }] } },
  // "1/long rest, publish the truth: a named creature's public standing
  // collapses, and its allies must save (WIS) or abandon it."
  spend("The Story of the Century", ["muckraker"], "mystery_the_story_of_the_century", undefined, mystery("story", "enemy")),
];

// What the trigger-shaped rows above answer (src/lib/srd/trigger-table.ts
// WRITTEN): refused with nothing on record, and dealt by the Hand when the
// trigger comes, never as a card on the holder's own turn.
export const GENRE_B_MYSTERY_TRIGGERS: Record<string, TriggerSpec> = {
  "general strike": { on: [{ kind: "hit_seen", rangeFt: 30 }], what: "an attack that has just hit one of the strikers", aimsAt: true },
  mystery_anchor_of_the_living: { on: [{ kind: "death", rangeFt: 30 }], what: "a creature dying within 30 feet of them" },
};
