import { turnLedger, writeTurnLedger } from "@/lib/dm/turn-marks";
import { z } from "zod";
import { rollCard } from "@/lib/dm/roll-card";
import { type Campaign } from "@/lib/db/campaigns";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { chargeLifestyle } from "@/lib/dm/lifestyle";
import { MEAL_PROPERTY, MEAL_REFUSAL, mealArg, mealRefused } from "@/lib/dm/supplies-logic";
import { dawnsBetween } from "@/lib/dm/item-charges";
import type { DmTurn } from "@/lib/db/dm-turns";
import { publishWithSeq } from "@/lib/events";
import { asSentence, textKey } from "@/lib/language/text-logic";
import { applyDmMutation } from "@/lib/dm/mutations";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { hourlyConSaves, type HourSave } from "@/lib/dm/endurance";
import {
  hoardItemCount,
  treasureGoldRoll,
  treasureTierForCr,
} from "@/lib/srd/treasure";
import type { ObjectMaterial, ObjectSize } from "@/lib/srd/objects";
import { damageObject } from "@/lib/dm/object-damage";
import { forcedMarchSaveDc, forcedMarchSpan, NORMAL_TRAVEL_HOURS, paceEffect, travelLeg, type TravelPace } from "@/lib/srd/travel";
import { tickWorldTimeskip } from "@/lib/dm/world-tick";
import { pactMoment } from "@/lib/dm/pacts";
import { readUneaseTells } from "@/lib/dm/conscience-voice";
import { advanceClock, getClock, recordMarch, setTravelPace, setWaterRation } from "@/lib/db/clock";
import { getActiveEncounter } from "@/lib/db/encounters";
import { refreshSky } from "@/lib/dm/sky";
import { publishTitleCard } from "@/lib/dm/scene-state";
import { handleApplyHazard } from "@/lib/dm/hazard-tools";
import { describeWeather, weatherExposure, weatherTravelFactor } from "@/lib/srd/weather";
import type { Weather } from "@/lib/scene/state";
import { ADVANCE_UNITS, describeDuration, describeInstant, restMinutes } from "@/lib/dm/calendar";
import { handleTakeRest } from "@/lib/dm/rest-tools";
import { insertCampaignMessage } from "@/lib/db/messages";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { badArguments, type ToolResult } from "@/lib/dm/tool-errors";
import { tableNoteSeq } from "@/lib/dm/narration-slot";
import { fittedText } from "@/lib/dm/fitted-text";

// The remaining DM-utility engines: CR-scaled treasure the server actually
// moves into purses, object durability read from the DMG table, and forced-
// march exhaustion rolled from the real Constitution saves. Before these,
// loot value, whether a door breaks, and whether a hard day's march wore the
// party down were all pure DM assertion. This module imports the roll engine,
// the sheet layer, and mutations; it must never be imported by them.

// "Until it breaks" as one call: an agent program's calls arrive one at a
// time, and the player who hacks at a door until it splinters was given one
// blow (src/lib/dm/action-parts-logic.ts). The blows are struck one after
// another, each the single blow it always was, and stop when the object
// breaks. Twenty blows are two minutes of hacking: SRD 5.1 sets no limit,
// and a thing that stands that long is one to find another way past. In a
// fight each blow is one of the character's attacks, so blows is refused
// there.
const MAX_BLOWS = 20;

// A journey of days in one call: the player who says "we travel for four
// days" was given one leg, and the model's next calls never came (an agent
// program's calls arrive one at a time, src/lib/dm/action-parts-logic.ts).
// Each day is the pace's day (8 hours, SRD 5.1 Travel Pace) and the camp
// after it, its night the rules' own rest through take_rest: a long rest
// when the table's rest fits a night, a short one when a long rest is longer
// than the camp (Gritty Realism's week). The last day ends on the road.
const MAX_TRAVEL_DAYS = 30;
const CAMP_MINUTES = 16 * 60;

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const WORLD_TOOL_NAMES = [
  "roll_treasure",
  "damage_object",
  "travel",
  "pass_time",
  "set_weather",
  "show_title",
] as const;

const MATERIALS: ObjectMaterial[] = [
  "cloth",
  "paper",
  "rope",
  "crystal",
  "glass",
  "ice",
  "wood",
  "bone",
  "stone",
  "iron",
  "steel",
  "mithral",
  "adamantine",
];
const SIZES: ObjectSize[] = ["tiny", "small", "medium", "large"];

// Scarce water under the `supplies` variant (src/lib/dm/supplies.ts): what
// the party can find from now on, kept until the DM says otherwise.
const WATER_PROPERTY = {
  type: "string",
  enum: ["plenty", "half", "none"],
  description:
    "Only for the supplies variant when water is scarce (a desert, a siege): half or none. With half, each day is a DC 15 CON save against a level of exhaustion; with none, each day costs a level whatever they carry. It holds until you send plenty.",
};

