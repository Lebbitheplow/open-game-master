// Wild Surge (Path of Wild Magic): "When you enter your rage, roll a d8 for a
// magical effect that lasts the rage (save DC 8 + your proficiency bonus +
// your Constitution modifier)". Its row was narrated: entering the rage
// rolled nothing, and the table's damage, saves, temporary hit points and AC
// were the GM's to apply by hand.
//
// The surge in force is one condition on the barbarian, "wild surge (N)",
// which ends with the rage (rage-bound.ts). Rolling it (rollSurge: on the
// rage, mt-fb-counter-riders.ts; on Unstable Backlash's reaction) applies the
// effect at once. Controlled Surge (14th) rolls twice and leaves the two
// numbers pending for the barbarian's choice (use_resource Controlled Surge,
// variant the number; any number when both dice match). Effects 2, 3 and 8
// come again as a bonus action through their own spends. The passive ones
// (4, 5) are authored effects gated on the condition; 6 is a ward laid on the
// barbarian and the allies within 10 feet as it begins; 7 an aura on the
// board that costs their enemies double (zones-mt-fb.ts).
import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveBoard, getActiveEncounter, getEnemy, listEnemies, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { creditFeatureTeleport } from "@/lib/dm/feature-teleport";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import type { ToolError } from "@/lib/dm/tool-errors";
import { dispelZones, placeSpellZone } from "@/lib/dm/zone-cast";
import { liveZones } from "@/lib/dm/zone-store";
import { computeSheetDerived } from "@/lib/srd";
import { RAGING } from "@/lib/srd/class-resources";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import { zoneKey } from "@/lib/battlemap/zones-spells";
import { SURGE, SURGE_PENDING, SURGE_ROLL, SURGE_WARD, pendingSurge, surgeOf } from "@/lib/srd/mt-fb-surge-state";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The aura of effect 7, as the board names its area.
export const SURGE_GROUND = "Wild Surge";
const FEATURE = "Wild Surge";

type Args = { targetEnemyId?: string; targetEnemyIds?: string[] };
type Scene = { campaign: Campaign; turn: DmTurn | null; sheet: CharacterSheet; args: Args };
type Lines = Record<string, unknown>;

const d = (scene: Scene, label: string, dice: string) => Number(rollCard(scene.campaign, scene.turn, scene.sheet.id, "custom", `${scene.sheet.name}: ${label}`, dice, sheetAttacker(scene.sheet)).total);

function saveDc(sheet: CharacterSheet): number {
  const derived = computeSheetDerived(sheet);
  return 8 + derived.proficiencyBonus + derived.abilityMods.con;
}

function foesWithin(scene: Scene, ofRef: string, feet: number): EncounterEnemy[] {
  const encounter = getActiveEncounter(scene.campaign.id);
  if (!encounter) {
    return [];
  }
  return listEnemies(encounter.id)
    .filter((enemy) => enemy.status === "alive")
    .filter((enemy) => ((tilesBetween(encounter.id, ofRef, enemy.id) ?? 0) * 5) <= feet);
}

// The creature a single-target surge takes: the one named within 30 feet,
// else the nearest foe there.
function oneFoe(scene: Scene): EncounterEnemy | null {
  const encounter = getActiveEncounter(scene.campaign.id);
  if (!encounter) {
    return null;
  }
  const near = foesWithin(scene, scene.sheet.id, 30);
  const named = scene.args.targetEnemyId ? resolveTargetFoe(scene.campaign.id, encounter, scene.args.targetEnemyId) : null;
  if (named) {
    return near.find((enemy) => enemy.id === named.id) ?? null;
  }
  return [...near].sort((a, b) => (tilesBetween(encounter.id, scene.sheet.id, a.id) ?? 0) - (tilesBetween(encounter.id, scene.sheet.id, b.id) ?? 0))[0] ?? null;
}

function saves(scene: Scene, enemy: EncounterEnemy, ability: "con" | "dex", what: string, condition?: string): boolean {
  return rollEnemySave(scene.campaign.id, enemy, ability, saveDc(scene.sheet), {
    magical: true,
    ...(condition ? { resist: true, against: condition } : {}),
    record: { turn: scene.turn ?? undefined, detail: `${enemy.displayName}: ${ability.toUpperCase()} save against ${what}` },
  }).success;
}

