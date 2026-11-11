// The feats use_resource answers by name though they hold no counter: War
// Caster's choice of spell (ar-wbf-feat-warcaster.ts), Telekinetic's shove,
// Linguist's cipher and Mounted Combatant's say over attacks at the mount.
// The rules are in ar-wbf-feat-doors-logic.ts; mutations.ts asks this door
// before the counters, and the two mounted readers below are called where an
// attack is planned (pc-attack-plan.ts) and aimed (enemy-attack.ts).
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getMounts } from "@/lib/db/mounts";
import { getSheetById } from "@/lib/db/sheets";
import {
  holdsLinguist,
  holdsMountedCombatant,
  holdsTelekinetic,
  MOUNT_UNSHIELDED,
  smallerThanMount,
  telekineticAbility,
  TELEKINETIC_FEET,
} from "@/lib/dm/ar-wbf-feat-doors-logic";
import { warCasterChoice } from "@/lib/dm/ar-wbf-feat-warcaster";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { priceTheAction } from "@/lib/dm/combat-features";
import { incapacitatedBy } from "@/lib/dm/condition-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { pushTokenAway } from "@/lib/dm/map-tools";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { computeSheetDerived } from "@/lib/srd";

type DoorArgs = { variant?: string; targetEnemyId?: string; targetCharacterId?: string };

export function featDoorSpend(campaign: Campaign, _turnId: string, stale: CharacterSheet, resourceName: string, args: DoorArgs): ToolResult | null {
  const name = textKey(resourceName.replace(/_/g, " "));
  if (name !== "war caster" && name !== "telekinetic" && name !== "linguist" && name !== "mounted combatant") {
    return null;
  }
  const sheet = getSheetById(stale.id) ?? stale;
  if (name === "war caster") return warCasterChoice(campaign, sheet, args.variant);
  if (name === "telekinetic") return telekineticShove(campaign, sheet, args);
  if (name === "linguist") return linguistCipher(sheet);
  return mountedChoice(campaign, sheet, args.variant);
}

// Telekinetic's bonus action: a creature within 30 feet makes a Strength
// save or is shoved 5 feet, straight away from the character. An ally lets
// itself be moved. The save is no spell's, so Magic Resistance has no say.
function telekineticShove(campaign: Campaign, sheet: CharacterSheet, args: DoorArgs): ToolResult {
  if (!holdsTelekinetic(sheet)) {
    return { error: `${sheet.name} does not have the Telekinetic feat. Nothing was spent.`, refused: "rules" };
  }
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "Telekinetic's shove moves a creature 5 feet on the battle map of a fight; there is no active encounter. Nothing was spent.", refused: "rules" };
  }
  const enemy = args.targetEnemyId ? resolveTargetFoe(campaign.id, encounter, args.targetEnemyId) : null;
  const ally = !enemy && args.targetCharacterId ? getSheetById(args.targetCharacterId) : null;
  if ((!enemy || enemy.status !== "alive") && (!ally || ally.id === sheet.id)) {
    return { error: "Telekinetic's shove needs the creature it moves: targetEnemyId for a creature of the other side, targetCharacterId for an ally. Nothing was spent.", retry: true };
  }
  const targetId = enemy?.id ?? ally!.id;
  const targetName = enemy?.displayName ?? ally!.name;
  const apart = tilesBetween(encounter.id, sheet.id, targetId);
  if (apart !== null && apart * 5 > TELEKINETIC_FEET) {
    return { error: `${targetName} is ${apart * 5} feet from ${sheet.name}, and Telekinetic's shove reaches ${TELEKINETIC_FEET} feet. Nothing was spent.`, refused: "rules" };
  }
  const price = priceTheAction(sheet, encounter, "Telekinetic's shove", "bonus");
  if ("error" in price) {
    return toolError(price);
  }
  const derived = computeSheetDerived(sheet);
  const ability = telekineticAbility(sheet);
  const dc = 8 + derived.proficiencyBonus + derived.abilityMods[ability];
  const save = enemy ? rollEnemySave(campaign.id, enemy, "str", dc, { record: { detail: `${enemy.displayName}: STR save against Telekinetic` } }) : null;
  price.commit();
  if (save?.success) {
    return { ok: true, resource: "Telekinetic", cost: "their bonus action", dc, save: save.total, saved: true, applied: `${targetName} holds its ground (a ${save.total ?? "success"} against DC ${dc}).` };
  }
  const pushed = pushTokenAway(campaign, encounter.id, sheet.id, targetId);
  publishEncounter(campaign.id);
  return {
    ok: true,
    resource: "Telekinetic",
    cost: "their bonus action",
    dc,
    ...(save ? { save: save.total, saved: false } : { willing: true }),
    moved: pushed.moved,
    applied: pushed.moved
      ? `${targetName} is shoved 5 feet away from ${sheet.name}, to (${pushed.at.x},${pushed.at.y}). The move is forced: it draws no opportunity attacks.`
      : `${targetName} ${save ? "fails the save but" : ""} is not moved: ${pushed.reason}.`,
  };
}