export const worldTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "roll_treasure",
      description:
        "Generate treasure scaled to a challenge from the DMG hoard tables and pay it into the named characters' purses through modify_gold.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          cr: { type: "number", description: "The challenge rating of what they overcame (or the toughest enemy's), which scales the treasure." },
          characterIds: {
            type: "array",
            items: { type: "string" },
            description: "Who shares the coin: exact characterIds from GAME STATE. Omit to split among the whole party.",
          },
          individual: {
            type: "boolean",
            description:
              "True for a single foe's pocket money (a tenth of a hoard) rather than a full hoard.",
          },
          reason: { type: "string", description: "Short note on the source of the treasure. A second hoard in the same turn needs its own." },
        },
        required: ["cr"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "damage_object",
      description:
        "Resolve blows at an inanimate object (a door, a chest, a rope, a window) against the DMG object table: give its name, material and size, or an explicit ac and hp. Out of a fight, blows strikes again and again until it breaks. Objects are immune to poison and psychic damage. A Wall of Ice is struck a section at a time: name it 'Wall of Ice' and give the section, 10 feet each. The server uses a section's AC 12 and 30 HP, doubles fire, and when it breaks opens its squares and lays the frigid air. A net holding a creature is 'Net' (its ground id if two): 5 slashing frees it.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "What the object is ('the oak door'), or 'Wall of Ice' with its section. The server keeps its damage, and what the first call said it is made of, between blows." },
          section: { type: "integer", minimum: 1, description: "A Wall of Ice's section, numbered from the end it was laid from." },
          characterId: { type: "string", description: "The character striking it with a weapon: exact characterId from GAME STATE." },
          weapon: { type: "string", description: "The weapon they strike with, from their equipment." },
          improvised: { type: "boolean", description: "True when weapon names an object that is no weapon on their sheet (a chair, a bottle). It strikes as an improvised weapon." },
          damageType: { type: "string", description: "Damage type, for damage you pass yourself." },
          material: { type: "string", enum: MATERIALS, description: "What the object is made of. Default: wood." },
          size: { type: "string", enum: SIZES, description: "Its size class. Default: medium." },
          fragile: { type: "boolean", description: "True for brittle objects (fewer HP)." },
          damage: { type: "string", description: "The damage dealt by something other than a character's weapon, as dice (2d6) or a number." },
          ac: { type: "integer", description: "Override the material's AC if you know it." },
          hp: { type: "integer", description: "Override the size's HP if you know it." },
          threshold: { type: "integer", description: "Damage threshold (castle walls, ships): a blow below it does nothing." },
          blows: {
            type: "integer",
            minimum: 1,
            maximum: MAX_BLOWS,
            description: `Blows struck one after another out of a fight, stopping when it breaks; ${MAX_BLOWS} to strike until it does. Default: 1.`,
          },
          reason: { type: "string", description: "Short note on what is being broken." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "travel",
      description:
        "Resolve overland travel: a journey of several days in one call (days), or one stretch of marching (hours or miles). Each day is the pace's 8 hours and the night's camp, a rest through take_rest's rules. Hours marched past 8 in a day are a forced march. Snow or a storm slows the march further; fast travellers take -5 passive Perception; only a slow pace allows stealth, so Stealth checks are refused while the party marches at a normal or fast pace; a failed forced-march save costs a level of exhaustion. It moves no one on the map: when the leg ends somewhere the story names, that place is a move_party call.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          days: {
            type: "integer",
            minimum: 1,
            maximum: MAX_TRAVEL_DAYS,
            description: "A journey of this many days: each day 8 hours on the road, each night in camp. Give this, hours or miles.",
          },
          hours: { type: "integer", description: "One stretch of marching, in hours; the server counts it with the hours already marched that day." },
          miles: {
            type: "number",
            description: "Miles to cover instead of hours, one day's leg of 24 hours at most. The server works out the hours the pace, the ground and the weather need.",
          },
          terrain: {
            type: "string",
            enum: ["normal", "difficult"],
            description: "Difficult terrain (dense forest, deep swamp, steep mountains, ice) halves the distance covered. Default: 'normal'.",
          },
          pace: {
            type: "string",
            enum: ["fast", "normal", "slow"],
            description: "Travel pace. Default: 'normal'.",
          },
          characterIds: {
            type: "array",
            items: { type: "string" },
            description: "Who is travelling: exact characterIds from GAME STATE. Omit for the whole party.",
          },
          water: WATER_PROPERTY,
          meal: MEAL_PROPERTY,
          reason: { type: "string", description: "Short note on the journey." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pass_time",
      description:
        "Move the in-world clock forward when time passes and nothing else accounts for it: waiting out a storm, a night at an inn, a week of downtime, a long conversation. Travel and rests already advance the clock themselves, so do not call it alongside them. Time only moves forward.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          amount: { type: "integer", minimum: 1, description: "How much time passes." },
          unit: {
            type: "string",
            enum: ["minutes", "hours", "days", "weeks"],
            description: "Unit of the amount. Default: 'hours'.",
          },
          water: WATER_PROPERTY,
          meal: MEAL_PROPERTY,
          reason: { type: "string", description: "Short note on what filled the time." },
        },
        required: ["amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_weather",
      description:
        "Change the weather over the table when the story calls for it (a storm rolls in, the fog lifts). The server rolls weather on its own at each dawn and on long journeys; call this only to overrule it. Rain and fog cut what anyone sees and give disadvantage on Perception by sight; a gale gives disadvantage on ranged attacks past 30 feet; frigid or hot air is a hazard on a long march; the board's light follows the sky outdoors.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          sky: {
            type: "string",
            enum: ["clear", "overcast", "rain", "storm", "snow", "fog", "wind"],
          },
          temperature: { type: "string", enum: ["frigid", "cold", "mild", "warm", "hot"] },
          wind: { type: "string", enum: ["calm", "breeze", "gale"] },
          precipitation: {
            type: "integer",
            minimum: 0,
            maximum: 3,
            description: "0 none, 1 light, 2 steady, 3 heavy. Default: from the sky.",
          },
          reason: { type: "string", description: "Short in-fiction cause." },
        },
        required: ["sky"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_title",
      description:
        "Put a title card on every screen for a moment: a chapter name, a place the party arrives at, a dramatic reveal. Chapters, fights and dawns already show their own cards; call it for a beat that deserves one.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", description: "A few words in display type." },
          subtitle: { type: "string", description: "One line under it." },
          tone: {
            type: "string",
            enum: ["gold", "ember", "dawn", "plain"],
            description: "Gold for wonder or a chapter, ember for danger, dawn for relief.",
          },
        },
        required: ["title"],
      },
    },
  },
];

