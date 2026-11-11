// An area that catches a rider catches the mount under them: it stands in the
// same square. Until now an area reached the rider alone, so a fireball left
// the horse untouched and Mounted Combatant's third benefit had nothing to
// act on: "If your mount is subjected to an effect that allows it to make a
// Dexterity saving throw to take only half damage, it instead takes no damage
// if it succeeds on the saving throw, and only half damage if it fails."
//
// The mount makes the area's Dexterity save with its own modifier and takes
// the blast by the save: all of it on a failure, half on a success where the
// effect halves, none where it does not. A rider with the feat moves each of
// those one step down, as Evasion does for a character (aoe-characters.ts).
// A mount at 0 goes down and its rider comes off as from a mount knocked
// prone (mount-combat.ts strikeMount does the same for an attack).
//
// Only Dexterity saves are rolled: a mount on record keeps Armor Class and hit
// points (srd/mounts.ts MountState) and no ability scores, and the SRD mounts'
// Dexterity is written here. An area that asks another save leaves the mount
// to the GM, as before.

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getMounts, setMount } from "@/lib/db/mounts";
import { insertRoll } from "@/lib/db/rolls";
import { rollExpression } from "@/lib/dice";
import { handleDismount } from "@/lib/dm/mount-tools";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { SaveAbility } from "@/lib/bestiary/statblock";
import { holdsFeat } from "@/lib/srd/feat-use";

// Dexterity modifiers of the SRD 5.1 mounts (Dexterity 10 where not listed:
// riding horse, pony, draft horse, elk, mule; and a beast the GM named).
const MOUNT_DEX: Record<string, number> = { warhorse: 1, camel: -1, mastiff: 2, elephant: -1, griffon: 2 };

export function areaOnMount(input: {
  campaign: Campaign;
  turn: DmTurn;
  rider: CharacterSheet;
  ability: SaveAbility;
  dc: number;
  halfOnSave: boolean;
  // The blast's whole, before any save.
  total: number;
  reason: string;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
}): Record<string, unknown> | null {
  const { campaign, turn, rider } = input;
  const mount = getMounts(campaign.id)[rider.id];
  if (input.ability !== "dex" || input.total <= 0 || !mount || mount.hp === undefined || mount.hp <= 0) {
    return null;
  }
  const bonus = MOUNT_DEX[mount.ref] ?? 0;
  const outcome = rollExpression(`1d20${bonus < 0 ? bonus : `+${bonus}`}`);
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: null,
    requestedBy: "dm",
    kind: "saving_throw",
    detail: `${mount.name}: DEX save vs ${input.reason}`.slice(0, 200),
    dc: input.dc,
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
  turn.rollIds.push(roll.id);
  const success = outcome.total >= input.dc;
  const feat = input.halfOnSave && holdsFeat(rider, "Mounted Combatant");
  const share = feat ? (success ? 0 : 0.5) : success ? (input.halfOnSave ? 0.5 : 0) : 1;
  const damage = Math.floor(input.total * share);
  const hp = Math.max(0, mount.hp - damage);
  const row = {
    mount: mount.name,
    save: outcome.total,
    success,
    damage,
    ...(feat ? { mountedCombatant: success ? "no damage" : "half damage" } : {}),
  };
  if (damage <= 0) {
    return row;
  }
  setMount(campaign.id, rider.id, { ...mount, hp });
  if (hp > 0) {
    publishPersisted(campaign.id, "mounts_updated", { mounts: getMounts(campaign.id) });
    return { ...row, mountHp: `${hp}/${mount.maxHp ?? mount.hp}` };
  }
  const fall = handleDismount(campaign, JSON.stringify({ characterId: rider.id, cause: "mount-prone" }), input.sheets, input.sheetsById, turn);
  return { ...row, mountDown: `${mount.name} drops to 0 hit points.`, fall };
}