function hurt(scene: Scene, enemy: EncounterEnemy, amount: number, type: string): string {
  const encounter = getActiveEncounter(scene.campaign.id);
  const fresh = getEnemy(enemy.id) ?? enemy;
  return encounter ? hurtEnemy(scene.campaign, encounter, fresh, amount, type, FEATURE) : `${enemy.displayName} takes ${amount} ${type} damage.`;
}

function writeConditions(scene: Scene, change: (conditions: string[], meta: ConditionMetaMap) => { conditions: string[]; meta: ConditionMetaMap }, reason: string) {
  const sheet = getSheetById(scene.sheet.id) ?? scene.sheet;
  const next = change([...sheet.conditions], { ...(sheet.conditionMeta as ConditionMetaMap) });
  patchSheetAudited(scene.campaign.id, sheet.id, { conditions: next.conditions, conditionMeta: next.meta }, { kind: "set_condition", reason, delta: { conditions: next.conditions } });
}

const without = (conditions: string[], meta: ConditionMetaMap, names: string[]) => {
  const kept = conditions.filter((entry) => !names.some((name) => isConditionNamed(entry, name)));
  const rest = Object.fromEntries(Object.entries(meta).filter(([entry]) => kept.includes(entry))) as ConditionMetaMap;
  return { conditions: kept, meta: rest };
};

// What a surge now over leaves behind is taken off: the allies' ward and the
// ground's aura. Called as a new surge replaces it, and by rage-bound.ts as
// the rage ends.
export function endSurgeTraces(campaign: Campaign, holderId: string) {
  for (const stale of listSheets(campaign.id)) {
    const ally = getSheetById(stale.id) ?? stale;
    const meta = ally.conditionMeta as ConditionMetaMap;
    const warded = ally.conditions.filter((entry) => isConditionNamed(entry, SURGE_WARD) && (meta[entry] as { source?: string } | undefined)?.source === holderId);
    if (warded.length) {
      const next = without(ally.conditions, meta, [SURGE_WARD]);
      patchSheetAudited(campaign.id, ally.id, { conditions: next.conditions, conditionMeta: next.meta }, { kind: "condition_clock", reason: "the wild surge that warded them ended", delta: { ended: warded } });
    }
  }
  const board = getActiveBoard(campaign.id);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  const ground = map ? liveZones(map, board).filter((zone) => zone.casterId === holderId && zoneKey({ spell: zone.spell }) === zoneKey({ spell: SURGE_GROUND })) : [];
  if (ground.length) {
    dispelZones(campaign, ground, "The surge's end");
  }
}

export function endSurgeTracesOf(campaignId: string, holderId: string) {
  const campaign = getCampaignById(campaignId);
  if (campaign) {
    endSurgeTraces(campaign, holderId);
  }
}

export { SURGE };