const weatherSchema = z.object({
  sky: z.enum(["clear", "overcast", "rain", "storm", "snow", "fog", "wind"]),
  temperature: z.enum(["frigid", "cold", "mild", "warm", "hot"]).optional(),
  wind: z.enum(["calm", "breeze", "gale"]).optional(),
  precipitation: z.coerce.number().int().min(0).max(3).optional(),
  reason: z.string().optional(),
});

export function handleSetWeather(campaign: Campaign, rawArguments: string): ToolResult {
  let args: z.infer<typeof weatherSchema>;
  try {
    args = weatherSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments: set_weather needs a sky.", error, rawArguments);
  }
  const current = getClock(campaign.id).weather;
  const precipitation =
    args.precipitation ??
    (args.sky === "storm" ? 3 : args.sky === "rain" ? 2 : args.sky === "snow" ? 2 : 0);
  const weather: Weather = {
    sky: args.sky,
    temperature: args.temperature ?? current?.temperature ?? "mild",
    wind: args.wind ?? (args.sky === "storm" || args.sky === "wind" ? "gale" : current?.wind ?? "calm"),
    precipitation: precipitation as Weather["precipitation"],
  };
  const scene = refreshSky(campaign.id, { force: weather });
  const sentence = describeWeather(weather);
  tableNote(campaign, `${sentence}${args.reason ? ` ${args.reason}` : ""}`);
  return {
    ok: true,
    weather: sentence,
    ...(scene ? { light: scene.isDark ? "dark" : "daylight" } : {}),
    note: "The board's light, Perception, ranged attacks and travel now follow this sky.",
  };
}

const titleSchema = z.object({
  title: z.string().trim().min(1).max(60),
  subtitle: fittedText(120).optional(),
  tone: z.enum(["gold", "ember", "dawn", "plain"]).optional(),
});

export function handleShowTitle(campaign: Campaign, rawArguments: string): ToolResult {
  let args: z.infer<typeof titleSchema>;
  try {
    args = titleSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments: show_title needs a title.", error, rawArguments);
  }
  publishTitleCard(campaign.id, {
    title: args.title,
    ...(args.subtitle ? { subtitle: args.subtitle } : {}),
    tone: args.tone ?? "gold",
  });
  return { ok: true, shown: args.title };
}

