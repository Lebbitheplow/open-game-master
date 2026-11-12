// The druid and artificer spends of the gap study's second wave that the
// shared authored-spend door (src/lib/dm/authored-spends.ts) calls out to:
// a spell slot paying when a feature's own counter is spent (Experimental
// Elixir, Eldritch Cannon: "or by expending a spell slot of 1st level or
// higher"), the die that picks an option nobody named (Experimental Elixir's
// d6), and the temporary hit points a drinker gains beside the effect
// (Restorative Reagents). Every refusal happens in the door before anything
// is written; these only answer or roll.
import { patchSheet, getSheetById } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { rollCard } from "@/lib/dm/roll-card";
import { diceFor, rollOwnDice } from "@/lib/dm/character-roll";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import type { SpendAction, SpendDoes } from "@/lib/srd/authored-effects-types";
import { resolveFormula } from "@/lib/srd/authored-effects";
import { isNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet, FullPatchSheetInput, Spellcasting } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import { moveSpiritTotem, raiseSpiritTotem } from "@/lib/dm/spirit-totem";
import { hurlSpores } from "@/lib/dm/spreading-spores";
import { createEldritchCannon, summonWildfireSpirit } from "@/lib/dm/feature-summons-dra";
import { getActiveBoard } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { liveZones } from "@/lib/dm/zone-store";
import { zoneKey } from "@/lib/battlemap/zones-spells";
import { chebyshev } from "@/lib/battlemap/types";
import { WEAPON_HIT } from "@/lib/dm/action-budget";
import { textKey } from "@/lib/language/text-logic";
import { unseenBecause, withinFeet } from "@/lib/dm/authored-saves";

// The lowest spell slot of 1st level or higher the sheet has left, or null.
export function lowestSlotLeft(sheet: Pick<CharacterSheet, "spellcasting">): number | null {
  const slots = sheet.spellcasting?.slots ?? {};
  const levels = Object.keys(slots)
    .map(Number)
    .filter((level) => level >= 1 && (slots[String(level)]?.max ?? 0) - (slots[String(level)]?.used ?? 0) > 0)
    .sort((a, b) => a - b);
  return levels[0] ?? null;
}

// The casting block with one slot of that level spent.
export function spendSlotOf(casting: NonNullable<Spellcasting>, level: number): NonNullable<Spellcasting> {
  const slot = casting.slots[String(level)];
  return slot ? { ...casting, slots: { ...casting.slots, [String(level)]: { ...slot, used: slot.used + 1 } } } : casting;
}

type Option = { does: SpendDoes; action?: SpendAction; afterWeaponHit?: boolean };

// The option the spend's die picks, in the order the options are listed
// ("its effect rolled on a d6": 1 healing ... 6 transformation). A die with
// more faces than options wraps round, so every face lands on one.
export function rollOption(ctx: SpendContext, does: Extract<SpendDoes, { kind: "variants" }>): { key: string; option: Option } {
  const keys = Object.keys(does.options);
  const face = Math.max(1, Number(rollCard(ctx.campaign, ctx.turn, ctx.sheet.id, "custom", `${ctx.spend.name}: its effect`, `1${does.roll ?? "d6"}`, null).total));
  const key = keys[(face - 1) % keys.length];
  return { key, option: does.options[key] };
}

// Restorative Reagents: "A creature that drinks one of your experimental
// elixirs also gains 2d6 + your Intelligence modifier temporary hit points
// (minimum 1)". Temporary hit points do not stack: the larger stands. Null
// when the holder lacks the feature, or the drinker already holds more.
export function drinkerTempHp(ctx: SpendContext): string | null {
  const rider = ctx.spend.drinker;
  if (!rider || !ctx.sheet.features.some((feature) => isNamed(feature.name, rider.feature))) {
    return null;
  }
  const drinker = (ctx.args.targetCharacterId ? getSheetById(ctx.args.targetCharacterId) : null) ?? getSheetById(ctx.sheet.id);
  if (!drinker || drinker.campaignId !== ctx.campaign.id || drinker.deathSaves?.dead) {
    return null;
  }
  const dice = resolveFormula(rider.tempHp, ctx.held.level, ctx.mods);
  // The artificer's own dice (character-roll.ts rollOwnDice), whoever drinks.
  const rolled = Math.max(1, Number(rollOwnDice(ctx.campaign, ctx.sheet, diceFor(`${rider.feature}: temporary hit points`, ctx.sheet, drinker), String(dice), { turn: ctx.turn }).total));
  if (rolled <= drinker.tempHp) {
    return `${drinker.name} keeps their ${drinker.tempHp} temporary hit points (${rider.feature} rolled ${rolled}).`;
  }
  const updated = patchSheet(drinker.id, { tempHp: rolled });
  if (updated) {
    publishPersisted(ctx.campaign.id, "sheet_updated", { sheet: updated });
  }
  return `${drinker.name}: ${rolled} temporary hit points (${rider.feature}).`;
}

