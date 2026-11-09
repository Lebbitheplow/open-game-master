// Damage landing on a character: the one path for it.
//
// apply_damage (src/lib/dm/mutations.ts) is the model's and the DM's door
// and clamps what they send to the tool's declared 1 to 200. The engine's
// own callers, which rolled their dice themselves (a fall, a creature out of
// air), come straight here with what they rolled, so a 20d6 fall or the
// whole pool of a drowning character is never cut to the rail meant for an
// argument somebody typed.
//
// Order, per SRD 5.1: resistance, then temporary hit points, then hit
// points; a beast form's pool before the druid's own. Dropping to 0 runs the
// death engine, and damage forces the concentration save.
//
// This module must not import mutations.ts (which imports it).
// Registers the incapacity watch's answer (Faithful Summons) wherever damage runs.
import "@/lib/dm/faithful-summons";
import { immersedResistance } from "@/lib/dm/underwater";
import { deathWardPatch } from "@/lib/dm/spell-effects";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { publishPersisted } from "@/lib/events";
import { RAGING, spendRelentlessEndurance, spendUndyingSentinel } from "@/lib/srd/class-resources";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { applyDamageMath, wildShapeDamageMath } from "@/lib/dm/mutation-math";
import { applyDamageDeathHook } from "@/lib/dm/death";
import { releaseGrapplesHeldBy } from "@/lib/dm/set-condition";
import { isMassiveDamage } from "@/lib/dm/death-logic";
import { concentrationDamageHook } from "@/lib/dm/concentration";
import {
  damageAdjust,
  effectiveMaxHp,
  pcImmunities,
  pcResistances,
  removeConditions,
} from "@/lib/dm/condition-logic";
import { rollFeatureSave } from "@/lib/dm/contest-roll";
import { holdsFeature } from "@/lib/srd/trait-rules";
import { PRONE } from "@/lib/dm/vitals-logic";
import { authoredAuraResistances } from "@/lib/dm/authored-saves";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { silencedImmunity } from "@/lib/dm/zone-rules";
import { burnWebUnder } from "@/lib/dm/zone-cast";
import { lightOil } from "@/lib/dm/gear-zones";
import { summonImmunities, summonResistances, summonVulnerabilities } from "@/lib/dm/summon-rules";
import { summonAfterDamage } from "@/lib/dm/summon-store";
import { absorbByWard } from "@/lib/dm/arcane-ward";
import { afflictionStress } from "@/lib/dm/afflictions";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { BURNING_OIL_DAMAGE, COVERED_IN_OIL, oilCatches } from "@/lib/srd/gear-weapons";

export type PcDamageInput = {
  // What was rolled or sent, before resistance.
  amount: number;
  type?: string;
  // A critical hit: two death save failures on a character already at 0.
  crit?: boolean;
  // A melee blow meant to knock out: dropped to 0, the character is stable
  // (SRD 5.1, Knocking a Creature Out).
  nonlethal?: boolean;
  // From a spell, a magic weapon or strikes that count as magical, so
  // resistance to nonmagical attacks does not apply.
  magical?: boolean;
  // From a spell: Spell Resistance and Aura of Warding resist it, and so
  // does a form or a summoned creature whose block resists "damage from
  // spells".
  spell?: boolean;
  // A silvered or adamantine weapon, or one a good creature wields: the
  // clauses of a form's or a summoned creature's block that name them (a
  // lycanthrope's "that aren't silvered", damage-logic.ts).
  silvered?: boolean;
  adamantine?: boolean;
  goodWielder?: boolean;
  // The type whose resistance this blow sets aside (Elemental Adept, the
  // Death cleric's Inescapable Destruction), on a character as on an enemy;
  // several, comma-separated, for a spell of two types an adept covers both.
  ignoreResistanceTo?: string;
  // The creature lands prone if any of this damage gets through (a fall).
  knocksProne?: boolean;
  // Disintegrate: dropping to 0 is death, not dying.
  disintegrate?: boolean;
  // The caster's share of a Warding Bond (never shared again).
  bond?: boolean;
  // A blow of several types (a bite's piercing and its poison), raw: each
  // meets the creature's defenses on its own, after the ward (enemy-hit.ts
  // blowByType). `amount` is their total.
  parts?: Array<{ amount: number; type: string }>;
  // Features whose resistance does not hold against this blow (Emissary of
  // Redemption against a creature the paladin attacked).
  exceptFeatures?: string[];
  reason?: string;
};

