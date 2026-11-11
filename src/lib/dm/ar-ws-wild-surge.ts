// Wild Magic Surge (Wild Magic 1): "After casting a sorcerer spell of 1st
// level or higher, the GM may have you roll a d20; on a 1 you roll on the wild
// magic table." The engine held no table: the spend (the GM's call, no card)
// only gave a spent Tides of Chaos back, and the d20 and the table were
// narration with no written reason.
//
// The chance: every sorcerer spell of 1st level or higher cast by a holder
// leaves "surge chance" for a round (surgeChanceAfter, called by cast-guard.ts
// castSpell), Tides of Chaos spent or not; it was left only with Tides spent.
// The GM's call, use_resource "Wild Magic Surge", needs the chance and spends
// it:
// - with Tides of Chaos spent, the surge is triggered outright ("the GM can
//   then trigger a Wild Magic Surge to restore the use", Tides of Chaos): the
//   table is rolled and the use comes back;
// - otherwise the sorcerer's d20 is rolled, and on a 1 the table is.
// The table is the app's own (src/lib/srd/ar-ws-wild-surge-table.ts, an
// original table, not the printed one); a roll on it is a die of its length,
// and the server applies the entry rolled. The d20 is no attack roll, check
// or save, so nothing that rides those (advantage, Lucky, Trance of Order)
// touches it, and it is the server's die on any seat.
//
// Called by authored-spend-effects.ts resolveSpendEffect (kind wild_magic_surge; the barbarian's Wild Surge is kind wild_surge).

import { getActiveEncounter, getEnemy, listEnemies } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { withinFeet } from "@/lib/dm/authored-saves";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { creditFeatureTeleport } from "@/lib/dm/feature-teleport";
import { rollCharacterSave, rollEnemySave } from "@/lib/dm/forced-save";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { regainHitPoints } from "@/lib/dm/regain";
import { rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import type { ToolError } from "@/lib/dm/tool-errors";
import { computeSheetDerived } from "@/lib/srd";
import { opensSurgeChance } from "@/lib/srd/authored-effects-more";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import { CHAOS_PICK, chaosFaces, WILD_SURGE_TABLE, type SurgeEntry } from "@/lib/srd/ar-ws-wild-surge-table";
import { resourceName } from "@/lib/srd/class-resources";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";

export const WILD_MAGIC_SURGE = "Wild Magic Surge";

type Does = Extract<SpendDoes, { kind: "wild_magic_surge" }>;
type Resolution = ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> };

// What a casting says of the surge, or null when it opens no chance: a
// sorcerer spell of 1st level or higher, cast by a holder of the feature.
export function surgeChanceAfter(sheet: CharacterSheet, spell: { level: number; classes: string[] } | null): string | null {
  if (!spell || spell.level < 1 || !spell.classes.some((entry) => textKey(entry) === "sorcerer") || !holdsFeature(sheet, WILD_MAGIC_SURGE)) {
    return null;
  }
  return opensSurgeChance(sheet.resources, spell)
    ? `Tides of Chaos is spent: the GM may have ${sheet.name} roll on the wild magic table now, and if so use_resource "${WILD_MAGIC_SURGE}" rolls it and gives the use back.`
    : `The GM may have ${sheet.name} roll a d20 for a ${WILD_MAGIC_SURGE} now: use_resource "${WILD_MAGIC_SURGE}" rolls it, and on a 1 rolls on the wild magic table.`;
}

const dice = (ctx: SpendContext, label: string, expression: string) =>
  rollCard(ctx.campaign, ctx.turn, ctx.sheet.id, "custom", `${ctx.sheet.name}: ${WILD_MAGIC_SURGE}, ${label}`, expression, null).total;