function resolveTargets(
  ids: unknown,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): CharacterSheet[] {
  if (!Array.isArray(ids) || !ids.length) {
    return sheets;
  }
  const out: CharacterSheet[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const sheet = resolveSheetRef(typeof id === "string" ? id : undefined, sheets, sheetsById);
    if (sheet && !seen.has(sheet.id)) {
      seen.add(sheet.id);
      out.push(sheet);
    }
  }
  return out;
}

// ---- roll_treasure ----

const treasureSchema = z.object({
  cr: z.coerce.number().min(0).max(30),
  characterIds: z.array(z.string()).optional(),
  individual: z.coerce.boolean().optional(),
  reason: z.string().optional(),
});

// The hoards a turn has paid, by what its call named: the CR, whether it is
// one foe's pocket money, who shares it, and the reason. No record the
// engine keeps says which hoard a roll was for, so a later turn's call is a
// new hoard; but the same call twice in one turn is the model sending it
// again (a retry, a batch that repeated a line), and it used to roll and pay
// the coin a second time. It is answered with the first payout, from the
// turn's own ledger (turn-marks.ts), which a restart remembers.
function hoardKey(args: z.infer<typeof treasureSchema>, recipients: CharacterSheet[]): string {
  const ids = recipients.map((sheet) => sheet.id).sort().join(",");
  return [args.cr, args.individual ? "pocket" : "hoard", ids, textKey(args.reason ?? "")].join("|");
}

export function handleRollTreasure(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  let args: z.infer<typeof treasureSchema>;
  try {
    args = treasureSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments: roll_treasure needs a cr.", error, rawArguments);
  }
  const recipients = resolveTargets(args.characterIds, sheets, sheetsById);
  if (!recipients.length) {
    return { error: "No characters to receive treasure; use characterIds from GAME STATE.", retry: true };
  }
  const key = hoardKey(args, recipients);
  const already = turnLedger(campaign.id, turn.id, `roll_treasure:${key}`);
  if (already) {
    return {
      ...already,
      repeat: true,
      note: `This hoard was already rolled and paid this turn (${String(already.totalGold)} gp in all); nothing more was paid. A second, different hoard needs its own reason.`,
    };
  }
  const tier = treasureTierForCr(args.cr);
  const { dice, mult, label } = treasureGoldRoll(tier, Boolean(args.individual));
  const gold = rollCard(campaign, turn, null, "custom", label, dice, null).total * mult;
  const share = Math.floor(gold / recipients.length);
  const reason = (args.reason ?? "").trim() || "treasure";
  const paid: Array<{ name: string; gold: number }> = [];
  if (share > 0) {
    for (const sheet of recipients) {
      applyDmMutation(
        campaign,
        turn.id,
        "modify_gold",
        JSON.stringify({ characterId: sheet.id, delta: share, reason }),
        sheets,
        sheetsById,
      );
      paid.push({ name: sheet.name, gold: share });
    }
  }
  // One foe's pocket is coin; the magic items are a hoard's (the reference
  // calculator says the same). A CR 5 purse used to suggest a magic item.
  const items = args.individual ? 0 : hoardItemCount(tier);
  const result = {
    ok: true,
    tier,
    totalGold: share * recipients.length,
    perCharacter: paid,
    suggestedMagicItems: items,
    note:
      (share > 0
        ? `${share} gp paid to each of ${recipients.length}; the server moved the coin.`
        : "This challenge yields no coin.") +
      (items
        ? ` A hoard this size tends to hold about ${items} magic item${items === 1 ? "" : "s"}; hand any out with grant_item.`
        : ""),
  };
  writeTurnLedger(campaign.id, turn.id, `roll_treasure:${key}`, result);
  return result;
}

// ---- damage_object ----

