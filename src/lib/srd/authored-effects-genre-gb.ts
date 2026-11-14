// Genre features of the horror, post-apocalyptic and steampunk classes wired
// in the cc1113 completeness pass (ids GB..), as rows of the authored layer the
// way src/lib/srd/authored-effects-genre-b.ts holds the earlier passes'. Each
// row names its class so a same-named feature of another class never runs as
// this one; their text is src/lib/classes/<genre>-features.json. Registered in
// GENRE_AUTHORED (src/lib/srd/authored-effects-genre.ts) with one line.
//
// Pure data; no database.
import type { AuthoredEffect, AuthoredEntry, SpendDoes } from "@/lib/srd/authored-effects-types";
import type { GenreRow } from "@/lib/srd/authored-effects-genre";
import { ARC_LAMP, EAR_TRUMPET, GRAPNEL, LAST_RIDE, POCKET_SHIELD, ROAD_RAGE, SKELETON_KEY } from "@/lib/srd/genre-gb-conditions";

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

  // ---- the road warrior's run ----
  // "1/long rest, for 1 minute your speed doubles, Ram Speed deals +4d6, and
  // you resist all damage": the spend lays the minute (its speed is the
  // condition's row, genre-gb-conditions.ts); the dice ride Ram Speed's run as
  // Ram Speed's own do (genre-a-strikes.ts afterRunFt). No action is named, so
  // the ride costs none.
  row("Last Ride of the Reaver", ["road_warrior"], {
    counter: "post_apocalyptic_last_ride_of_the_reaver",
    effects: [
      { kind: "hit_rider", dice: "4d6", when: "melee", afterRunFt: 20, gate: { condition: LAST_RIDE } },
      { kind: "resist", types: "all", gate: { condition: LAST_RIDE } },
    ],
    spends: [{ name: "Last Ride of the Reaver", pool: { id: "post_apocalyptic_last_ride_of_the_reaver" }, action: "none", does: { kind: "buff", condition: LAST_RIDE, rounds: 10 } }],
  }),

  // ---- the gadgeteer's gadgets (src/lib/srd/options.ts "gadget") ----
  // "Pick two gadgets (grapnel, smoke bomb, arc lamp, ear trumpet, skeleton
  // key, pocket shield); each usable INT-mod times per rest with sensible
  // effects": each pick is held as "Gadget: <name>" with a counter of its own
  // (src/lib/srd/authored-resources.json, INT-mod uses back on any rest), and
  // its use is a bonus action that does what the pick's line says. Each is
  // once a turn: Chain Deployment's second use is a different gadget
  // (src/lib/srd/genre-b-steampunk-attacks.ts freeSpendKey).
  gadget("Grapnel", { kind: "buff", condition: GRAPNEL, rounds: 1 }),
  gadget("Smoke Bomb", { kind: "zone", lays: "smoke bomb", rangeFt: 30, upgrade: { feature: "Smoke Discipline", lays: "disciplined smoke", seesThrough: true } }),
  // Third Gadget (6th): "gadget saves against your effects use 8 +
  // proficiency + INT". The lamp's flash is the gadget a creature saves
  // against: thrown open at one creature within 30 feet that can see it, a
  // CON save or blinded until the end of its next turn, from the same uses.
  withSpend(gadget("Arc Lamp", { kind: "light", brightFt: 30, dimFt: 30, condition: ARC_LAMP }), {
    name: "Arc Lamp Flash",
    pool: { id: "steampunk_gadget_arc_lamp" },
    action: "bonus",
    oncePerTurn: true,
    does: { kind: "save_effect", save: "con", dcAbility: "int", rangeFt: 30, condition: "blinded", rounds: 1 },
  }),
  gadget("Ear Trumpet", { kind: "buff", condition: EAR_TRUMPET, rounds: 10 }, [{ kind: "check_adv", skills: ["perception"], gate: { condition: EAR_TRUMPET } }]),
  gadget("Skeleton Key", { kind: "buff", condition: SKELETON_KEY, rounds: 1 }, [{ kind: "check_adv", abilities: ["dex"], gate: { condition: SKELETON_KEY } }]),
  gadget("Pocket Shield", { kind: "buff", condition: POCKET_SHIELD, rounds: 1 }, [{ kind: "ac", amount: 2, gate: { condition: POCKET_SHIELD } }]),
  // "A hooked chain (1d8 piercing, 15-ft reach)": a weapon the feature is,
  // proficient (src/lib/dm/genre-gb-hook.ts gives it its reach and drag).
  row("Chained Hook", ["road_warrior"], { effects: [{ kind: "natural_weapon", weapon: { name: "Chained Hook", aliases: ["hooked chain", "chain"], dice: "1d8", type: "piercing", reach: true } }] }),
  // "1/rest, when an ally within 30 ft drops to 0 HP, immediately move your
  // speed and make one attack": the drop marks the warrior (genre-gb-road-rage.ts),
  // and the mark answers one weapon attack, which spends the use.
  row("Road Rage", ["road_warrior"], {
    counter: "post_apocalyptic_road_rage",
    reactions: [{ name: "Road Rage", pool: { id: "post_apocalyptic_road_rage" }, gate: { condition: ROAD_RAGE }, does: { kind: "attack", rangeFt: 5, weaponRange: true } }],
  }),

  // ---- the machinist's familiars (src/lib/dm/genre-gb-familiars.ts) ----
  // Clockwork Familiar: the free card builds it out of a fight; its help,
  // "advantage on one check per rest", is its own card from a counter.
  row("Clockwork Familiar", ["machinist"], {
    counter: "steampunk_clockwork_familiar",
    spends: [
      { name: "Clockwork Familiar", action: "none", fight: "out", does: { kind: "genre_summon", companion: "familiar" } },
      { name: "Familiar's Help", pool: { id: "steampunk_clockwork_familiar" }, action: "none", does: { kind: "genre_summon", companion: "familiar_help" } },
    ],
  }),
  // The Great Work Walks: "1/long rest, your familiars merge into a brass
  // juggernaut for 10 minutes". No action is named, so the merge costs none.
  row("The Great Work Walks", ["machinist"], {
    counter: "steampunk_the_great_work_walks",
    spends: [{ name: "The Great Work Walks", pool: { id: "steampunk_the_great_work_walks" }, action: "none", does: { kind: "genre_summon", companion: "juggernaut" } }],
  }),

  // ---- the aeronaut (src/lib/dm/genre-gb-aeronaut.ts) ----
  // Grapnel Line: "swing or pull yourself 30 ft as part of your movement,
  // INT-mod uses per rest": the line carries the aeronaut 30 feet to the
  // square named, over what lies between, no action.
  row("Grapnel Line", ["aeronaut"], {
    counter: "steampunk_grapnel_line",
    spends: [{ name: "Grapnel Line", pool: { id: "steampunk_grapnel_line" }, action: "none", does: { kind: "teleport", feet: 30, note: "swung or pulled along the grapnel line, as part of the move" } }],
  }),
  // Grapnel Ace: "Grapnel Line can also disarm or trip (contested by STR) at
  // 30 ft", from the line's uses.
  row("Grapnel Ace", ["aeronaut"], {
    spends: [
      { name: "Grapnel Trip", pool: { id: "steampunk_grapnel_line" }, action: "none", does: { kind: "steampunk", what: "grapnel", mode: "trip" } },
      { name: "Grapnel Disarm", pool: { id: "steampunk_grapnel_line" }, action: "none", does: { kind: "steampunk", what: "grapnel", mode: "disarm" } },
    ],
  }),
  // Boarding Action: "1/rest, when combat starts, immediately move your speed
  // and make one attack".
  row("Boarding Action", ["aeronaut"], {
    counter: "steampunk_boarding_action",
    spends: [{ name: "Boarding Action", pool: { id: "steampunk_boarding_action" }, action: "none", does: { kind: "steampunk", what: "boarding" } }],
  }),
  // Legend of the Skies: "When you roll initiative, gain a full extra turn
  // before the first round begins": once a fight, its mark outlasting the
  // first round.
  row("Legend of the Skies", ["aeronaut"], {
    spends: [{ name: "Legend of the Skies", action: "none", oncePer: { marker: "legend of the skies", rounds: 10 }, does: { kind: "steampunk", what: "extra_turn" } }],
  }),

  // Broadside: "1/rest, fire at up to three targets in a 15-ft cone with a
  // single attack roll each": the turn's mark, then pc_attack with volley
  // (src/lib/dm/genre-gb-broadside.ts).
  row("Broadside", ["aeronaut"], {
    counter: "steampunk_broadside",
    spends: [{ name: "Broadside", pool: { id: "steampunk_broadside" }, action: "none", does: { kind: "buff", condition: "broadside", rounds: 1 } }],
  }),

  // Difference Engine Mind: "1/rest, take the calculated answer: treat one
  // INT-based check as a natural 20" (src/lib/dm/genre-gb-calculated.ts).
  row("Difference Engine Mind", ["machinist"], {
    counter: "steampunk_difference_engine_mind",
    spends: [{ name: "Difference Engine Mind", pool: { id: "steampunk_difference_engine_mind" }, action: "none", does: { kind: "buff", condition: "calculated answer", rounds: 600 } }],
  }),

  // ---- the alchemist's formulae (src/lib/dm/genre-gb-alchemy.ts) ----
  // Corrosive Focus: "you may change any formula's damage type to acid": a
  // free card, the choice the text gives, for the turn.
  row("Corrosive Focus", ["alchemist"], { spends: [{ name: "Corrosive Focus", action: "none", does: { kind: "buff", condition: "acid formula", rounds: 1 } }] }),
  // Stone of the Magnum Opus: "Catalyst Stone can instead reroll all of a
  // formula's dice, keeping the better total": the stone's other card, from
  // its uses.
  row("Stone of the Magnum Opus", ["alchemist"], {
    spends: [{ name: "Catalyst Stone (reroll)", pool: { id: "steampunk_catalyst_stone" }, action: "none", does: { kind: "buff", condition: "catalyst reroll", rounds: 10 } }],
  }),
];

function withSpend(base: GenreRow, spend: NonNullable<AuthoredEntry["spends"]>[number]): GenreRow {
  return { ...base, entry: { ...base.entry, spends: [...(base.entry.spends ?? []), spend] } };
}

function gadget(name: string, does: SpendDoes, effects: AuthoredEffect[] = []): GenreRow {
  const counter = `steampunk_gadget_${name.toLowerCase().replace(/ /g, "_")}`;
  return row(`Gadget: ${name}`, ["gadgeteer"], {
    counter,
    ...(effects.length ? { effects } : {}),
    spends: [{ name, pool: { id: counter }, action: "bonus", oncePerTurn: true, does }],
  });
}
