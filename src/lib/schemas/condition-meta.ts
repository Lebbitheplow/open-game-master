// The metadata kept beside a sheet's (or an enemy's) plain conditions list.
// Split from sheet.ts, which re-exports the schema and its type.

import { z } from "zod";
import { ABILITIES } from "@/lib/schemas/abilities";

// The longest lifetime a count of rounds can hold: a year. Spells that last
// days (Geas's thirty, Contagion's seven) are counted in rounds like every
// other duration, ten to the minute; "until dispelled" carries no count.
export const ROUND_CEILING = 365 * 24 * 60 * 10;

// One instance of a condition: its lifetime, its source, what ends it.
const conditionInstanceSchema = z.object({
    // Rounds left. A long duration is stored in rounds too (Mage Armor's
    // eight hours is 4800, Geas's thirty days 432000).
    rounds: z.number().int().min(1).max(ROUND_CEILING).optional(),
    // What put the condition there: the spell, feature or hazard by name.
    source: z.string().trim().min(1).max(80).optional(),
    // Each character a creature has withstood, where one mark answers several
    // (Instinctive Charm).
    sources: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    // Set by the engine on a condition it has renewed (a rage kept going).
    stoked: z.boolean().optional(),
    // "Until the start of your next turn" (Dodge, Shield, the Protection
    // style): the id of the combatant whose turn ends it, a characterId or
    // an enemyId. Such a condition is not counted in rounds; the initiative
    // pointer ends it on reaching that combatant
    // (src/lib/dm/condition-tick.ts startTurnConditions).
    untilTurnOf: z.string().trim().min(1).max(80).optional(),
    // "Until the end of your next turn" (Stunning Strike, Guiding Bolt): the
    // combatant whose next turn's END ends it; turnBegun marks that turn as
    // started (src/lib/dm/turn-end.ts).
    untilTurnEndOf: z.string().trim().min(1).max(80).optional(),
    turnBegun: z.boolean().optional(),
    // Flesh to Stone's count of saves (src/lib/dm/spell-turn-end.ts).
    tally: z.object({ passed: z.number().int().min(0).max(3), failed: z.number().int().min(0).max(3) }).optional(),
    saveEnds: z
      .object({
        ability: z.enum(ABILITIES),
        dc: z.number().int().min(1).max(30),
        // The other ability the creature may choose instead (Nature's Wrath).
        or: z.enum(ABILITIES).optional(),
        // Saved against only while farther than this from the source (Dreadful Aspect).
        beyondFeet: z.number().int().min(5).max(300).optional(),
      })
      .optional(),
    // The spell that laid the condition down, and the slot it was cast
    // from (src/lib/dm/spell-effects.ts): a broken concentration ends only
    // that spell's conditions, and an aura rolls the slot's dice.
    spell: z.string().trim().min(1).max(80).optional(),
    slotLevel: z.number().int().min(0).max(9).optional(),
    // A casting held across turns cast as a ritual, which spends no slot
    // when it completes (src/lib/dm/long-casting-logic.ts).
    ritual: z.boolean().optional(),
  // A casting going into a Ring of Spell Storing, or coming out of one.
  storeIn: z.string().max(80).optional(),
  storeInHolder: z.string().max(80).optional(),
  fromRing: z.string().max(80).optional(),
    // Ends when the creature takes damage (Sleep, Hypnotic Pattern), or
    // gives it a new save when it does (Hideous Laughter, Dominate Person).
    endsOnDamage: z.boolean().optional(),
    // Ends once the creature can neither see nor hear its source (Hypnotic
    // Gaze: src/lib/dm/ar-ws-senses-logic.ts).
    endsUnsensed: z.boolean().optional(),
    saveOnDamage: z
      .object({
        ability: z.enum(ABILITIES),
        dc: z.number().int().min(1).max(30),
        advantage: z.boolean().optional(),
      })
      .optional(),
    // Hunter's Mark and Hex: the marked creature's enemyId
    // (src/lib/dm/attack-marks.ts).
    quarry: z.string().trim().min(1).max(80).optional(),
    // A Creation bard's Bardic Inspiration die carries a mote
    // (src/lib/dm/authored-mote.ts).
    mote: z.boolean().optional(),
    // A Valor bard's die may ride a damage roll, an Eloquence bard's is kept
    // by a roll it could not save (src/lib/dm/ar-wbf-bard-dice-logic.ts).
    combat: z.boolean().optional(),
    unfailing: z.boolean().optional(),
    // A monster's grapple prints its escape DC, which the escape is rolled
    // against instead of a contest (src/lib/dm/grapple.ts).
    escapeDc: z.number().int().min(1).max(40).optional(),
    // The Grappler feat's pin: on the grappler's own restraint, the creature
    // they hold pinned; it lasts while that grapple does
    // (src/lib/dm/grappler-pin.ts).
    pinning: z.string().trim().min(1).max(80).optional(),
    // Ends when the creature finishes a long rest (Life Drain, Draining Kiss).
    untilLongRest: z.boolean().optional(),
    // Ends when the rest it was raised for ends, short or long (Hearth of
    // Moonlight and Shadow, src/lib/dm/rest-logic.ts).
    untilRestEnds: z.boolean().optional(),
    // The weapon the effect rides (Sacred Weapon): src/lib/dm/mt-srd-unconscious.ts.
    weapon: z.string().trim().min(1).max(80).optional(),
    // Ends when its holder ends a turn farther than this from the source, or
    // out of its sight (Intimidating Presence): src/lib/dm/mt-srd-barbarian.ts.
    turnEndBeyondFeet: z.number().int().min(5).max(600).optional(),
    // Lasts while this barbarian rages (Call the Hunt): src/lib/dm/rage-bound.ts.
    whileRagingOf: z.string().trim().min(1).max(80).optional(),
    // A knocked-out creature's 1d4 hours to coming to (foe-carry-logic.ts).
    wakeAfterHours: z.number().int().min(1).max(4).optional(),
    // The clock instant (in-world minutes) a commanding charm's running hour
    // began at (Command Undead's hourly save, src/lib/dm/ar-ws-command-hours.ts).
    hourFrom: z.number().int().min(0).optional(),
    // The temporary hit points the effect granted, gone when it ends.
    tempHp: z.number().int().min(1).max(500).optional(),
    // A once-a-turn rider spent: the turn it went in (encounters.ts turnKey),
    // so the next roll of that turn goes without it (Emboldening Bond's d4,
    // src/lib/dm/emboldening-bond-logic.ts).
    usedTurn: z.string().trim().min(1).max(160).optional(),
    // The attuned item a readied Soul of Artifice would end (soul-of-artifice.ts).
    item: z.string().trim().min(1).max(80).optional(),
    // How many of the effect stand on the table (Invoke Duplicity's
    // illusions: one, four with Improved Duplicity).
    count: z.number().int().min(1).max(20).optional(),
    // A Dominate spell's standing order: the combatant its creature was told
    // to attack (src/lib/dm/combat-sides-logic.ts dominationOrderOf).
    order: z.string().trim().min(1).max(80).optional(),
    // Confusion's lash-out: the creature its d10 picked for this round's
    // melee attack (src/lib/dm/confusion.ts).
    lashOut: z.object({ target: z.string().trim().min(1).max(80), round: z.number().int().min(0) }).optional(),
    // Swallowed whole (src/lib/dm/swallow.ts): the damage the creature dealt
    // its swallower, by the creature whose turn it landed in, each read at
    // its turn's end for a regurgitation, and once the swallower dies the
    // feet of movement out of its corpse.
    swallow: z
      .object({
        turns: z.record(z.string().trim().min(1).max(80), z.number().int().min(0).max(100_000)).optional(),
        escapeFeet: z.number().int().min(0).max(120).optional(),
      })
      .optional(),
    // A Cloud Rune knight's answers at the stops before hits' damage
    // (src/lib/dm/cloud-rune.ts): which swing of whose attack on whom, and
    // the creature it turns onto, or null for one let land.
    cloudTurns: z
      .array(
        z.object({
          attackerId: z.string().trim().min(1).max(80),
          struckId: z.string().trim().min(1).max(80),
          swing: z.number().int().min(0).max(20),
          onto: z.string().trim().min(1).max(80).nullable(),
        }),
      )
      .max(8)
      .optional(),
});

// Duration/save metadata for active conditions, keyed by condition name.
// Lives NEXT TO the plain `conditions` string list so its consumers never
// change; the server maintains both together (src/lib/dm/condition-logic.ts).
// `others` holds further sources of the same condition, each with its own
// lifetime (two casters' Hold Person): the condition holds while any does.
export const conditionMetaSchema = z.record(
  z.string().max(40),
  conditionInstanceSchema.extend({
    others: z.array(conditionInstanceSchema).max(12).optional(),
  }),
);
export type ConditionMetaMap = z.infer<typeof conditionMetaSchema>;
