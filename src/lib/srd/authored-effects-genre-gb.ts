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
  gadget("Arc Lamp", { kind: "light", brightFt: 30, dimFt: 30, condition: ARC_LAMP }),
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
];

function gadget(name: string, does: SpendDoes, effects: AuthoredEffect[] = []): GenreRow {
  const counter = `steampunk_gadget_${name.toLowerCase().replace(/ /g, "_")}`;
  return row(`Gadget: ${name}`, ["gadgeteer"], {
    counter,
    ...(effects.length ? { effects } : {}),
    spends: [{ name, pool: { id: counter }, action: "bonus", oncePerTurn: true, does }],
  });
}
