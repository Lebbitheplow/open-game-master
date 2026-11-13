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
import { CANDLE } from "@/lib/srd/genre-cc-a-conditions";

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

  // "1/rest, drop through a grate, crack, or shadow as a reaction when
  // targeted; the attack misses and you move 15 ft": the hit on the vermin
  // lord turned to a miss, and the move to the square use_reaction names.
  {
    feature: "Vanish Below",
    classes: ["vermin_lord"],
    entry: { subclass: "genre", counter: "dark_fantasy_vanish_below", reactions: [{ name: "Vanish Below", pool: { id: "dark_fantasy_vanish_below" }, does: { kind: "force_miss", exhaustion: 0, moveFt: 15 } }] },
  },
  // "1/rest, emit bright warding light 20 ft for 10 minutes; hostile undead
  // and fiends in it have disadvantage on attacks against your allies"
  // (src/lib/dm/authored-hooks.ts reads attacked_disadv with a reach: every
  // attack such a creature makes within it).
  {
    feature: "Candle in the Dark",
    classes: ["witch_hunter"],
    entry: {
      subclass: "genre",
      counter: "dark_fantasy_candle_in_the_dark",
      effects: [{ kind: "attacked_disadv", from: ["undead", "fiend"], rangeFt: 20, gate: { condition: CANDLE } }],
      spends: [{ name: "Candle in the Dark", pool: { id: "dark_fantasy_candle_in_the_dark" }, action: "action", does: { kind: "genre_cc", play: "candle" } }],
    },
  },
  // "1/long rest, take an extra full turn immediately after killing your branded quarry".
  counted("witch_hunter", "No Rest for the Wicked", "dark_fantasy_no_rest_for_the_wicked", "none", { kind: "genre_cc", play: "no_rest" }),
  // "1/long rest, sing a fallen ally within a minute of death back to 1 HP without material components".
  counted("dirgesinger", "The Rite Completed", "dark_fantasy_the_rite_completed", "action", { kind: "genre_cc", play: "rite", aim: "ally" }),
  // "1/rest, repeat the last dirge you cast this turn at a new target for free (3rd level or lower)".
  counted("dirgesinger", "Elegy of Echoes", "dark_fantasy_elegy_of_echoes", "none", { kind: "genre_cc", play: "elegy" }),
  // "Stores one program of level 1-3; cast it once without a slot per long
  // rest" (and with Daemon Cache (2 programs), "two programs of level 1-5").
  counted("netrunner", "Daemon Cache", "cyberpunk_daemon_cache", "none", { kind: "genre_cc", play: "daemon_cache" }),
  // Grief Made Strength and Controlled Dosage answer what happens to others
  // (src/lib/dm/genre-cc-a-dark-fantasy-more.ts).
  { feature: "Grief Made Strength", classes: ["dirgesinger"], entry: { subclass: "genre", heldBy: { file: "src/lib/dm/pc-damage.ts", call: "griefMadeStrength(" } } },
  { feature: "Controlled Dosage", classes: ["plague_doctor"], entry: { subclass: "genre", heldBy: { file: "src/lib/dm/heal-spell.ts", call: "controlledDosage(" } } },

  // "Advantage on saves against effects that would sever or hijack control
  // of your drones": the rigger's saves against what takes their command
  // away (charmed, and the conditions that leave them unable to act).
  row("rigger", "Hardened Uplink", [{ kind: "save_adv", against: ["charmed", "stunned", "paralyzed", "incapacitated", "unconscious"] }]),
  // Evasive Subroutines is the drones' (src/lib/dm/genre-cc-a-drones.ts).
  { feature: "Evasive Subroutines", classes: ["rigger"], entry: { subclass: "genre", heldBy: { file: "src/lib/dm/aoe-characters.ts", call: "droneEvades(" } } },

  // "2/long rest, 10 minutes of tinkering ... gives a tool user +1d4 for 1 hour".
  counted("rigger", "Jury-Rig", "cyberpunk_jury_rig", "action", { kind: "genre_cc", play: "jury_rig", aim: "ally" }),
  // The fixer (src/lib/dm/genre-cc-a-fixer.ts).
  { feature: "Silver Ledger", classes: ["fixer"], entry: { subclass: "genre", heldBy: { file: "src/lib/dm/shop-tools.ts", call: "sellsAtFullValue(" } } },
  { feature: "Neutral Ground", classes: ["fixer"], entry: { subclass: "genre", spends: [{ name: "Neutral Ground", action: "none", does: { kind: "genre_cc", play: "parley", aim: "enemy" } }] } },
  { feature: "Exit Strategy", classes: ["fixer"], entry: { subclass: "genre", spends: [{ name: "Exit Strategy", action: "none", does: { kind: "genre_cc", play: "exit" } }] } },

  // Anathema Ward's and Wight-Iron Will's saves ride their older rows
  // (src/lib/srd/authored-effects-genre-a.ts), and Ashen Hymn's reach on the
  // enemies' fear saves is src/lib/dm/genre-cc-a-saves.ts's.

  {
    feature: "Silver Tongue",
    classes: ["grifter"],
    entry: { subclass: "genre", counter: "mystery_silver_tongue", spends: [{ name: "Silver Tongue", pool: { id: "mystery_silver_tongue" }, action: "none", does: { kind: "mystery", effect: "silver_tongue" } }] },
  },
];
