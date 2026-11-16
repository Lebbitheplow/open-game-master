import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { advanceClock, getClock, recordLongRests, recordRestEnds } from "@/lib/db/clock";
import { getActiveEncounter } from "@/lib/db/encounters";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { afflictedRestPatch, afflictionsAfterLongRest } from "@/lib/dm/afflictions";
import { authoredRestTempHp } from "@/lib/dm/authored-turns";
import { OMEN_WORDS } from "@/lib/dm/before-roll-logic";
import { advance, longRestAllowed, MINUTES_PER_DAY, restMinutes, type Instant } from "@/lib/dm/calendar";
import { breakConcentration } from "@/lib/dm/concentration";
import { holdsDestructiveWrath, spendWrath } from "@/lib/dm/destructive-wrath";
import { foretoldWords } from "@/lib/dm/foretold-logic";
import { soulTrinketAtRestEnd } from "@/lib/dm/mt-mr-trinkets";
import { longRestPatch } from "@/lib/dm/rest-logic";
import { tranquilityAfterLongRest } from "@/lib/dm/srd-defenses";
import { goingWithout } from "@/lib/dm/supplies";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { sleeplessBy } from "@/lib/srd/mt-species-traits";

// A long rest's benefits, with no clock of their own. take_rest moves the
// clock by the rest's hours and then grants them; a day of downtime or of
// waiting has already moved the clock, and is a day the party slept through,
// so it grants them as each day ends (passRestingDays). One place decides who
// gains and gives it, so every door gives the same night.