// What a blow is made of and where it comes from, for the clauses of the
// defenses that name them (a lycanthrope's "that aren't silvered", a form's
// "from nonmagical attacks"), and the type a feature sets its resistance
// aside for. A hit keeps them (last-hit.ts SwingRecord.flags), so a reaction
// that replays it meets the same clauses.
export type BlowFlags = Pick<PcDamageInput, "magical" | "spell" | "silvered" | "adamantine" | "goodWielder" | "ignoreResistanceTo" | "exceptFeatures">;

export type BlowDefenses = {
  resisted: string;
  immune: string;
  vulnerable: string;
  flags: { magical: boolean; spell: boolean; silvered?: boolean; adamantine?: boolean; goodWielder?: boolean };
};

// The defenses a character meets a blow with: their own resistances, an
// ally's aura (Aura of Warding, Shielding Storm), a summoned creature's block,
// the water, a form's block, immunity and vulnerability. `resists` adds what
// a reaction gave against this blow (Absorb Elements). The damage path and
// the hit replay (reaction-refund.ts) both read it, so a blow a reaction
// corrects lands what a fresh blow would: the replay once read the sheet's
// own resistances alone, and a form, an aura, a vulnerability or a magic
// weapon came out different.
export function blowDefenses(campaignId: string, sheet: CharacterSheet, input: BlowFlags & { resists?: string[] }): BlowDefenses {
  // Racial, feature and condition resistances halve matching damage types
  // server-side, on what comes through the ward.
  // Immunities from features (Purity of Body: poison) take all of it.
  // An ally's aura adds its own (Aura of Warding, Shielding Storm): authored-saves.ts.
  // A summoned creature keeps its stat block's (summon-rules.ts).
  // A character in another creature's form keeps that block's too (a fire
  // elemental is immune to fire: beast-forms.ts wildShapeRecord), each its
  // own clause so a "from nonmagical attacks" binds only its own types.
  const shape = sheet.wildShape;
  const ignored = (input.ignoreResistanceTo ?? "").split(",").map((type) => type.trim()).filter(Boolean);
  const resistedLine = [
    [pcResistances(sheet, { magical: input.magical === true, spell: input.spell === true, except: input.exceptFeatures }), ...authoredAuraResistances(campaignId, sheet, { spell: input.spell === true }), summonResistances(sheet), immersedResistance(campaignId, sheet.id), ...(input.resists ?? [])].filter(Boolean).join(", "),
    shape?.resist ?? "",
  ].filter(Boolean).join("; ");
  const resisted = ignored.reduce((line, type) => line.replace(new RegExp(`\\b${type}\\b`, "gi"), ""), resistedLine);
  // Inside Silence, thunder does nothing (zone-rules.ts).
  const immune = `${summonImmunities(sheet)}${pcImmunities(sheet)}${silencedImmunity(campaignId, sheet.id)}${shape?.immune ? `; ${shape.immune}` : ""}`;
  const vulnerable = [summonVulnerabilities(sheet), shape?.vulnerable ?? ""].filter(Boolean).join("; ");
  return {
    resisted,
    immune,
    vulnerable,
    flags: { magical: input.magical === true, spell: input.spell === true, silvered: input.silvered, adamantine: input.adamantine, goodWielder: input.goodWielder },
  };
}

