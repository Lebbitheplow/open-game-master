// The dark fantasy and cyberpunk counters whose spend does what no shared
// spend kind does, wired by the 2026-11-13 creator audit's second genre pass
// (the authored spend kind "genre_cc" of
// src/lib/srd/authored-effects-genre-cc-a.ts, resolved here from
// src/lib/dm/authored-spend-effects.ts). Each refuses with nothing spent when
// what it needs is not there.
//
//   crown: The Crown Descends, "for 1 minute every enemy within 30 ft is
//     swarmed: half speed, no reactions, and 1d6 piercing at the start of each
//     of its turns": the swarmed condition (src/lib/srd/genre-cc-a-conditions.ts)
//     on every living enemy within 30 feet for ten rounds; its bite is
//     src/lib/dm/genre-cc-a-turns.ts's;
//   rat_tide: Rat Tide, "a swarm floods a 15-ft cube" (20 with Rat Tide
//     (2 uses)): the area of src/lib/battlemap/zones-genre-cc-a.ts thrown
//     onto a creature within 30 feet, and with The Walls Have Teeth the
//     enemies near it lose their reactions at once.
import { getActiveEncounter, listEnemies, patchEnemyConditions } from "@/lib/db/encounters";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import { withinFeet } from "@/lib/dm/authored-saves";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { sideOf } from "@/lib/dm/combatant";
import type { ToolError } from "@/lib/dm/tool-errors";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { SWARMED } from "@/lib/srd/genre-cc-a-conditions";
import { resolveSpendEffect } from "@/lib/dm/authored-spend-effects";
import { refreshTeeth } from "@/lib/dm/genre-cc-a-turns";
import { RAT_TIDE, RAT_TIDE_GROWN } from "@/lib/battlemap/zones-genre-cc-a";
import { getBattleMapForEncounter, listTokens } from "@/lib/db/battle-maps";
import { zonesAfterMove } from "@/lib/dm/zone-triggers";
import { isNamed } from "@/lib/srd/feature-names";

export type GenreCcPlay = "crown" | "rat_tide";

type Resolution = ToolError | { result: Record<string, unknown> };

const MINUTE = 10;

export function genreCcSpend(ctx: SpendContext, play: GenreCcPlay): Resolution {
  switch (play) {
    case "crown":
      return crown(ctx);
    case "rat_tide":
      return ratTide(ctx);
  }
}

function crown(ctx: SpendContext): Resolution {
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (!encounter) {
    return { error: `${ctx.spend.name} swarms the enemies within 30 feet of ${ctx.sheet.name} in a fight, and none is running. Nothing was spent.`, refused: "rules" };
  }
  const mine = sideOf(encounter, "sheet", ctx.sheet.id);
  const foes = listEnemies(encounter.id).filter((enemy) => enemy.status === "alive" && sideOf(encounter, "enemy", enemy.id, enemy) !== mine && withinFeet(encounter.id, ctx.sheet.id, enemy.id, 30));
  if (!foes.length) {
    return { error: `No enemy stands within 30 feet of ${ctx.sheet.name} for ${ctx.spend.name} to swarm. Nothing was spent.`, refused: "rules" };
  }
  for (const enemy of foes) {
    const kept = enemy.conditions.filter((entry) => !isConditionNamed(entry, SWARMED));
    patchEnemyConditions(enemy.id, [...kept, SWARMED], { ...((enemy.conditionMeta ?? {}) as ConditionMetaMap), [SWARMED]: { rounds: MINUTE, source: ctx.sheet.id } } as typeof enemy.conditionMeta);
  }
  publishEncounter(ctx.campaign.id);
  return { result: { applied: `${ctx.spend.name}: ${foes.map((enemy) => enemy.displayName).join(", ")} ${foes.length === 1 ? "is" : "are"} swarmed for a minute: half speed, no reactions, and 1d6 piercing as each of their turns starts.` } };
}

function ratTide(ctx: SpendContext): Resolution {
  const laid = resolveSpendEffect(ctx, { kind: "zone", lays: RAT_TIDE, rangeFt: 30, dcAbility: "dex", upgrade: { feature: "Rat Tide (2 uses)", lays: RAT_TIDE_GROWN } });
  if ("error" in laid) {
    return laid;
  }
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (!encounter) {
    return laid;
  }
  // "creatures inside save (DEX) or take 2d6 piercing and are distracted":
  // the swarm floods over everyone standing where it lands, as a creature
  // walking in meets it (the area's own enter trigger, zone-triggers.ts).
  const map = getBattleMapForEncounter(encounter.id);
  const zone = map?.spellZones.filter((entry) => entry.casterId === ctx.sheet.id && isNamed(entry.spell, ctx.spend.name)).at(-1);
  const caught: string[] = [];
  if (map && zone) {
    for (const token of listTokens(map.id)) {
      if (token.refId === ctx.sheet.id || (token.kind !== "enemy" && token.kind !== "pc") || !zone.cells.includes(token.y * map.width + token.x)) {
        continue;
      }
      caught.push(...zonesAfterMove(ctx.campaign, encounter.id, { kind: token.kind, refId: token.refId }, { x: -1, y: -1 }, [{ x: token.x, y: token.y }]));
    }
  }
  const teeth = refreshTeeth(ctx.campaign, getActiveEncounter(ctx.campaign.id) ?? encounter);
  return { ...laid, result: { ...laid.result, ...(caught.length ? { caught } : {}), ...(teeth.length ? { teeth } : {}) } };
}