// One effect of the table, applied now. `first`: the surge beginning (it
// lays what lasts); the bonus-action repeats of 2, 3 and 8 pass false.
function applySurge(scene: Scene, n: number, first: boolean): Lines {
  const { sheet, campaign } = scene;
  if (first) {
    endSurgeTraces(campaign, sheet.id);
    writeConditions(scene, (conditions, meta) => {
      const kept = without(conditions, meta, [SURGE, SURGE_PENDING, SURGE_ROLL]);
      const condition = `${SURGE} (${n})`;
      return { conditions: [...kept.conditions, condition], meta: { ...kept.meta, [condition]: { whileRagingOf: sheet.id, source: sheet.id } } };
    }, `Wild Surge: effect ${n}`);
  }
  const dc = saveDc(sheet);
  switch (n) {
    case 1: {
      const chosen = new Set(scene.args.targetEnemyIds ?? []);
      const foes = foesWithin(scene, sheet.id, 30).filter((enemy) => !chosen.size || chosen.has(enemy.id));
      const damage = foes.length ? d(scene, "Wild Surge, shadowy tendrils", "1d12") : 0;
      const lines = foes.map((enemy) => (saves(scene, enemy, "con", "the tendrils") ? `${enemy.displayName} saves (DC ${dc}).` : hurt(scene, enemy, damage, "necrotic")));
      const temp = d(scene, "Wild Surge, temporary hit points", "1d12");
      const now = getSheetById(sheet.id) ?? sheet;
      if (temp > now.tempHp) {
        patchSheetAudited(campaign.id, sheet.id, { tempHp: temp }, { kind: "grant_temp_hp", reason: "Wild Surge: shadowy tendrils", delta: { tempHp: temp } });
      }
      publishEncounter(campaign.id);
      return { surge: `1, shadowy tendrils: 1d12 necrotic (${damage}) to each creature within 30 feet that fails a Constitution save (DC ${dc}), and ${temp} temporary hit points to ${sheet.name}.`, tendrils: lines.length ? lines : "no creature within 30 feet" };
    }
    case 2:
      creditFeatureTeleport(sheet.id, FEATURE, 30);
      // `teleport` is the key every teleport's result carries: its credit is
      // kept in memory until the token is moved (feature-teleport.ts).
      return {
        surge: `2: ${sheet.name} teleports up to 30 feet to an unoccupied space they can see. On later turns of this rage a bonus action does it again (use_resource Wild Surge Teleport).`,
        teleport: `Move ${sheet.name}'s token with move_token, teleport true, spell "Wild Surge" and casterCharacterId ${sheet.id}.`,
      };
    case 3: {
      const target = oneFoe(scene);
      if (!target) {
        return { surge: "3: the spirit finds no creature within 30 feet to appear beside. On later turns of this rage a bonus action calls it again (use_resource Wild Surge Spirit)." };
      }
      const caught = foesWithin(scene, target.id, 5);
      const damage = d(scene, "Wild Surge, the spirit's burst", "1d6");
      const lines = caught.map((enemy) => (saves(scene, enemy, "dex", "the spirit's burst") ? `${enemy.displayName} saves (DC ${dc}).` : hurt(scene, enemy, damage, "force")));
      publishEncounter(campaign.id);
      return { surge: `3: a spirit appears beside ${target.displayName} and bursts, 1d6 force (${damage}) to each creature within 5 feet of it that fails a Dexterity save (DC ${dc}). On later turns of this rage a bonus action calls it again (use_resource Wild Surge Spirit).`, burst: lines };
    }
    case 4:
      return { surge: `4: a weapon ${sheet.name} holds deals force damage and can be thrown 20/60 feet, returning to the hand, while this rage lasts. The server applies it.` };
    case 5:
      return { surge: `5: each creature that hits ${sheet.name} with an attack roll takes 1d6 force damage while this rage lasts. The server applies it.` };
    case 6: {
      const encounter = getActiveEncounter(campaign.id);
      const warded = listSheets(campaign.id)
        .map((stale) => getSheetById(stale.id) ?? stale)
        .filter((ally) => !ally.deathSaves?.dead && (ally.id === sheet.id || !encounter || ((tilesBetween(encounter.id, sheet.id, ally.id) ?? 0) * 5) <= 10));
      for (const ally of warded) {
        const kept = without(ally.conditions, ally.conditionMeta as ConditionMetaMap, [SURGE_WARD]);
        patchSheetAudited(campaign.id, ally.id, { conditions: [...kept.conditions, SURGE_WARD], conditionMeta: { ...kept.meta, [SURGE_WARD]: { whileRagingOf: sheet.id, source: sheet.id } } }, { kind: "set_condition", reason: "Wild Surge: +1 AC", delta: { condition: SURGE_WARD } });
      }
      return { surge: `6: +1 AC while this rage lasts for ${warded.map((ally) => ally.name).join(", ")} (${sheet.name} and the allies within 10 feet as the surge began).` };
    }
    case 7: {
      const laid = placeSpellZone(campaign, { spell: SURGE_GROUND, caster: { kind: "pc", id: sheet.id, name: sheet.name } });
      return { surge: `7: the ground within 15 feet of ${sheet.name} is difficult terrain for their enemies while this rage lasts.${laid ? " The board carries it around them." : ""}` };
    }
    default: {
      const target = oneFoe(scene);
      if (!target) {
        return { surge: "8: the bolt of light finds no creature within 30 feet. On later turns of this rage a bonus action looses it again (use_resource Wild Surge Bolt)." };
      }
      const damage = d(scene, "Wild Surge, bolt of light", "1d6");
      const struck = hurt(scene, target, damage, "radiant");
      const fresh = getEnemy(target.id);
      let blinded = `${target.displayName} saves against the blindness (DC ${dc}).`;
      if (fresh && fresh.status === "alive" && !saves(scene, fresh, "con", "the bolt of light", "blinded")) {
        const live = getEnemy(target.id) ?? fresh;
        if (immuneToCondition(live, "blinded")) {
          blinded = `${target.displayName} cannot be blinded.`;
        } else {
          patchEnemyConditions(live.id, [...live.conditions.filter((entry) => !isConditionNamed(entry, "blinded")), "blinded"], { ...(live.conditionMeta as ConditionMetaMap), blinded: { source: sheet.id, untilTurnOf: sheet.id } } as typeof live.conditionMeta);
          blinded = `${target.displayName} is blinded until the start of ${sheet.name}'s next turn.`;
        }
      }
      publishEncounter(campaign.id);
      return { surge: `8: a bolt of light, 1d6 radiant (${damage}), blinding unless a Constitution save (DC ${dc}) is made. On later turns of this rage a bonus action looses it again (use_resource Wild Surge Bolt).`, bolt: [struck, blinded] };
    }
  }
}