// What of a blow comes through the defenses once an Arcane Ward took
// `absorbed` of it: a blow of several types part by part (each meets
// resistance, immunity and vulnerability on its own, then the hit lands
// once), else the whole of what is left.
export function meetDefenses(
  defenses: BlowDefenses,
  amount: number,
  type: string | undefined,
  parts: Array<{ amount: number; type: string }> | undefined,
  absorbed: number,
): { amount: number; note: string | null; met: Array<{ amount: number; type: string; note: string | null }> | null } {
  const { resisted, immune, vulnerable, flags } = defenses;
  const met = parts?.length
    ? partsPast(parts, absorbed).map((part) => ({ ...part, ...damageAdjust(part.amount, part.type, resisted, immune, vulnerable, flags) }))
    : null;
  const overflow = amount - absorbed;
  const adjusted = met
    ? { amount: met.reduce((sum, part) => sum + part.amount, 0), note: met.map((part) => part.note).filter(Boolean).join("; ") || null }
    : overflow > 0
      ? damageAdjust(overflow, type, resisted, immune, vulnerable, flags)
      : { amount: 0, note: null };
  return { ...adjusted, met };
}

// What of a blow's typed parts comes through after the ward took `absorbed`
// of it, taken off the parts in order.
function partsPast(parts: Array<{ amount: number; type: string }>, absorbed: number) {
  let left = absorbed;
  return parts.map((part) => {
    const taken = Math.min(part.amount, left);
    left -= taken;
    return { ...part, amount: part.amount - taken };
  }).filter((part) => part.amount > 0);
}

function audit(
  campaign: Campaign,
  turnId: string | null,
  sheet: CharacterSheet,
  kind: string,
  delta: Record<string, unknown>,
  reason: string,
  patch: Record<string, unknown>,
) {
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId,
    kind,
    delta,
    reason,
    seq: allocateSeq(campaign.id),
    before: sheet,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
}