// The entry applied: what it writes on the sorcerer's own sheet (built on the
// sheet as it stands once the entry's other writes are done) and the lines.
function applyEntry(ctx: SpendContext, entry: SurgeEntry): { patch: (now: CharacterSheet) => FullPatchSheetInput; lines: string[] } {
  const { campaign, sheet } = ctx;
  const effect = entry.effect;
  const none = () => ({});
  switch (effect.kind) {
    case "condition":
      return {
        lines: [],
        patch: (now) => ({
          conditions: [...now.conditions.filter((held) => !isConditionNamed(held, effect.condition)), effect.condition],
          conditionMeta: {
            ...(now.conditionMeta as ConditionMetaMap),
            ...(effect.untilNextTurnEnds ? { [effect.condition]: { untilTurnEndOf: sheet.id } } : effect.rounds ? { [effect.condition]: { rounds: effect.rounds } } : {}),
          },
        }),
      };
    case "regain_points": {
      const state = sheet.resources.sorcery_points;
      const back = state ? Math.min(state.used, dice(ctx, entry.name, effect.dice)) : 0;
      return {
        lines: [state ? `${back} sorcery point${back === 1 ? "" : "s"} back (${state.max - state.used + back}/${state.max}).` : `${sheet.name} has no sorcery points to regain.`],
        patch: (now) => (state && back > 0 ? { resources: { ...now.resources, sorcery_points: { max: state.max, used: (now.resources.sorcery_points?.used ?? state.used) - back } } } : {}),
      };
    }
    case "regain_slot": {
      const slots = sheet.spellcasting?.slots ?? {};
      const level = [...Array(effect.maxLevel).keys()].map((at) => effect.maxLevel - at).find((entryLevel) => (slots[String(entryLevel)]?.used ?? 0) > 0);
      return {
        lines: [level ? `A spent level ${level} spell slot comes back.` : `No spell slot of level ${effect.maxLevel} or lower is spent: nothing comes back.`],
        patch: (now) => {
          const casting = now.spellcasting;
          const slot = level ? casting?.slots?.[String(level)] : undefined;
          return casting && slot && slot.used > 0 ? { spellcasting: { ...casting, slots: { ...casting.slots, [String(level)]: { ...slot, used: slot.used - 1 } } } } : {};
        },
      };
    }
    case "temp_hp": {
      const amount = dice(ctx, entry.name, effect.dice) + ctx.held.level;
      return {
        lines: [amount > sheet.tempHp ? `${amount} temporary hit points.` : `${sheet.name} keeps their ${sheet.tempHp} temporary hit points (the new ${amount} would be lower).`],
        patch: (now) => (amount > now.tempHp ? { tempHp: amount } : {}),
      };
    }
    case "teleport":
      creditFeatureTeleport(sheet.id, ctx.spend.name, effect.feet);
      return { lines: [`Move their token with move_token, teleport true, spell "${ctx.spend.name}" and casterCharacterId ${sheet.id}, up to ${effect.feet} feet, to the space the player chooses.`], patch: none };
    case "heal": {
      const gained = regainHitPoints(campaign, ctx.turnId || null, sheet, dice(ctx, entry.name, effect.dice), `${ctx.spend.name}: ${entry.name}`);
      return { lines: [`${sheet.name} regains ${gained} hit points.`], patch: none };
    }
    case "self_damage": {
      const amount = dice(ctx, entry.name, effect.dice);
      const out = applyPcDamage(campaign, ctx.turnId, getSheetById(sheet.id) ?? sheet, { amount, type: effect.type, reason: `${ctx.spend.name}: ${entry.name}` });
      return { lines: [typeof out.error === "string" ? out.error : `${sheet.name} takes ${amount} ${effect.type} damage (HP ${String(out.hp ?? "")}).`], patch: none };
    }
    case "burst":
      return { lines: burst(ctx, entry, effect), patch: none };
  }
}