// A rest's sheet write, audited (kinds rest_short / rest_long) so the party
// lead can undo it.
export function auditRest(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  kind: string,
  patch: FullPatchSheetInput,
  reason: string,
) {
  const updated = patchSheet(sheet.id, patch);
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId,
    kind,
    delta: patch as Record<string, unknown>,
    reason,
    seq: allocateSeq(campaign.id),
    before: sheet,
    patch: patch as Record<string, unknown>,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// Who gains from a long rest that ends at `endsAt`, read as it begins: alive,
// at least 1 hit point, and no long rest ended in the 24 hours before this
// one ends (SRD 5.1, Long Rest). The rest happens whoever gains from it.
export function whoGainsLongRest(campaignId: string, sheets: CharacterSheet[], endsAt: Instant): { resting: string[]; unaffected: string[] } {
  const last = getClock(campaignId).longRests ?? {};
  const resting: string[] = [];
  const unaffected: string[] = [];
  for (const stale of sheets) {
    const sheet = getSheetById(stale.id);
    if (!sheet) {
      continue;
    }
    if (sheet.deathSaves?.dead) {
      unaffected.push(`${sheet.name} (dead)`);
    } else if (sheet.currentHp <= 0) {
      unaffected.push(`${sheet.name} (at 0 hit points; a long rest needs at least 1 to begin with)`);
    } else if (!longRestAllowed(last[sheet.id], endsAt)) {
      unaffected.push(`${sheet.name} (finished a long rest less than 24 hours ago)`);
    } else {
      resting.push(sheet.id);
    }
  }
  return { resting, unaffected };
}

export type LongRestGrant = {
  rested: string[];
  restedIds: string[];
  omens: string[];
  portents: string[];
  afflictions: string[];
  restTempHp: string[];
};

// The benefits of the long rest that just ended at `endsAt`, for `resting`
// (from whoGainsLongRest). Charges no lifestyle and moves no clock: the
// caller already did both for the time the rest took.
export function grantLongRest(
  campaign: Campaign,
  turnId: string,
  resting: string[],
  endsAt: Instant,
  reason: string,
): LongRestGrant {
  const out: LongRestGrant = { rested: [], restedIds: [], omens: [], portents: [], afflictions: [], restTempHp: [] };
  // A held Destructive Wrath ends with the rest that gives the use back.
  for (const id of resting) {
    const sheet = getSheetById(id);
    if (sheet && holdsDestructiveWrath(sheet)) {
      spendWrath(campaign.id, id);
    }
  }
  for (const id of resting) {
    // Asleep, nobody concentrates (SRD 5.1: an unconscious creature is
    // incapacitated, and incapacitation ends concentration): the spell ends
    // whole, through the one function that ends one, before the rest is read
    // from the sheet it leaves. An elf in Trance and a warforged at Sentry's
    // Rest never sleep (src/lib/srd/mt-species-traits.ts): the spell they hold
    // is still held.
    const asleep = getSheetById(id);
    if (asleep?.concentratingOn && !sleeplessBy(asleep)) {
      breakConcentration(campaign, turnId, id, "fell asleep for the long rest");
    }
    const sheet = getSheetById(id);
    if (!sheet || sheet.deathSaves?.dead) {
      continue;
    }
    // Under the supplies variant, going without keeps the exhaustion. Read as
    // the rest ends: a meal the party lies down on, or the ration, water or
    // lifestyle of a dawn it crossed, is food and drink taken, and lifts a
    // level (SRD 5.1: "provided that the creature has also ingested some food
    // and drink"). Read as it began, a dry hero fed at that dawn kept it.
    const starving = campaign.gameSettings.variantRules.supplies === true && goingWithout(getClock(campaign.id).supplies?.[sheet.id]);
    // A disease shapes the rest itself: sewer plague restores no hit points,
    // cackle fever keeps its level of exhaustion (afflictions.ts).
    const restPatch = afflictedRestPatch(sheet, longRestPatch(sheet, { keepExhaustion: starving }));
    // Audited every night, a whole sheet's too: undoing the row is what
    // forgets the rest on the clock (sheet-undo.ts), so a reverted day of
    // waiting leaves no long rest standing in the hours taken back.
    auditRest(campaign, turnId, sheet, "rest_long", restPatch, reason);
    out.rested.push(sheet.name);
    out.restedIds.push(sheet.id);
    // The omen the stars give for the day (before-roll-logic.ts), said in the rest's line.
    if (restPatch.omen) {
      out.omens.push(`${sheet.name}'s Cosmic Omen reads ${OMEN_WORDS[restPatch.omen]}`);
    }
    // Portent's new numbers, said in the same line: unsaid, the table only
    // found them on the sheet, and the storyteller not at all.
    if (restPatch.foretold?.length) {
      out.portents.push(`${sheet.name}'s Portent foretells ${foretoldWords(restPatch.foretold)}`);
    }
  }
  recordLongRests(campaign.id, resting, endsAt);
  recordRestEnds(campaign.id, resting);
  // The saves a disease asks at the end of a long rest.
  out.afflictions = afflictionsAfterLongRest(campaign, turnId, resting);
  // Celestial Resilience: temporary hit points when a rest ends (authored-hooks.ts).
  out.restTempHp = authoredRestTempHp(campaign, resting);
  // Tranquility: an Open Hand monk wakes under Sanctuary (srd-defenses.ts).
  tranquilityAfterLongRest(campaign, resting);
  // Death's Friend: a soul trinket in hand when none is carried (mt-mr-trinkets.ts).
  soulTrinketAtRestEnd(campaign, resting);
  return out;
}

// Days of downtime or of waiting are slept through: past a month of nights
// the last one stands for the rest, so a year's wait moves the clock in a
// month of steps, not three hundred.
const NIGHTS_ONE_BY_ONE = 30;

type Moved = Exclude<ReturnType<typeof advanceClock>, ToolError>;

export type RestingDays = {
  // Each who gained from at least one night, and from how many.
  rested: Array<{ name: string; nights: number }>;
  unaffected: string[];
  afflictions: string[];
  omens: string[];
  portents: string[];
  restTempHp: string[];
};

// Time that passes in whole days with no fight and no march (downtime, a
// pass_time of a day or more) gives each day's long rest to those who can
// gain one: SRD 5.1 downtime assumes the character rests through it, and
// one long rest in 24 hours (a week under gritty realism, whose long rest
// is one). The clock moves a day at a time so each night lands in order
// with what the days bring (a dawn's hunger, a disease's save, a stable hero
// waking), and no further than the time asked. The caller charges the
// lifestyle for the dawns, as it did; the rests charge nothing more.
export function passRestingDays(
  campaign: Campaign,
  turnId: string,
  sheets: CharacterSheet[],
  minutes: number,
  options: { meal?: boolean; lifestyle?: Record<string, number> },
  reason: string,
): Moved & { rests: RestingDays | null } | ToolError {
  const checked = advance(getClock(campaign.id).instant, minutes, "minutes");
  if ("error" in checked) {
    return checked;
  }
  const period = Math.max(MINUTES_PER_DAY, restMinutes("long", campaign.gameSettings.variantRules.restVariant));
  const whole = getActiveEncounter(campaign.id) ? 0 : Math.floor(minutes / period);
  const nights = Math.min(whole, NIGHTS_ONE_BY_ONE);
  const deathSaves: string[] = [];
  const hourSaves: string[] = [];
  const tally = new Map<string, { name: string; nights: number }>();
  const missed = new Set<string>();
  const days: RestingDays = { rested: [], unaffected: [], afflictions: [], omens: [], portents: [], restTempHp: [] };
  let first = true;
  const step = (span: number) => {
    const moved = advanceClock(campaign.id, span, "minutes", { meal: first && options.meal, lifestyle: options.lifestyle });
    first = false;
    if (!("error" in moved)) {
      deathSaves.push(...moved.deathSaves);
      hourSaves.push(...moved.hourSaves);
    }
    return moved;
  };
  for (let night = 1; night <= nights; night += 1) {
    // The last night one by one stands for every night after it.
    const stands = night === nights ? whole - nights + 1 : 1;
    const moved = step(stands * period);
    if ("error" in moved) {
      return moved;
    }
    const { resting, unaffected } = whoGainsLongRest(campaign.id, sheets, moved.clock.instant);
    for (const line of unaffected) {
      missed.add(line);
    }
    const grant = grantLongRest(campaign, turnId, resting, moved.clock.instant, reason);
    grant.restedIds.forEach((id, index) => {
      tally.set(id, { name: grant.rested[index], nights: (tally.get(id)?.nights ?? 0) + stands });
    });
    days.afflictions.push(...grant.afflictions);
    days.restTempHp.push(...grant.restTempHp);
    // The last night's omen and numbers are the ones that hold.
    days.omens = grant.omens;
    days.portents = grant.portents;
  }
  const left = minutes - whole * period;
  if (left > 0) {
    const moved = step(left);
    if ("error" in moved) {
      return moved;
    }
  }
  days.rested = [...tally.values()];
  days.unaffected = [...missed];
  return { clock: getClock(campaign.id), minutes, deathSaves, hourSaves, rests: nights ? days : null };
}

// The chronicle's words for the nights slept through the days.
export function restingDaysLine(rests: RestingDays | null): string {
  if (!rests?.rested.length) {
    return "";
  }
  const each = rests.rested.map(({ name, nights }) => `${name} ${nights === 1 ? "one" : nights}`).join(", ");
  return ` Each day ended in a night's long rest (long rests taken: ${each}).`;
}

// The same nights for the GM's result, only the parts that hold something.
export function restingDaysResult(rests: RestingDays | null): Record<string, unknown> {
  if (!rests) {
    return {};
  }
  return {
    longRests: rests.rested.map(({ name, nights }) => `${name}: ${nights}`),
    ...(rests.unaffected.length ? { noRestFor: rests.unaffected.join("; ") } : {}),
    ...(rests.afflictions.length ? { afflictions: rests.afflictions } : {}),
    ...(rests.restTempHp.length ? { restTempHp: rests.restTempHp } : {}),
    ...(rests.omens.length ? { omens: rests.omens } : {}),
    ...(rests.portents.length ? { portents: rests.portents } : {}),
    restNote: "Each whole day ended in a night's long rest for those listed: hit points, spell slots, half their hit dice, a level of exhaustion and their features came back each night. Narrate it.",
  };
}