type Resolution = ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> };

// The square use_resource's x and y name (the console and the Hand send them).
const pointOf = (ctx: SpendContext) => (ctx.args.x !== undefined && ctx.args.y !== undefined ? { x: ctx.args.x, y: ctx.args.y } : undefined);

// Every kind this module resolves comes through here (resolveSpendEffect
// carries one case line per kind).
// The holder's condition, written before the creature is made: the board
// area that lasts by it (the cannon's square) holds from the moment it is laid.
function holdCondition(ctx: SpendContext, condition: string, rounds: number) {
  const fresh = getSheetById(ctx.sheet.id) ?? ctx.sheet;
  const kept = fresh.conditions.filter((entry) => textKey(entry) !== textKey(condition));
  const updated = patchSheet(fresh.id, {
    conditions: [...kept, condition],
    conditionMeta: { ...fresh.conditionMeta, [condition]: { rounds } } as FullPatchSheetInput["conditionMeta"],
  });
  if (updated) {
    publishPersisted(ctx.campaign.id, "sheet_updated", { sheet: updated });
  }
  return updated ?? fresh;
}

export function draSpend(ctx: SpendContext, does: Extract<SpendDoes, { kind: "spirit_totem" | "spirit_totem_move" | "spreading_spores" | "wildfire_spirit" | "eldritch_cannon" }>): Resolution {
  switch (does.kind) {
    case "wildfire_spirit":
      return summonWildfireSpirit(ctx.campaign, ctx.turnId, holdCondition(ctx, does.condition, does.rounds));
    case "eldritch_cannon":
      return createEldritchCannon(ctx.campaign, holdCondition(ctx, does.condition, does.rounds));
    case "spreading_spores":
      return hurlSpores(ctx.campaign, ctx.sheet, { at: pointOf(ctx), targetEnemyId: ctx.args.targetEnemyId, rangeFt: does.rangeFt, rounds: does.rounds });
    case "spirit_totem":
      return raiseSpiritTotem(ctx.campaign, ctx.sheet, { spirit: does.spirit, rounds: does.rounds, at: pointOf(ctx) });
    case "spirit_totem_move":
      return moveSpiritTotem(ctx.campaign, ctx.sheet, pointOf(ctx));
  }
}

// A spend that works through something on the board, which must stand within
// `feet` of its holder (Eldritch Cannon: "a bonus action activates it if it is
// within 60 feet"). With no board nothing is measured; with a board and no
// such area the thing is gone (a cannon destroyed), and the spend is refused.
export function nearZoneRefusal(campaignId: string, sheet: CharacterSheet, near: { zone: string; feet: number; label: string }, spendName: string): ToolError | null {
  const board = getActiveBoard(campaignId);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  const self = map ? getTokenByRef(map.id, sheet.id) : null;
  if (!board || !map || !self) {
    return null;
  }
  const areas = liveZones(map, board).filter((zone) => zone.casterId === sheet.id && zoneKey(zone) === zoneKey(near.zone));
  if (!areas.length) {
    return { error: `${sheet.name} has no ${near.label} on the board for ${spendName}. Nothing was spent.`, refused: "rules" };
  }
  const nearest = Math.min(...areas.map((zone) => chebyshev(zone.origin.x, zone.origin.y, self.x, self.y) * 5));
  if (nearest > near.feet) {
    return { error: `${spendName} works within ${near.feet} feet of ${near.label}, and ${sheet.name} stands ${nearest} feet from it. Nothing was spent.`, refused: "rules" };
  }
  return null;
}

// Arcane Jolt's healing: "restore 2d6 hit points to a creature or object you
// can see within 30 feet of it", the target the weapon hit. The turn's hit
// marks name the creatures hit (WEAPON_HIT); off the holder's turn (their
// steel defender's hit) there is no record, and the board's reach is not asked.
export function joltReachRefusal(ctx: SpendContext, ally: CharacterSheet, feet: number): ToolError | null {
  const encounter = getActiveBoard(ctx.campaign.id);
  if (!encounter) {
    return null;
  }
  const hit = (ctx.marks ?? []).filter((mark) => mark.startsWith(WEAPON_HIT)).map((mark) => mark.slice(WEAPON_HIT.length));
  if (hit.length && !hit.some((id) => withinFeet(encounter.id, id, ally.id, feet))) {
    return { error: `${ally.name} is beyond ${feet} feet of the creature ${ctx.sheet.name} hit; ${ctx.spend.name}'s healing reaches no further. Nothing was spent.`, refused: "rules" };
  }
  const unseen = ally.id === ctx.sheet.id ? null : unseenBecause(encounter.id, ctx.sheet, ally, { hidden: false });
  if (unseen) {
    return { error: `${ctx.sheet.name} cannot see ${ally.name} (${unseen}), and ${ctx.spend.name} heals a creature they can see. Nothing was spent.`, refused: "rules" };
  }
  return null;
}
