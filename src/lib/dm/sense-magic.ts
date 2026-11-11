// What a sensing feature reveals to its holder, from the facts the engine
// keeps: the spell areas on the board, the spells creatures concentrate on,
// the conditions spells laid, the magic items carried or lying on the floor,
// and the creatures whose stat block says they change shape. The counters
// were spent and the text told, with nothing revealed.
//   - Magic Awareness (Path of Wild Magic): "you know the location of any
//     spell or magic item within 60 feet of you that isn't behind total
//     cover. When you sense a spell, you learn which school of magic it
//     belongs to."
//   - Unerring Eye (Inquisitive): "you sense the presence of illusions,
//     shapechangers not in their original form, and other magic designed to
//     deceive the senses within 30 feet of you, provided you aren't blinded
//     or deafened ... but you gain no insight into what is concealed."
// On a board each thing is measured from the holder's square and a wall
// hides it (total cover); off a board the party's own carried items are all
// the engine can place.

import { getBattleMapForEncounter, getTokenByRef, type BattleMap } from "@/lib/db/battle-maps";
import { getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import { listDroppedItems } from "@/lib/db/dropped-items";
import { listSheets } from "@/lib/db/sheets";
import { hasLineOfSight } from "@/lib/battlemap/los";
import { spellSchoolFor } from "@/lib/content";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import { liveZones } from "@/lib/dm/zone-store";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import type { ToolError } from "@/lib/dm/tool-errors";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { matchMagicItem } from "@/lib/srd/magic-items";
import { containsPhrase } from "@/lib/language/text-logic";
import type { FullPatchSheetInput } from "@/lib/schemas/sheet";

type XY = { x: number; y: number };
type Seen = { what: string; at: XY | null };

// Conditions a spell lays to deceive the senses, by their names.
const DECEIVING = ["invisible", "blur", "mirror image", "disguise self", "disguised", "seeming", "nondetection", "displacement", "alter self"];

const apart = (a: XY, b: XY) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

function inSight(map: BattleMap, from: XY, at: XY, feet: number): boolean {
  return apart(from, at) * 5 <= feet && hasLineOfSight(map.terrain, map.width, from.x, from.y, at.x, at.y);
}

function schoolOf(campaignAuthors: string[], spell: string): string {
  return spellSchoolFor(spell, campaignAuthors) ?? "unknown";
}

// Everything on the board the holder senses: `magic` for Magic Awareness,
// `deceit` for Unerring Eye.
function sensed(ctx: SpendContext, feet: number, mode: "magic" | "deceit"): Seen[] | null {
  const encounter = getActiveEncounter(ctx.campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const own = map ? getTokenByRef(map.id, ctx.sheet.id) : null;
  if (!encounter || !map || !own) return null;
  const authors = spellAuthorsFor(ctx.campaign);
  const near = (at: XY) => inSight(map, own, at, feet);
  const found: Seen[] = [];
  for (const zone of liveZones(map, encounter)) {
    const school = schoolOf(authors, zone.runsAs ?? zone.spell);
    if (!near(zone.origin)) continue;
    if (mode === "magic") found.push({ what: `a spell of ${school} at (${zone.origin.x},${zone.origin.y})`, at: zone.origin });
    else if (school === "illusion") found.push({ what: `an illusion at (${zone.origin.x},${zone.origin.y})`, at: zone.origin });
  }
  const creatures = [
    ...listEnemies(encounter.id).filter((enemy) => enemy.status === "alive").map((enemy) => ({ id: enemy.id, name: enemy.displayName, concentration: enemy.concentration, conditions: enemy.conditions, meta: enemy.conditionMeta as Record<string, { spell?: string } | undefined>, items: [] as Array<{ name: string }>, shapes: containsPhrase(String(enemy.stats.type ?? ""), "shapechanger") || containsPhrase(JSON.stringify(enemy.stats.traits ?? ""), "shapechanger") })),
    ...listSheets(ctx.campaign.id).filter((sheet) => sheet.id !== ctx.sheet.id).map((sheet) => ({ id: sheet.id, name: sheet.name, concentration: sheet.concentratingOn ?? null, conditions: sheet.conditions, meta: sheet.conditionMeta as Record<string, { spell?: string } | undefined>, items: sheet.equipment, shapes: Boolean(sheet.wildShape) })),
  ];
  for (const creature of creatures) {
    const token = getTokenByRef(map.id, creature.id);
    if (!token || !near(token)) continue;
    const spells = [creature.concentration, ...creature.conditions.map((name) => creature.meta?.[name]?.spell)].filter((spell): spell is string => Boolean(spell));
    if (mode === "magic") {
      for (const spell of new Set(spells)) found.push({ what: `a spell of ${schoolOf(authors, spell)} on ${creature.name}`, at: token });
      const magical = creature.items.filter((item) => matchMagicItem(item as Parameters<typeof matchMagicItem>[0]) !== null).length;
      if (magical) found.push({ what: `${magical} magic item${magical === 1 ? "" : "s"} carried by ${creature.name}`, at: token });
    } else {
      const deceives = creature.conditions.some((name) => DECEIVING.some((mark) => isConditionNamed(name, mark))) || spells.some((spell) => schoolOf(authors, spell) === "illusion");
      if (deceives) found.push({ what: `magic deceiving the senses about ${creature.name}`, at: token });
      if (creature.shapes) found.push({ what: `${creature.name} can change its shape`, at: token });
    }
  }
  if (mode === "magic") {
    for (const dropped of listDroppedItems(ctx.campaign.id)) {
      if (!matchMagicItem(dropped.item)) continue;
      // Picked up by a creature of the fight: it is where that creature stands.
      const holder = dropped.heldByEnemy ? getTokenByRef(map.id, dropped.heldByEnemy) : null;
      const at = holder ? { x: holder.x, y: holder.y } : dropped.mapId === map.id && dropped.x !== null && dropped.y !== null ? { x: dropped.x, y: dropped.y } : null;
      if (at && near(at)) found.push({ what: holder ? `a magic item carried by ${holder.name}` : `a magic item on the floor at (${at.x},${at.y})`, at });
    }
  }
  return found;
}

// use_resource Magic Awareness.
// The sense is the holder's for its span, a mark on them ("Until the end of
// your next turn, you know the location...").
const sensing = (ctx: SpendContext, mark: string, meta: Record<string, unknown>): FullPatchSheetInput => ({
  conditions: [...ctx.sheet.conditions.filter((name) => !isConditionNamed(name, mark)), mark],
  conditionMeta: { ...(ctx.sheet.conditionMeta ?? {}), [mark]: meta } as FullPatchSheetInput["conditionMeta"],
});

export function magicAwareness(ctx: SpendContext): { patch: FullPatchSheetInput; result: Record<string, unknown> } {
  const patch = sensing(ctx, "magic awareness", { untilTurnEndOf: ctx.sheet.id, rounds: 1 });
  const found = sensed(ctx, 60, "magic");
  if (found === null) {
    const carried = listSheets(ctx.campaign.id).flatMap((sheet) => sheet.equipment.filter((item) => matchMagicItem(item) !== null).map((item) => `${item.name} (${sheet.name})`));
    return { patch, result: { senses: carried.length ? `Off the board the party's own magic items stand out: ${carried.join(", ")}. Anything else within 60 feet is the GM's to place.` : "No magic item of the party's; anything else within 60 feet is the GM's to place." } };
  }
  return { patch, result: { senses: found.length ? `${ctx.sheet.name} senses, until the end of their next turn: ${found.map((entry) => entry.what).join("; ")}.` : `${ctx.sheet.name} senses no spell and no magic item within 60 feet that is not behind total cover.` } };
}

// use_resource Unerring Eye.
export function unerringEye(ctx: SpendContext): ToolError | { patch: FullPatchSheetInput; result: Record<string, unknown> } {
  if (ctx.sheet.conditions.some((name) => isConditionNamed(name, "blinded") || isConditionNamed(name, "deafened"))) {
    return { error: `Unerring Eye works while ${ctx.sheet.name} is neither blinded nor deafened. Nothing was spent.`, refused: "rules" };
  }
  // The moment of sensing, the holder's for the turn.
  const patch = sensing(ctx, "unerring eye", { untilTurnEndOf: ctx.sheet.id });
  const found = sensed(ctx, 30, "deceit");
  if (found === null) {
    return { patch, result: { senses: "With no board the engine places nothing within 30 feet: whether an illusion, a shapechanger or a deceiving spell is near is the GM's to say." } };
  }
  return { patch, result: { senses: found.length ? `${ctx.sheet.name} senses something trying to trick them (and nothing of what it hides): ${found.map((entry) => entry.what).join("; ")}.` : `${ctx.sheet.name} senses no illusion, shapechanger or deceiving magic within 30 feet.` } };
}