function publishSheet(campaign: Campaign, sheetId: string) {
  const updated = patchSheet(sheetId, {});
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

export function applyPcDamage(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  input: PcDamageInput,
): ToolResult {
  const amount = Math.floor(input.amount);
  const reason = (input.reason ?? "").slice(0, 200);
  if (!(amount >= 1)) {
    return { error: "apply_damage needs a positive amount.", retry: true };
  }
  if (sheet.deathSaves?.dead) {
    return { error: `${sheet.name} is already dead.`, retry: true };
  }
  // Oil (SRD 5.1 Adventuring Gear): "If the target takes any fire damage
  // before the oil dries (after 1 minute), the target takes an additional 5
  // fire damage from the burning oil." The coat burns once and is gone, on a
  // character (a turncoat, or a party member a turncoat's flask struck) as
  // on an enemy (enemy-damage.ts); the 5 meets their defences with the rest.
  const fireBlow = /\bfire\b/i.test([input.type ?? "", ...(input.parts ?? []).map((part) => part.type)].join(" "));
  if (oilCatches(sheet.conditions, fireBlow, amount)) {
    const dried = removeConditions(sheet.conditions, sheet.conditionMeta, [COVERED_IN_OIL]);
    const unoiled = patchSheet(sheet.id, { conditions: dried.conditions, conditionMeta: dried.meta }) ?? sheet;
    const burnt = applyPcDamage(campaign, turnId, unoiled, {
      ...input,
      amount: amount + BURNING_OIL_DAMAGE,
      ...(input.parts?.length ? { parts: [...input.parts, { amount: BURNING_OIL_DAMAGE, type: "fire" }] } : {}),
    });
    return burnt.error ? burnt : { ...burnt, burningOil: `The oil on ${sheet.name} catches: ${BURNING_OIL_DAMAGE} more fire damage, and the oil is burnt away.` };
  }
  // An abjurer's Arcane Ward takes the blow first, as it lands: the ward has
  // none of the wizard's own resistances, immunities or vulnerabilities
  // (Sage Advice Compendium; arcane-ward.ts).
  const arcaneWard = absorbByWard(campaign, sheet, amount);
  const { met, ...adjusted } = meetDefenses(blowDefenses(campaign.id, sheet, input), amount, input.type, input.parts, arcaneWard?.absorbed ?? 0);
  const byType = met ? { damageByType: met.map((part) => `${part.amount} ${part.type}${part.note ? ` (${part.note})` : ""}`) } : {};
  if (adjusted.amount <= 0) {
    return {
      ok: true,
      hp: `${sheet.currentHp}/${effectiveMaxHp(sheet)}`,
      damageApplied: 0,
      ...(adjusted.note ? { resistance: `${sheet.name} is ${adjusted.note}` } : {}),
      ...(arcaneWard ? { arcaneWard: arcaneWard.note } : {}),
      ...byType,
      note: `${sheet.name} takes no damage from it.`,
    };
  }
  // Fire burns away the web around them (zone-cast.ts).
  if (fireBlow) {
    burnWebUnder(campaign, sheet.id);
    // And lights the oil it stands in (gear-zones.ts).
    lightOil(campaign, sheet.id, 0);
  }
  // Wild Shape: the beast's hit points take the blow first. While the form
  // holds, the druid's own sheet is untouched and no death hook fires; when
  // it breaks, only the excess carries through into the rest of this same
  // call. Concentration is different: transforming does not end it, so the
  // whole blow, taken in either body, forces the save (SRD 5.1 Wild Shape).
  let carried = adjusted.amount;
  let tempHpNow = sheet.tempHp;
  let shapeInfo: Record<string, unknown> = {};
  if (sheet.wildShape) {
    const shape = wildShapeDamageMath(sheet.wildShape.beastHp, sheet.tempHp, adjusted.amount);
    const form = sheet.wildShape.form;
    // A polymorph breaking on damage also drops its tracked condition.
    const dropPolymorph =
      shape.reverted &&
      sheet.wildShape.kind === "polymorph" &&
      sheet.conditions.some((name) => name.toLowerCase() === "polymorphed");
    const clearedConditions = dropPolymorph
      ? removeConditions(sheet.conditions, sheet.conditionMeta, ["polymorphed"])
      : null;
    const patch: FullPatchSheetInput = shape.reverted
      ? {
          wildShape: null,
          tempHp: shape.tempHp,
          ...(clearedConditions
            ? {
                conditions: clearedConditions.conditions,
                conditionMeta: clearedConditions.meta,
              }
            : {}),
        }
      : {
          wildShape: { ...sheet.wildShape, beastHp: shape.beastHp },
          tempHp: shape.tempHp,
        };
    patchSheet(sheet.id, patch);
    // currentHp rides along unchanged: it is what the event log reports
    // and the druid's own pool genuinely did not move.
    audit(
      campaign,
      turnId,
      sheet,
      "apply_damage",
      { amount, form, currentHp: sheet.currentHp, ...shape },
      reason,
      patch,
    );
    publishSheet(campaign, sheet.id);
    if (!shape.reverted) {
      const proneInfo = landProne(campaign, turnId, sheet.id, input, adjusted.amount, reason);
      const concentrationInfo = concentrationDamageHook(campaign, turnId, sheet, adjusted.amount);
      return {
        ok: true,
        form: `${form}: ${shape.beastHp}/${sheet.wildShape.beastMaxHp} HP`,
        ...(adjusted.note ? { resistance: `${sheet.name} is ${adjusted.note}` } : {}),
        ...(shape.absorbed ? { tempHpAbsorbed: shape.absorbed } : {}),
        ...proneInfo,
        note: `The beast form absorbs it; ${sheet.name}'s own hit points are untouched.`,
        ...concentrationInfo,
      };
    }
    carried = shape.carryover;
    tempHpNow = shape.tempHp;
    shapeInfo = {
      wildShape: `${form} collapses and ${sheet.name} returns to their own body${
        carried > 0 ? `, taking the remaining ${carried} damage` : " unharmed by the excess"
      }.`,
    };
  }

  const math = applyDamageMath(sheet.currentHp, tempHpNow, carried);
  // Damage taken keeps a rage alive through a turn with no attack in it
  // (src/lib/dm/condition-tick.ts endTurnRage).
  const ragingAs = sheet.conditions.find((entry) => entry.toLowerCase() === RAGING);
  const stoked: { conditionMeta?: ConditionMetaMap } =
    ragingAs && carried > 0
      ? {
          conditionMeta: {
            ...(sheet.conditionMeta as ConditionMetaMap),
            [ragingAs]: { ...(sheet.conditionMeta as ConditionMetaMap)[ragingAs], stoked: true },
          },
        }
      : {};
  patchSheet(sheet.id, { currentHp: math.currentHp, tempHp: math.tempHp, ...stoked });
  audit(campaign, turnId, sheet, "apply_damage", { amount, ...math, type: input.type ?? "" }, reason, {
    currentHp: math.currentHp,
    tempHp: math.tempHp,
    ...stoked,
  });
  publishSheet(campaign, sheet.id);
  // Damage is great stress: cackle fever's laughter, madness's confusion
  // (src/lib/dm/afflictions.ts).
  if (carried > 0 && !math.dropped) {
    afflictionStress(campaign, turnId, sheet.id, "damage");
  }
  // A summoned creature at 0 hit points disappears (summon-store.ts).
  const vanished = summonAfterDamage(campaign, sheet, math.dropped, carried);
  if (vanished) {
    return { ok: true, hp: `${math.currentHp}/${sheet.maxHp}`, damageApplied: carried, ...(math.dropped ? { dropped: true } : {}), vanished };
  }
  const bond = wardingBondShare(campaign, turnId, sheet, input, adjusted.amount);
  const proneInfo = { ...landProne(campaign, turnId, sheet.id, input, adjusted.amount, reason), ...bond };
  // A hero held at 1 hit point (Death Ward, Undying Sentinel, Relentless
  // Endurance, Relentless Rage) still took the blow: the concentration save,
  // the stress of damage and what their defences did ride the hold as they
  // ride any other hit. Each hold returned before them, so a concentrating
  // paladin held up kept the spell with no save.
  const tookIt = (held: Record<string, unknown>): ToolResult => {
    afflictionStress(campaign, turnId, sheet.id, "damage");
    return {
      ...held,
      ...shapeInfo,
      ...proneInfo,
      ...(adjusted.note ? { resistance: `${sheet.name} is ${adjusted.note}` } : {}),
      ...byType,
      ...(math.absorbed ? { tempHpAbsorbed: math.absorbed } : {}),
      ...concentrationDamageHook(campaign, turnId, sheet, sheet.wildShape ? adjusted.amount : carried),
    };
  };
  const ward = math.dropped ? deathWardPatch(getSheetById(sheet.id) ?? sheet) : null;
  if (ward) {
    patchSheet(sheet.id, ward);
    audit(campaign, turnId, sheet, "apply_damage", { deathWard: true }, reason, ward);
    publishSheet(campaign, sheet.id);
    return tookIt({ ok: true, hp: `1/${effectiveMaxHp(sheet)}`, deathWard: true, note: `Death Ward holds ${sheet.name} at 1 HP instead of 0, and the spell ends.` });
  }
  // Relentless Endurance: a half-orc who would drop stays up at 1 HP
  // instead, once per long rest. The server burns the use itself, so the
  // death engine never sees the drop. It answers being reduced to 0 "but not
  // killed outright", so massive damage goes past it to the death engine
  // with the use unspent. Undying Sentinel (Oath of the Ancients 15) holds the
  // same way; without this line its use sat unspent while the paladin fell.
  if (math.dropped && !input.disintegrate && !isMassiveDamage(math.overkill, effectiveMaxHp(sheet))) {
    const sentinel = spendUndyingSentinel(sheet.resources);
    if (sentinel) {
      const patch: FullPatchSheetInput = { currentHp: 1, resources: sentinel };
      patchSheet(sheet.id, patch);
      audit(campaign, turnId, sheet, "apply_damage", { undyingSentinel: true }, reason, patch);
      publishSheet(campaign, sheet.id);
      return tookIt({
        ok: true,
        hp: `1/${effectiveMaxHp(sheet)}`,
        undyingSentinel: true,
        note: `${sheet.name} should have fallen, but Undying Sentinel holds them at 1 HP. The feature is now spent until a long rest.`,
      });
    }
    const spent = spendRelentlessEndurance(sheet.resources);
    if (spent) {
      const patch: FullPatchSheetInput = { currentHp: 1, resources: spent };
      patchSheet(sheet.id, patch);
      audit(campaign, turnId, sheet, "apply_damage", { relentlessEndurance: true }, reason, patch);
      publishSheet(campaign, sheet.id);
      return tookIt({
        ok: true,
        hp: `1/${effectiveMaxHp(sheet)}`,
        relentlessEndurance: true,
        note: `${sheet.name} should have fallen, but Relentless Endurance holds them at 1 HP. The feature is now spent until a long rest.`,
      });
    }
  }
  // Relentless Rage (barbarian 11): raging and dropped to 0 but not killed
  // outright, a CON save keeps them at 1 hit point. The DC is 10, 5 more for
  // every use since their last rest, which the counter keeps.
  const relentless = relentlessRage(campaign, turnId, sheet, math, reason);
  if (relentless) {
    return tookIt(relentless);
  }
  // A Wildfire druid's spirit gives itself up for them, then a Shadow
  // sorcerer's save. Each answers the drop itself, so it runs here, before
  // the death engine sees it: played as a card afterwards it was refused,
  // the hero being at 0, and played before it spent the use for nothing.
  const revival = blazingRevival(campaign, turnId, sheet, math, input, reason);
  if (revival) {
    return tookIt(revival);
  }
  const grave = strengthOfTheGrave(campaign, turnId, sheet, math, input, adjusted.amount, reason);
  if (grave) {
    return tookIt(grave);
  }
  // A barbarian knocked unconscious stops raging. Checked after Relentless
  // Endurance, which keeps them on their feet still raging.
  let rageInfo: Record<string, unknown> = {};
  if (math.dropped && sheet.conditions.some((entry) => entry.toLowerCase() === RAGING)) {
    const now = getSheetById(sheet.id) ?? sheet;
    const cleared = removeConditions(now.conditions, now.conditionMeta, [RAGING]);
    const patch: FullPatchSheetInput = {
      conditions: cleared.conditions,
      conditionMeta: cleared.meta,
    };
    patchSheet(sheet.id, patch);
    audit(campaign, turnId, now, "clear_condition", { condition: RAGING }, reason, patch);
    publishSheet(campaign, sheet.id);
    rageInfo = { rageEnded: `${sheet.name}'s rage ends as they fall.` };
  }
  // Death engine: dropping to 0 starts the dying track; damage while
  // already down adds automatic failures; massive damage kills.
  // Disintegrate leaves nothing to be dying: the drop is death itself.
  const fatal = input.disintegrate && math.dropped ? { ...math, overkill: Math.max(math.overkill, effectiveMaxHp(sheet)) } : math;
  const deathInfo = applyDamageDeathHook(campaign, turnId, sheet, fatal, input.crit === true, input.nonlethal === true && !input.disintegrate);
  // Unconscious at 0 is incapacitated: a grapple they held ends.
  const letGo = math.dropped ? releaseGrapplesHeldBy(campaign, sheet.id) : [];
  // Concentration: damage forces the CON save server-side. A form that broke
  // took the blow too, so the save is against all of it.
  const concentrationInfo = concentrationDamageHook(
    campaign,
    turnId,
    sheet,
    sheet.wildShape ? adjusted.amount : carried,
  );
  return {
    ok: true,
    hp: `${math.currentHp}/${effectiveMaxHp(sheet)}`,
    ...shapeInfo,
    ...rageInfo,
    ...proneInfo,
    ...(adjusted.note ? { resistance: `${sheet.name} is ${adjusted.note}` } : {}),
    ...byType,
    ...(math.absorbed ? { tempHpAbsorbed: math.absorbed } : {}),
    ...(math.dropped && !("note" in deathInfo)
      ? { dropped: true, note: `${sheet.name} falls to 0 HP.` }
      : math.dropped
        ? { dropped: true }
        : {}),
    ...deathInfo,
    ...(letGo.length ? { grappleEnded: letGo } : {}),
    ...concentrationInfo,
  };
}

function relentlessRage(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  math: { dropped: boolean; overkill: number },
  reason: string,
): Record<string, unknown> | null {
  if (
    !math.dropped ||
    isMassiveDamage(math.overkill, effectiveMaxHp(sheet)) ||
    !sheet.conditions.some((entry) => entry.toLowerCase() === RAGING) ||
    !holdsFeature(sheet, "relentless rage")
  ) {
    return null;
  }
  const used = sheet.resources?.relentless_rage?.used ?? 0;
  const dc = 10 + 5 * used;
  const save = rollFeatureSave(campaign, sheet, "con", dc, "Relentless Rage");
  const now = getSheetById(sheet.id) ?? sheet;
  const resources = {
    ...now.resources,
    relentless_rage: { max: now.resources?.relentless_rage?.max ?? 99, used: used + 1 },
  };
  if (!save.success) {
    patchSheet(sheet.id, { resources });
    return null;
  }
  const patch: FullPatchSheetInput = { currentHp: 1, resources };
  patchSheet(sheet.id, patch);
  audit(campaign, turnId, now, "apply_damage", { relentlessRage: true, dc }, reason, patch);
  publishSheet(campaign, sheet.id);
  return {
    ok: true,
    hp: `1/${effectiveMaxHp(sheet)}`,
    relentlessRage: `CON save ${save.total} against DC ${dc}: ${sheet.name} stays on their feet at 1 hit point, still raging. The next save is DC ${dc + 5} until they rest.`,
  };
}

// A use of a once-a-rest feature, spent; null when none is left.
function spendUse(resources: CharacterSheet["resources"], id: string): CharacterSheet["resources"] | null {
  const state = resources?.[id];
  return state && state.used < state.max ? { ...resources, [id]: { max: state.max, used: state.used + 1 } } : null;
}

export const WILDFIRE_SPIRIT = "wildfire spirit";

// Blazing Revival (Circle of Wildfire 14): dropped to 0 but not killed
// outright while the wildfire spirit is out, the spirit drops to 0 and the
// druid regains half their hit point maximum and stands. The spirit is a
// condition on the druid here, with no token to measure its 120 feet from,
// so its being out is all that is checked. Taken whenever it can be: being
// up again at half is always worth the spirit, as Undying Sentinel's hold is
// taken whenever it can be.
function blazingRevival(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  math: { dropped: boolean; overkill: number },
  input: PcDamageInput,
  reason: string,
): Record<string, unknown> | null {
  const now = getSheetById(sheet.id) ?? sheet;
  if (!math.dropped || input.disintegrate || isMassiveDamage(math.overkill, effectiveMaxHp(now)) || !now.conditions.some((entry) => entry.toLowerCase() === WILDFIRE_SPIRIT)) {
    return null;
  }
  const resources = spendUse(now.resources, "sub_blazing_revival");
  if (!resources) {
    return null;
  }
  const hp = Math.max(1, Math.floor(effectiveMaxHp(now) / 2));
  const cleared = removeConditions(now.conditions, now.conditionMeta, [WILDFIRE_SPIRIT]);
  const patch: FullPatchSheetInput = { currentHp: hp, resources, conditions: cleared.conditions, conditionMeta: cleared.meta };
  patchSheet(sheet.id, patch);
  audit(campaign, turnId, now, "apply_damage", { blazingRevival: true }, reason, patch);
  publishSheet(campaign, sheet.id);
  return {
    ok: true,
    hp: `${hp}/${effectiveMaxHp(now)}`,
    blazingRevival: `${sheet.name} should have fallen, but their wildfire spirit drops to 0 hit points in their place: Blazing Revival brings them back at ${hp} hit points, on their feet. The spirit is gone, and the feature is spent until a long rest.`,
  };
}

// Strength of the Grave (Shadow Magic 1): damage that drops the sorcerer to 0
// is answered by a Charisma save against 5 + the damage taken, which leaves
// them at 1 instead. Not against radiant damage or a critical hit, and only a
// success spends the use. Rolled whenever it can be, as Relentless Rage's
// save is: a failed one costs nothing.
function strengthOfTheGrave(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  math: { dropped: boolean; overkill: number },
  input: PcDamageInput,
  taken: number,
  reason: string,
): Record<string, unknown> | null {
  const now = getSheetById(sheet.id) ?? sheet;
  const radiant = /\bradiant\b/i.test([input.type ?? "", ...(input.parts ?? []).map((part) => part.type)].join(" "));
  if (!math.dropped || input.disintegrate || input.crit === true || radiant || isMassiveDamage(math.overkill, effectiveMaxHp(now))) {
    return null;
  }
  const resources = spendUse(now.resources, "sub_strength_of_the_grave");
  if (!resources) {
    return null;
  }
  const dc = 5 + Math.max(0, taken);
  const save = rollFeatureSave(campaign, now, "cha", dc, "Strength of the Grave");
  if (!save.success) {
    return null;
  }
  const after = getSheetById(sheet.id) ?? now;
  const patch: FullPatchSheetInput = { currentHp: 1, resources: { ...after.resources, sub_strength_of_the_grave: resources.sub_strength_of_the_grave } };
  patchSheet(sheet.id, patch);
  audit(campaign, turnId, after, "apply_damage", { strengthOfTheGrave: true, dc }, reason, patch);
  publishSheet(campaign, sheet.id);
  return {
    ok: true,
    hp: `1/${effectiveMaxHp(now)}`,
    strengthOfTheGrave: `CHA save ${save.total} against DC ${dc}: ${sheet.name} drops to 1 hit point instead of 0. Strength of the Grave is spent until a long rest.`,
  };
}

// A fall that hurt leaves the creature on the ground (SRD 5.1, Falling: it
// lands prone unless it avoids taking damage from the fall).
function landProne(
  campaign: Campaign,
  turnId: string,
  sheetId: string,
  input: PcDamageInput,
  taken: number,
  reason: string,
): Record<string, unknown> {
  if (!input.knocksProne || taken <= 0) {
    return {};
  }
  const now = getSheetById(sheetId);
  if (!now || now.conditions.some((entry) => entry.toLowerCase() === PRONE)) {
    return {};
  }
  const patch: FullPatchSheetInput = { conditions: [...now.conditions, PRONE] };
  patchSheet(sheetId, patch);
  audit(campaign, turnId, now, "set_condition", { condition: PRONE }, reason, patch);
  publishSheet(campaign, sheetId);
  return { prone: `${now.name} lands prone.` };
}

// Warding Bond: each time the warded creature takes damage, the caster who
// bound it takes the same amount (SRD 5.1). The caster's share is not shared
// again.
function wardingBondShare(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  input: PcDamageInput,
  taken: number,
): Record<string, unknown> {
  const bond = sheet.conditions.find((entry) => entry.trim().toLowerCase() === "warding bond");
  const casterId = bond ? (sheet.conditionMeta as ConditionMetaMap)[bond]?.source : undefined;
  const caster = casterId && casterId !== sheet.id ? getSheetById(casterId) : null;
  if (input.bond || taken <= 0 || !caster || caster.deathSaves?.dead) {
    return {};
  }
  applyPcDamage(campaign, turnId, caster, { amount: taken, bond: true, reason: `Warding Bond with ${sheet.name}` });
  return { wardingBond: `${caster.name} takes the same ${taken} damage through the Warding Bond.` };
}