// Every other creature within reach saves or takes the dice, half on a success.
function burst(ctx: SpendContext, entry: SurgeEntry, effect: Extract<SurgeEntry["effect"], { kind: "burst" }>): string[] {
  const { campaign, sheet } = ctx;
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return [`No fight is on, so nobody is measured: the GM says who stands within ${effect.rangeFt} feet, and each makes a ${effect.save.toUpperCase()} save against DC ${computeSheetDerived(sheet).spellSaveDc ?? 10} for ${effect.dice} ${effect.type} damage, half on a success.`];
  }
  const derived = computeSheetDerived(sheet);
  const dc = derived.spellSaveDc ?? 8 + derived.proficiencyBonus + derived.abilityMods.cha;
  const foes = listEnemies(encounter.id).filter((enemy) => enemy.status === "alive" && withinFeet(encounter.id, sheet.id, enemy.id, effect.rangeFt));
  const friends = listSheets(campaign.id)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((other) => other.id !== sheet.id && !other.deathSaves?.dead && encounter.order.some((slot) => slot.kind === "pc" && slot.characterId === other.id) && withinFeet(encounter.id, sheet.id, other.id, effect.rangeFt));
  if (!foes.length && !friends.length) {
    return [`Nobody else stands within ${effect.rangeFt} feet of ${sheet.name}.`];
  }
  const rolled = rollCard(campaign, ctx.turn, sheet.id, "damage", `${ctx.spend.name}: ${entry.name}`, effect.dice, sheetAttacker(sheet)).total;
  const lines: string[] = [];
  for (const enemy of foes) {
    const save = rollEnemySave(campaign.id, enemy, effect.save, dc, { magical: true, record: { turn: ctx.turn ?? undefined, detail: `${enemy.displayName}: ${effect.save.toUpperCase()} save against ${ctx.spend.name}` } });
    const amount = save.success ? Math.floor(rolled / 2) : rolled;
    lines.push(amount > 0 ? hurtEnemy(campaign, encounter, getEnemy(enemy.id) ?? enemy, amount, effect.type, ctx.spend.name) : `${enemy.displayName} takes no damage.`);
  }
  for (const friend of friends) {
    const save = rollCharacterSave(campaign, ctx.turn, friend, effect.save, dc, `${friend.name}: ${effect.save.toUpperCase()} save against ${ctx.spend.name}`);
    const amount = save.success ? Math.floor(rolled / 2) : rolled;
    const out = amount > 0 ? applyPcDamage(campaign, ctx.turnId, getSheetById(friend.id) ?? friend, { amount, type: effect.type, reason: `${ctx.spend.name}: ${entry.name}` }) : null;
    lines.push(`${friend.name} ${save.success ? "saves" : "fails"} and takes ${amount} ${effect.type} damage${out && typeof out.hp === "string" ? ` (HP ${out.hp})` : ""}.`);
  }
  return lines;
}