// Linguist's cipher: the number the engine owns is the DC to read it.
function linguistCipher(sheet: CharacterSheet): ToolResult {
  if (!holdsLinguist(sheet)) {
    return { error: `${sheet.name} does not have the Linguist feat. Nothing was spent.`, refused: "rules" };
  }
  const derived = computeSheetDerived(sheet);
  const dc = 8 + derived.abilityMods.int + derived.proficiencyBonus;
  return {
    ok: true,
    resource: "Linguist",
    cipherDc: dc,
    applied: `${sheet.name} writes it in a cipher of their own. They, and anyone they teach the cipher, read it freely; anyone else reads it only with an Intelligence check against DC ${dc} (request_roll with ability int and dc ${dc}), or with magic that reads any writing. Nothing was spent.`,
  };
}

const WORDS_MOUNT = new Set(["mount", "let it land", "off", "no"]);

// Mounted Combatant's "you can redirect": the rider takes an attack aimed at
// the mount unless they have said to let it land (variant "mount"); variant
// "rider" takes them again.
function mountedChoice(campaign: Campaign, sheet: CharacterSheet, variant: string | undefined): ToolResult {
  if (!holdsMountedCombatant(sheet)) {
    return { error: `${sheet.name} does not have the Mounted Combatant feat. Nothing was spent.`, refused: "rules" };
  }
  const asked = textKey(variant ?? "");
  const open = sheet.conditions.some((entry) => textKey(entry) === MOUNT_UNSHIELDED);
  if (asked) {
    const letLand = WORDS_MOUNT.has(asked);
    if (letLand !== open) {
      const conditions = letLand ? [...sheet.conditions, MOUNT_UNSHIELDED] : sheet.conditions.filter((entry) => textKey(entry) !== MOUNT_UNSHIELDED);
      patchSheetAudited(campaign.id, sheet.id, { conditions }, { kind: letLand ? "set_condition" : "clear_condition", reason: "Mounted Combatant: attacks at the mount", delta: { condition: MOUNT_UNSHIELDED } });
    }
    return { ok: true, resource: "Mounted Combatant", attacksAtTheMount: letLand ? "land on the mount" : `are taken by ${sheet.name}`, applied: letLand ? `Attacks aimed at ${sheet.name}'s mount land on it until they say otherwise (variant "rider").` : `${sheet.name} takes the attacks aimed at their mount.` };
  }
  return { ok: true, resource: "Mounted Combatant", attacksAtTheMount: open ? "land on the mount" : `are taken by ${sheet.name}`, note: `Variant "mount" lets attacks at the mount land on it, "rider" has ${sheet.name} take them. Nothing was spent.` };
}

// Advantage on a melee attack against an unmounted creature smaller than
// the mount: the note the attack carries, or null.
export function mountedAdvantage(campaignId: string, sheet: CharacterSheet, enemy: Pick<EncounterEnemy, "id" | "stats">, melee: boolean): string | null {
  if (!melee || !holdsMountedCombatant(sheet)) {
    return null;
  }
  const mounts = getMounts(campaignId);
  const mount = mounts[sheet.id];
  if (!mount || mounts[enemy.id] || !smallerThanMount(enemy.stats.size, mount.size)) {
    return null;
  }
  return `Mounted Combatant: advantage on a melee attack against an unmounted creature smaller than ${mount.name}`;
}

// An attack aimed at the mount of a Mounted Combatant who can act: the note
// that says the rider takes it, or null when it lands on the mount.
export function riderTakesIt(rider: CharacterSheet): string | null {
  if (!holdsMountedCombatant(rider) || rider.currentHp <= 0 || incapacitatedBy(rider.conditions) || rider.conditions.some((entry) => textKey(entry) === MOUNT_UNSHIELDED)) {
    return null;
  }
  return `Mounted Combatant: ${rider.name} takes the attack aimed at their mount`;
}