// Rolls on the table for a barbarian who holds Wild Surge and rages: the
// effect applied, or with Controlled Surge the two numbers left to choose.
// Null for anyone else.
export function rollSurge(scene: Scene): Lines | null {
  const sheet = getSheetById(scene.sheet.id) ?? scene.sheet;
  if (!holdsFeature(sheet, FEATURE) || !sheet.conditions.some((entry) => isConditionNamed(entry, RAGING))) {
    return null;
  }
  const live = { ...scene, sheet };
  const first = d(live, "Wild Surge", "1d8");
  if (!holdsFeature(sheet, "Controlled Surge")) {
    return applySurge(live, first, true);
  }
  const second = d(live, "Wild Surge (Controlled Surge)", "1d8");
  endSurgeTraces(scene.campaign, sheet.id);
  const waiting = [SURGE_PENDING, ...(first === second ? [] : [first, second].map((number) => `${SURGE_ROLL} (${number})`))];
  writeConditions(live, (conditions, meta) => {
    const kept = without(conditions, meta, [SURGE, SURGE_PENDING, SURGE_ROLL]);
    const bound = Object.fromEntries(waiting.map((name) => [name, { whileRagingOf: sheet.id, source: sheet.id }]));
    return { conditions: [...kept.conditions, ...waiting], meta: { ...kept.meta, ...bound } };
  }, "Wild Surge: Controlled Surge's two rolls");
  return {
    surge: first === second
      ? `Controlled Surge: both dice show ${first}, so ${sheet.name} chooses any effect of the table: use_resource Controlled Surge with variant 1 to 8. Ask the player which.`
      : `Controlled Surge: the dice show ${first} and ${second}, and ${sheet.name} chooses either: use_resource Controlled Surge with variant ${first} or ${second}. Ask the player which.`,
  };
}

// Controlled Surge's choice (pick), or the bonus-action repeat of the surge
// in force (again): the two spends of the rows.
export function surgeSpend(scene: Scene, does: { pick?: number; again?: number }, label: string): ToolError | { result: Lines } {
  const sheet = getSheetById(scene.sheet.id) ?? scene.sheet;
  if (does.pick) {
    const open = pendingSurge(sheet);
    if (!open) {
      return { error: `${sheet.name} has no Wild Surge roll waiting on a choice. Nothing was spent.`, refused: "rules" };
    }
    if (!open.includes(does.pick)) {
      return { error: `${label} chooses between the numbers rolled: ${open.join(" or ")}. ${does.pick} is neither. Nothing was spent.`, retry: true };
    }
    return { result: applySurge({ ...scene, sheet }, does.pick, true) };
  }
  if (surgeOf(sheet) !== does.again) {
    return { error: `${label} repeats Wild Surge's effect ${does.again}, and that is not the surge in force for ${sheet.name}. Nothing was spent.`, refused: "rules" };
  }
  return { result: applySurge({ ...scene, sheet }, does.again!, false) };
}