// A character's own attack against an object's AC, and damage the object
// keeps between blows when it is named (src/lib/dm/object-damage.ts).
export function handleDamageObject(
  rawArguments: string,
  campaign: Campaign | null = null,
  turn: DmTurn | null = null,
): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments || "{}");
  } catch {
    return damageObject(campaign, turn, rawArguments);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) || !("blows" in raw)) {
    return damageObject(campaign, turn, rawArguments);
  }
  const blows = z.coerce.number().int().min(1).max(MAX_BLOWS).safeParse(raw.blows);
  if (!blows.success) {
    return { error: `blows is how many blows to strike, 1 to ${MAX_BLOWS}.`, retry: true };
  }
  const blow = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "blows"));
  if (blows.data === 1) {
    return damageObject(campaign, turn, JSON.stringify(blow));
  }
  if (typeof blow.name !== "string" || !blow.name.trim()) {
    return { error: "Several blows strike the same object: name it, so its damage adds up between them. Nothing was rolled.", retry: true };
  }
  if (campaign && getActiveEncounter(campaign.id)) {
    return { error: "In a fight each blow is one of the character's attacks: one blow a call, on their turn. Nothing was rolled.", retry: true };
  }
  const struck: Record<string, unknown>[] = [];
  // Damage the object is immune to never adds up: one blow says so, and
  // nineteen more drew nineteen roll cards of nothing.
  let immune = false;
  for (let count = 0; count < blows.data; count += 1) {
    const result = damageObject(campaign, turn, JSON.stringify(blow));
    struck.push(result);
    immune = result.immune === true;
    if (typeof result.error === "string" || result.broken === true || immune || (result.damage === undefined && result.hit === undefined)) {
      break;
    }
  }
  const last = struck[struck.length - 1];
  if (typeof last.error === "string") {
    return struck.length === 1 ? last : { ...last, blows: struck };
  }
  return {
    ok: true,
    blows: struck,
    broken: last.broken === true,
    ...(last.damageTaken !== undefined ? { damageTaken: last.damageTaken, hpLeft: last.hpLeft } : {}),
    note:
      last.broken === true
        ? `It breaks on blow ${struck.length}. Narrate the blows and it giving way.`
        : immune
          ? "It is immune to that damage, so no blow of it can break it. Narrate it holding."
          : `${struck.length} blows and it still stands. Narrate the effort.`,
  };
}

// ---- travel ----

const travelSchema = z.object({
  days: z.coerce.number().int().min(1).max(MAX_TRAVEL_DAYS).optional(),
  hours: z.coerce.number().int().min(0).max(48).optional(),
  miles: z.coerce.number().min(0.1).max(200).optional(),
  terrain: z.enum(["normal", "difficult"]).optional(),
  pace: z.enum(["fast", "normal", "slow"]).optional(),
  characterIds: z.array(z.string()).optional(),
  water: z.enum(["plenty", "half", "none"]).optional(),
  meal: mealArg.optional(),
  reason: z.string().optional(),
});