export function wildSurge(ctx: SpendContext, does: Does): Resolution {
  const { sheet } = ctx;
  const tides = sheet.resources[does.pool];
  const tidesSpent = Boolean(tides && tides.max > 0 && tides.used >= tides.max);
  const result: Record<string, unknown> = {};
  // With Tides of Chaos spent the surge is triggered; otherwise the d20 decides.
  let surges = tidesSpent;
  if (!tidesSpent) {
    const d20 = rollCard(ctx.campaign, ctx.turn, sheet.id, "custom", `${sheet.name}: ${WILD_MAGIC_SURGE} (on a 1 the magic surges)`, "1d20", null).total;
    result.d20 = d20;
    surges = d20 === 1;
  }
  const applied: string[] = [];
  let write: (now: CharacterSheet) => FullPatchSheetInput = () => ({});
  // Controlled Chaos: "you can roll twice and use either number". Two
  // different rolls wait on the sorcerer's pick (pickChaos); the same number
  // twice is that entry.
  const chaos = surges && holdsFeature(sheet, CONTROLLED_CHAOS);
  const faces = surges ? Array.from({ length: chaos ? 2 : 1 }, () => entryAt(dice(ctx, "the wild magic table", `1d${WILD_SURGE_TABLE.length}`))) : [];
  if (faces.length === 2 && faces[0] !== faces[1]) {
    result.choices = faces.map((face) => ({ roll: face, name: WILD_SURGE_TABLE[face - 1].name, text: WILD_SURGE_TABLE[face - 1].text }));
    applied.push(`${WILD_MAGIC_SURGE}, Controlled Chaos: ${faces.map((face) => `${face} (${WILD_SURGE_TABLE[face - 1].name})`).join(" or ")}. ${sheet.name} picks one: use_resource "${CONTROLLED_CHAOS}" with variant the number.`);
    write = (now) => ({ conditions: [...now.conditions, CHAOS_PICK], conditionMeta: { ...(now.conditionMeta as ConditionMetaMap), [CHAOS_PICK]: { faces } } as FullPatchSheetInput["conditionMeta"] });
  } else if (faces.length) {
    const face = faces[0];
    const entry = WILD_SURGE_TABLE[face - 1];
    const done = applyEntry(ctx, entry);
    write = done.patch;
    result.surge = { roll: face, of: WILD_SURGE_TABLE.length, name: entry.name, text: entry.text };
    applied.push(`${WILD_MAGIC_SURGE}, ${face} on the table: ${entry.name}. ${entry.text}`, ...done.lines);
  } else {
    applied.push(`${sheet.name} rolls a ${String(result.d20)}: no surge.`);
  }
  // Written on the sheet as the entry left it: the chance is spent, and a
  // spent Tides of Chaos comes back with the surge.
  const now = getSheetById(sheet.id) ?? sheet;
  const cleared = removeConditions(now.conditions, now.conditionMeta as ConditionMetaMap, [does.clears]);
  const cleanSheet = { ...now, conditions: cleared.conditions, conditionMeta: cleared.meta } as CharacterSheet;
  const patch: FullPatchSheetInput = { conditions: cleared.conditions, conditionMeta: cleared.meta, ...write(cleanSheet) };
  if (tidesSpent && tides) {
    const resources = patch.resources ?? now.resources;
    patch.resources = { ...resources, [does.pool]: { max: tides.max, used: Math.max(0, tides.used - 1) } };
    result.restored = `1 ${resourceName(does.pool)} back (${tides.max - tides.used + 1}/${tides.max}).`;
  }
  return { patch, result: { ...result, applied } };
}

const CONTROLLED_CHAOS = "Controlled Chaos";
const entryAt = (face: number) => Math.max(1, Math.min(WILD_SURGE_TABLE.length, face));

// use_resource "Controlled Chaos": the roll named in variant, one of the two
// the surge left (CHAOS_PICK), is the entry applied; the other is dropped.
export function pickChaos(ctx: SpendContext): Resolution {
  const sheet = getSheetById(ctx.sheet.id) ?? ctx.sheet;
  const faces = chaosFaces(sheet);
  const asked = Number((ctx.args.variant ?? "").trim());
  if (!faces.includes(asked)) {
    return { error: `${CONTROLLED_CHAOS} uses one of the two wild magic rolls the surge made: variant ${faces.join(" or ")}. Nothing was spent.`, retry: true };
  }
  const entry = WILD_SURGE_TABLE[asked - 1];
  const done = applyEntry(ctx, entry);
  const now = getSheetById(sheet.id) ?? sheet;
  const cleared = removeConditions(now.conditions, now.conditionMeta as ConditionMetaMap, [CHAOS_PICK]);
  const clean = { ...now, conditions: cleared.conditions, conditionMeta: cleared.meta } as CharacterSheet;
  return {
    patch: { conditions: cleared.conditions, conditionMeta: cleared.meta, ...done.patch(clean) },
    result: { surge: { roll: asked, of: WILD_SURGE_TABLE.length, name: entry.name, text: entry.text }, applied: [`${CONTROLLED_CHAOS}: ${asked} on the table, ${entry.name}. ${entry.text}`, ...done.lines] },
  };
}