// A system line in the transcript, the same shape every other engine uses to
// tell the table something happened without the model having to say it.
function tableNote(campaign: Campaign, content: string) {
  const seq = tableNoteSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    glyph: "cue-bell",
    content,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

const passTimeSchema = z.object({
  amount: z.coerce.number().int().min(1).max(10000),
  unit: z.enum(ADVANCE_UNITS).default("hours"),
  water: z.enum(["plenty", "half", "none"]).optional(),
  meal: mealArg.optional(),
  reason: fittedText(200).optional(),
});

// Moving the in-world clock without travelling anywhere: waiting out a
// storm, a night in an inn, a week of downtime. Travel and rests move it
// themselves, so this is for the time nothing else accounts for.
//
// Time only ever moves forward here: a clock that could run backwards would
// silently un-expire conditions and rests. Undoing a passage of time is
// "Revert this turn" (audit/revert-turn): the turn's moves are kept
// (src/lib/db/clock-moves.ts), and the revert puts the instant back with the
// sheet changes the time made, all audited (issue #622).
// "1 hour passes", "10 minutes pass": describeDuration names one unit, so
// its count alone says whether the verb is singular.
function passVerb(minutes: number): string {
  return Number.parseInt(describeDuration(minutes), 10) === 1 ? "passes" : "pass";
}

export function handlePassTime(
  campaign: Campaign,
  rawArguments: string,
): ToolResult {
  let args: z.infer<typeof passTimeSchema>;
  try {
    args = passTimeSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    const refused = badArguments(`Invalid arguments: pass_time needs an amount and a unit.`, error, rawArguments);
    return { ...refused, error: `${refused.error}${mealRefused(rawArguments) ? ` ${MEAL_REFUSAL}` : ""}` };
  }
  if (args.water) {
    setWaterRation(campaign.id, args.water);
  }
  const before = getClock(campaign.id);
  // Every character's lifestyle is charged for the dawns below, so those
  // dawns feed whoever keeps one up.
  const lifestyle = Object.fromEntries(listSheets(campaign.id).map((sheet) => [sheet.id, 0]));
  const moved = advanceClock(campaign.id, args.amount, args.unit, { meal: Boolean(args.meal), lifestyle });
  if ("error" in moved) {
    return moved;
  }
  // Time spent anywhere but the road ends the march and its pace.
  setTravelPace(campaign.id, null);
  // Each dawn that passes in town is a day of each character's lifestyle
  // (src/lib/dm/lifestyle.ts); a character with none chosen pays nothing.
  const dawns = dawnsBetween(before.instant, moved.clock.instant);
  const living = dawns
    ? listSheets(campaign.id).map((sheet) => chargeLifestyle(campaign, sheet.id, dawns)?.line).filter((line): line is string => Boolean(line))
    : [];
  // A stretch of time is a timeskip: the off-screen world moves once per
  // four hours, the same rate travel uses.
  const ticks = Math.min(24, Math.floor(moved.minutes / (4 * 60)));
  if (ticks > 0) {
    tickWorldTimeskip(campaign.id, ticks);
  }
  // The sky moves with the clock: a new day rolls new weather.
  const sky = refreshSky(campaign.id, { before, minutes: moved.minutes });
  tableNote(
    campaign,
    `${describeDuration(moved.minutes)} ${passVerb(moved.minutes)}${args.reason?.trim() ? `: ${asSentence(args.reason)}` : "."} It is now ${describeInstant(moved.clock.calendar, moved.clock.instant)}.`,
  );
  return {
    ok: true,
    passed: describeDuration(moved.minutes),
    now: describeInstant(moved.clock.calendar, moved.clock.instant),
    ...(sky?.summary ? { weather: sky.summary } : {}),
    ...(living.length ? { lifestyle: living } : {}),
    // Rolled by the server as the time passed; narrate what they decided.
    ...(moved.deathSaves.length ? { deathSaves: moved.deathSaves } : {}),
  };
}

// The journey's own line in the chronicle, as a rest and pass_time post
// theirs. It goes last, after the death saves the hours rolled (settleDying
// posts them inside advanceClock) and any forced-march saves.
function journeyNote(campaign: Campaign, minutes: number | null, reason: string | undefined, now: string) {
  const length = minutes ? ` for ${describeDuration(minutes)}` : "";
  const why = reason?.trim() ? `: ${asSentence(reason)}` : ".";
  tableNote(campaign, `The party travels${length}${why}${now ? ` It is now ${now}.` : ""}`);
}

export function handleTravel(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  let args: z.infer<typeof travelSchema>;
  try {
    args = travelSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    const refused = badArguments(`Invalid arguments: travel needs hours or miles.`, error, rawArguments);
    return { ...refused, error: `${refused.error}${mealRefused(rawArguments) ? ` ${MEAL_REFUSAL}` : ""}` };
  }
  // Who travels, settled before anything moves. A forced march with no
  // traveller used to find out only after the clock, the world, the sky and
  // the water had moved, and its retry moved them all again.
  const travellers = resolveTargets(args.characterIds, sheets, sheetsById);
  if (!travellers.length) {
    return args.characterIds?.length
      ? { error: "No traveller: characterIds names nobody at this table. Use characterIds from GAME STATE, or leave it out for the whole party. Nothing moved: the clock and the march are as they were.", retry: true }
      : { error: "Nobody at this table can travel: it has no characters yet. Nothing moved: the clock and the march are as they were.", refused: "rules" };
  }
  if (args.days !== undefined) {
    if (args.hours !== undefined || args.miles !== undefined) {
      return { error: "travel takes days, hours or miles: one of them. Nothing moved: the clock and the march are as they were.", retry: true };
    }
    return travelDays(campaign, turn, { ...args, days: args.days }, travellers, sheets, sheetsById);
  }
  return travelStretch(campaign, turn, args, travellers, sheets, sheetsById);
}

function travelDays(
  campaign: Campaign,
  turn: DmTurn,
  args: z.infer<typeof travelSchema> & { days: number },
  travellers: CharacterSheet[],
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  const variant = campaign.gameSettings.variantRules.restVariant;
  const night = restMinutes("long", variant) <= CAMP_MINUTES ? "long" : "short";
  const legs: ToolResult[] = [];
  const nights: ToolResult[] = [];
  for (let count = 1; count <= args.days; count += 1) {
    // The meal is the journey's first: it covers one dawn, not one a day.
    const leg = travelStretch(campaign, turn, { ...args, hours: NORMAL_TRAVEL_HOURS, meal: count === 1 ? args.meal : undefined }, travellers, sheets, sheetsById);
    legs.push(leg);
    if (typeof leg.error === "string" || count === args.days) {
      break;
    }
    // The evening in camp, then the night's rest to the next morning. The
    // world and the sky move with the evening as with pass_time.
    const dusk = getClock(campaign.id);
    const evening = advanceClock(campaign.id, CAMP_MINUTES - restMinutes(night, variant), "minutes");
    if ("error" in evening) {
      break;
    }
    tickWorldTimeskip(campaign.id, Math.floor(evening.minutes / (4 * 60)));
    refreshSky(campaign.id, { before: dusk, minutes: evening.minutes });
    // Only the travellers camp: whoever stayed behind rests on their own.
    const rest = handleTakeRest(campaign, turn.id, JSON.stringify({ kind: night, reason: "the night's camp" }), travellers, sheetsById);
    nights.push(rest);
    if (typeof rest.error === "string") {
      break;
    }
  }
  // A first day refused moved nothing: its refusal is the answer.
  if (legs.length === 1 && typeof legs[0].error === "string") {
    return legs[0];
  }
  const travelled = legs.filter((leg) => typeof leg.error !== "string").length;
  const stopped = [...legs, ...nights].find((result) => typeof result.error === "string");
  return {
    ok: true,
    days: travelled,
    legs,
    nights,
    note:
      typeof stopped?.error === "string"
        ? `The journey stopped after ${travelled} of ${args.days} days: ${stopped.error} Narrate what was travelled.`
        : `${args.days} days on the road, ${nights.length} nights in camp with a ${night} rest each. Narrate the journey from the legs and the nights.`,
  };
}

// One stretch of marching: the hours or miles of one leg.
function travelStretch(
  campaign: Campaign,
  turn: DmTurn,
  args: z.infer<typeof travelSchema>,
  travellers: CharacterSheet[],
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  const pace: TravelPace = args.pace ?? "normal";
  const effect = paceEffect(pace);
  const terrain = args.terrain ?? "normal";
  // Miles or hours: whichever is given sets the other (SRD 5.1, Travel
  // Pace), at the weather the party sets out in.
  const before = getClock(campaign.id);
  const leg = travelLeg({ pace, terrain, hours: args.hours, miles: args.miles, weatherFactor: before.weather ? weatherTravelFactor(before.weather) : 1 });
  if ("error" in leg) {
    return leg;
  }
  if (args.water) {
    setWaterRation(campaign.id, args.water);
  }
  const legHours = leg.hours;

  // A journey is a timeskip: the off-screen world moves roughly once per
  // four hours on the road (world arcs, NPC goals; zero model calls).
  tickWorldTimeskip(campaign.id, Math.max(1, Math.round(legHours / 4)));

  // The hours the party spent on the road are hours the world spent too, so
  // the clock moves with them. Before this the in-world date never changed
  // no matter how far anyone walked.
  const moved = advanceClock(campaign.id, leg.minutes, "minutes", { meal: Boolean(args.meal) });
  const now = "error" in moved ? "" : describeInstant(moved.clock.calendar, moved.clock.instant);
  // The hours past 8 this leg adds to each traveller's day (SRD 5.1, Forced
  // March), counted with the legs they marched before it that day: a hero
  // who joined at noon has not marched the morning.
  const end = "error" in moved ? before.instant + leg.minutes : moved.clock.instant;
  const marchers = travellers.map((sheet) => ({
    sheet,
    span: forcedMarchSpan((before.marched ?? []).filter((earlier) => earlier.ids.includes(sheet.id)), end, legHours, before.longRests?.[sheet.id]),
  }));
  const forced = marchers.reduce((longest, { span }) => (span.to > longest.to ? span : longest), { from: 1, to: 0 });
  const extra = Math.max(0, forced.to - forced.from + 1);
  recordMarch(campaign.id, end, leg.minutes, travellers.map((sheet) => sheet.id));
  // A leg of four hours or more rolls the sky; the sky then has its say on
  // the march: snow and storm halve the ground covered, and frigid or hot
  // air is the extreme cold or heat hazard for every traveller.
  const sky = refreshSky(campaign.id, {
    before,
    minutes: "error" in moved ? 0 : moved.minutes,
  });
  const weatherNotes: string[] = [];
  const weatherOutcome: Record<string, unknown> = {};
  // The ground covered: the pace's Hour column, its Day column for a full
  // day, halved in difficult terrain, cut by the weather the party set out
  // in (src/lib/srd/travel.ts).
  weatherOutcome.miles = leg.miles;
  if (terrain === "difficult") {
    weatherNotes.push("Difficult terrain halves the distance.");
  }
  if (sky?.weather) {
    const factor = weatherTravelFactor(sky.weather);
    if (factor < 1) {
      weatherNotes.push(
        `${sky.weather.sky === "snow" ? "Snow underfoot" : "The weather"} slows the march: the party covers about ${Math.round(factor * 100)} percent of the usual distance.`,
      );
      weatherOutcome.distanceFactor = factor;
    }
    const exposure = weatherExposure(sky.weather);
    if (exposure && legHours >= 4) {
      const hazard = handleApplyHazard(
        campaign,
        turn,
        JSON.stringify({
          type: exposure,
          characterIds: travellers.map((sheet) => sheet.id),
          // One save for every hour on the road in it.
          hours: legHours,
          reason: exposure === "extreme_cold" ? "hours in the bitter cold" : "hours in the heat",
        }),
        sheets,
        sheetsById,
      );
      weatherOutcome.exposure = hazard;
      weatherNotes.push(
        exposure === "extreme_cold"
          ? "The cold is a hazard: the server rolled a Constitution save for each hour and applied any exhaustion."
          : "The heat is a hazard: the server rolled a Constitution save for each hour and applied any exhaustion.",
      );
    }
    weatherOutcome.weather = sky.summary;
  }

  // The road is where companions talk unobserved (issue 503 Phase 5): a
  // pact laying a false trail goes now, and a wavering companion may
  // recruit, once a long rest. Only what the table saw comes back.
  const pacts = pactMoment(campaign, turn.id, "travel");
  // And where a companion who keeps unease in is read again (issue 615).
  readUneaseTells(campaign, turn.id);
  if (pacts.length) {
    weatherOutcome.companions = pacts;
  }
  // The death saves the hours on the road rolled for the dying, already at
  // the table: the GM narrates the march from this result.
  if (!("error" in moved) && moved.deathSaves.length) {
    weatherOutcome.deathSaves = moved.deathSaves;
  }

  // The pace holds until the party stops: check_notice reads it (a fast
  // pace is -5 to passive Perception) until a rest or pass_time ends the
  // march (src/lib/db/clock.ts).
  setTravelPace(campaign.id, pace);
  const paceNote =
    pace === "fast"
      ? "A fast pace means -5 to passive Perception: the party is likelier to be surprised. check_notice applies it by itself until the party rests or stops."
      : pace === "slow"
        ? "A slow pace lets the party travel stealthily if they wish."
        : "A normal pace carries no perception penalty, and like a fast one it allows no stealth: Stealth checks are refused until the march ends.";

  const minutesOnRoad = "error" in moved ? null : moved.minutes;
  if (extra <= 0) {
    journeyNote(campaign, minutesOnRoad, args.reason, now);
    return {
      ok: true,
      pace,
      hours: legHours,
      forcedMarch: false,
      passivePerceptionMod: effect.passivePerceptionMod,
      ...(now ? { now } : {}),
      ...weatherOutcome,
      note: `A day within 8 hours of marching; no exhaustion. ${paceNote}${weatherNotes.length ? ` ${weatherNotes.join(" ")}` : ""}`,
    };
  }

  // Forced march: a Constitution save at the end of every hour past eight,
  // DC 10 + 1 for each hour past 8 (SRD 5.1, Travel Pace), each failure a
  // level of exhaustion through the real exhaustion track.
  const dc = forcedMarchSaveDc(forced.to);
  const results: Array<{ name: string; saves: HourSave[]; failed: boolean; exhaustion?: number }> = [];
  for (const { sheet: stale, span } of marchers) {
    const sheet = getSheetById(stale.id) ?? stale;
    // The road's hours rolled the dying's death saves before these (clock.ts):
    // one who died in them was listed holding up, saves and all. A traveller
    // whose own day is within 8 hours rolls none.
    if (sheet.deathSaves?.dead || span.to < span.from) {
      continue;
    }
    const hours = Array.from({ length: span.to - span.from + 1 }, (_, index) => ({
      hour: span.from + index,
      dc: forcedMarchSaveDc(span.from + index),
    }));
    const saves = hourlyConSaves({
      campaign,
      turn,
      sheet,
      hours,
      detail: (hour) => `${sheet.name}: CON save vs forced march, hour ${8 + hour}`,
      reason: "forced march",
      sheets,
      sheetsById,
    });
    const failures = saves.filter((entry) => entry.failed);
    results.push({
      name: sheet.name,
      saves,
      failed: failures.length > 0,
      ...(failures.length ? { exhaustion: failures[failures.length - 1].exhaustion } : {}),
    });
  }

  const worn = results.filter((entry) => entry.failed).map((entry) => entry.name);
  journeyNote(campaign, minutesOnRoad, args.reason, now);
  // The same account of the road a day within 8 hours gives (the clock, the
  // weather and its exposure, the companions, the death saves the hours
  // rolled), with the forced march's saves on top: the GM narrates the march
  // from this result, and a long day left a hero's death unsaid.
  return {
    ok: true,
    pace,
    hours: legHours,
    forcedMarch: true,
    forcedMarchHours: extra,
    dc,
    results,
    ...(now ? { now } : {}),
    ...weatherOutcome,
    note:
      (worn.length
        ? `Forced march (the day's march reaches ${8 + forced.to} hours, one save for each hour past 8, up to DC ${dc}): ${worn.join(", ")} failed and gained a level of exhaustion for each failed hour (server-applied).`
        : `Forced march (the day's march reaches ${8 + forced.to} hours, one save for each hour past 8, up to DC ${dc}): everyone holds up.`) + ` ${paceNote}${weatherNotes.length ? ` ${weatherNotes.join(" ")}` : ""}`,
  };
}
