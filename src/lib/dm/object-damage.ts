// Breaking things: the DMG's object table, a real attack roll against the
// object's armor class, and damage that stays on the object between blows.
//
// SRD 5.1 (Gamemastering, Objects): an object has an Armor Class by its
// material and hit points by its size; objects are immune to poison and
// psychic damage. Before this the tool took the model's damage, rolled no
// attack, and forgot every blow, so a door took whatever cumulative number
// the model remembered to pass.
//
// A named object keeps the damage it has taken on the campaign clock
// (`objects`), so a second blow on "the oak door" adds to the first, and so
// does what the first call naming it decided it is (its AC, hit points and
// damage threshold): a later call that leaves the material out does not
// turn the iron gate into the default wooden one. A broken object stays
// broken, so a blow at its splinters breaks nothing a second time.

import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getClock, setClock } from "@/lib/db/clock";
import { getCurrentLocation } from "@/lib/db/locations";
import type { ObjectRecord } from "@/lib/dm/march-state";
import { insertRoll, type RollAttacker } from "@/lib/db/rolls";
import { rollAgainst, rollOn } from "@/lib/roll-labels";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { isValidExpression, rollExpression, type RollResult } from "@/lib/dice";
import { rollCharacterD20 } from "@/lib/dm/character-roll";
import { publishWithSeq } from "@/lib/events";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { buildAttackProfile } from "@/lib/dm/pc-attack-profile";
import { objectProfile, type ObjectMaterial, type ObjectSize } from "@/lib/srd/objects";
import { breakWallSection, sectionHit, wallSectionFor } from "@/lib/dm/zone-walls";
import { badArguments, toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { unknownSheetRef } from "@/lib/dm/rolls";
import { freeFromNet, NET_AC, NET_HP, netObject, nettedId } from "@/lib/dm/net-hold";
import { vesselObject } from "@/lib/dm/genie-vessel";

export const OBJECT_MATERIALS: ObjectMaterial[] = [
  "cloth", "paper", "rope", "crystal", "glass", "ice", "wood", "bone", "stone", "iron", "steel", "mithral", "adamantine",
];
export const OBJECT_SIZES: ObjectSize[] = ["tiny", "small", "medium", "large"];

const objectSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  // A sectioned wall's section (src/lib/dm/zone-walls.ts).
  section: z.coerce.number().int().min(1).max(99).optional(),
  material: z.enum(OBJECT_MATERIALS as [ObjectMaterial, ...ObjectMaterial[]]).optional(),
  size: z.enum(OBJECT_SIZES as [ObjectSize, ...ObjectSize[]]).optional(),
  fragile: z.coerce.boolean().optional(),
  damage: z.string().max(30).optional(),
  damageType: z.string().max(30).optional(),
  characterId: z.string().max(80).optional(),
  weapon: z.string().max(80).optional(),
  improvised: z.coerce.boolean().optional(),
  ac: z.coerce.number().int().min(1).max(30).optional(),
  hp: z.coerce.number().int().min(1).max(1000).optional(),
  // SRD 5.1 (Objects): a big object's damage threshold. A blow below it is
  // superficial and takes nothing off; one at or above it lands whole.
  threshold: z.coerce.number().int().min(1).max(100).optional(),
  reason: z.string().optional(),
});

// An object is the one of that name where the party is: "the door" broken
// in the crypt is not the door of the next inn, nor of the material the
// crypt's was. A place's id is cut to its first eight characters so the key
// fits the clock's 60 (src/lib/dm/march-state.ts); a table with no place
// set keeps the name alone.
function keyOf(campaignId: string, name: string): string {
  const place = getCurrentLocation(campaignId)?.id.slice(0, 8) ?? "";
  return `${place ? `${place}:` : ""}${textKey(name)}`.slice(0, 60);
}

function publishRoll(campaign: Campaign, turn: DmTurn | null, characterId: string | null, kind: "attack" | "damage", detail: string, result: RollResult, attacker: RollAttacker | null) {
  const roll = insertRoll({ campaignId: campaign.id, characterId, requestedBy: "dm", kind, detail, result, attacker });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
  turn?.rollIds.push(roll.id);
}

// What the clock keeps of a named object, or null for one never named.
function objectRecord(campaignId: string, name: string): ObjectRecord | null {
  return getClock(campaignId).objects?.[keyOf(campaignId, name)] ?? null;
}

// Damage a named object has already taken.
export function objectDamageTaken(campaignId: string, name: string): number {
  return objectRecord(campaignId, name)?.taken ?? 0;
}

function recordObject(campaignId: string, name: string, record: ObjectRecord) {
  const current = getClock(campaignId);
  const objects = { ...(current.objects ?? {}) };
  // Written last, so the 40 kept are the ones most lately struck.
  const key = keyOf(campaignId, name);
  delete objects[key];
  objects[key] = record;
  const kept = Object.entries(objects).slice(-40);
  setClock(campaignId, { ...current, objects: Object.fromEntries(kept) });
}

function forgetObject(campaignId: string, name: string) {
  const current = getClock(campaignId);
  const objects = { ...(current.objects ?? {}) };
  delete objects[keyOf(campaignId, name)];
  setClock(campaignId, { ...current, objects });
}

export function damageObject(
  campaign: Campaign | null,
  turn: DmTurn | null,
  rawArguments: string,
): ToolResult {
  let args: z.infer<typeof objectSchema>;
  try {
    args = objectSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments for damage_object.", error, rawArguments);
  }
  // A section of a Wall of Ice has its own numbers (src/lib/dm/zone-walls.ts).
  const section = campaign && args.name ? wallSectionFor(campaign.id, args.name, args.section) : null;
  if (section && "error" in section) {
    return section;
  }
  // A net holding a creature has the net's own numbers, kept per creature
  // it holds (net-hold.ts).
  const net = campaign && args.name && !section ? netObject(campaign.id, args.name) : null;
  if (net && "error" in net) {
    return net;
  }
  // A Genie warlock's vessel has its warlock's numbers (genie-vessel.ts).
  const vessel = campaign && args.name && !section && !net ? vesselObject(campaign.id, args.name) : null;
  // Each section keeps its own damage between blows.
  const kept = section ? `${section.zoneId} ${section.section}` : net ? `net ${nettedId(net.netted)}` : vessel ? vessel.key : args.name;
  const record = campaign && kept ? objectRecord(campaign.id, kept) : null;
  const profile = objectProfile(args.material ?? "wood", args.size ?? "medium", args.fragile);
  // A section's numbers are its wall's; an object already named keeps the
  // numbers its first call decided; only a new one reads this call's.
  const ac = section?.ac ?? (net ? NET_AC : undefined) ?? vessel?.ac ?? record?.ac ?? args.ac ?? profile.ac;
  const hp = section?.hp ?? (net ? NET_HP : undefined) ?? vessel?.hp ?? record?.hp ?? args.hp ?? profile.hp;
  const threshold = record ? record.threshold : args.threshold;
  const already = record?.taken ?? 0;
  const restated =
    vessel && ((args.ac !== undefined && args.ac !== ac) || (args.hp !== undefined && args.hp !== hp) || args.material !== undefined || args.size !== undefined)
      ? `${vessel.owner}'s vessel is a Tiny object of their own numbers: AC ${ac} (their spell save DC), ${hp} HP (warlock level + proficiency bonus)`
      : record && !section && !net && ((args.ac !== undefined && args.ac !== ac) || (args.hp !== undefined && args.hp !== hp) || args.material !== undefined || args.size !== undefined)
      ? `kept as it was first described: AC ${ac}, ${hp} HP${threshold ? `, damage threshold ${threshold}` : ""}`
      : null;
  if (record?.broken) {
    return {
      ok: true,
      ac,
      hp,
      damage: 0,
      broken: true,
      damageTaken: hp,
      hpLeft: 0,
      note: `${args.name ?? "That object"} is already broken; there is nothing left to break. Narrate what is left of it.`,
    };
  }

  let dealt: number | null = null;
  let type = (args.damageType ?? "").trim().toLowerCase();
  const notes: string[] = [];
  const sheet = args.characterId ? getSheetById(args.characterId) : null;
  if (args.characterId && (!sheet || (campaign && sheet.campaignId !== campaign.id))) {
    return campaign ? unknownSheetRef("characterId", args.characterId, listSheets(campaign.id)) : { error: "Unknown characterId; use one from GAME STATE.", retry: true };
  }
  if (sheet && campaign) {
    // The character's own attack, from their sheet: the roll has to beat the
    // object's AC before any damage lands.
    const built = buildAttackProfile(campaign.id, sheet, { weapon: args.weapon, improvised: args.improvised });
    if ("error" in built) {
      return toolError(built);
    }
    // The character's own attack roll (src/lib/dm/character-roll.ts): on
    // physical dice their player rolls it, and a miss waits on what they hold.
    const attack = rollCharacterD20(campaign, sheet, {
      kind: "attack",
      expression: `1d20${built.profile.toHit >= 0 ? "+" : ""}${built.profile.toHit}`,
      detail: rollAgainst(built.profile.weapon, args.name ?? "an object"),
      attack: { ac },
    });
    const striker: RollAttacker = { kind: "sheet", id: sheet.id, name: sheet.name };
    publishRoll(campaign, turn, sheet.id, "attack", rollAgainst(built.profile.weapon, args.name ?? "an object"), attack, striker);
    const natural = attack.natural ?? 0;
    const hit = natural !== 1 && (natural === 20 || attack.total >= ac);
    if (!hit) {
      if (campaign && kept && !record) {
        recordObject(campaign.id, kept, { taken: 0, ac, hp, ...(threshold ? { threshold } : {}) });
      }
      return {
        ok: true,
        ac,
        hp,
        attack: attack.total,
        hit: false,
        ...(args.name ? { damageTaken: already } : {}),
        note: `The attack (${attack.total}) misses AC ${ac}; the object takes nothing.`,
      };
    }
    const expression = natural === 20 ? critDamageExpression(built.profile.damageExpression) : built.profile.damageExpression;
    const damage = rollCharacterD20(campaign, sheet, { kind: "damage", expression, detail: rollAgainst(built.profile.weapon, args.name ?? "an object") });
    publishRoll(campaign, turn, sheet.id, "damage", rollAgainst(built.profile.weapon, args.name ?? "an object"), damage, striker);
    dealt = Math.max(0, damage.total);
    type = type || built.profile.damageType;
  } else if (args.damage) {
    if (/^-?\d+$/.test(args.damage.trim())) {
      dealt = Number(args.damage.trim());
    } else if (isValidExpression(args.damage)) {
      const rolled = rollExpression(args.damage);
      // Harm no character dealt (a hazard, a falling block): nobody's roll.
      if (campaign) {
        publishRoll(campaign, turn, null, "damage", rollOn(type || "damage", [args.name ?? "an object"]), rolled, null);
      }
      dealt = rolled.total;
    } else {
      return { error: `Invalid damage "${args.damage}".`, retry: true };
    }
  }
  // Said as a field too: blow after blow of it stops at the first
  // (world-tools.ts handleDamageObject).
  const immune = dealt !== null && /^(poison|psychic)$/.test(type);
  if (immune) {
    notes.push(`objects are immune to ${type} damage`);
    dealt = 0;
  }
  dealt = section && dealt ? sectionHit(section, dealt, type, notes) : dealt;
  // "Dealing 5 slashing damage to the net": no other kind cuts it.
  if (net && dealt && type !== "slashing") {
    notes.push(`only slashing damage cuts a net, and this was ${type || "untyped"}`);
    dealt = 0;
  }
  if (dealt !== null && threshold && dealt > 0 && dealt < threshold) {
    notes.push(`${dealt} is under its damage threshold of ${threshold}: superficial, nothing comes off`);
    dealt = 0;
  }
  if (restated) {
    notes.push(restated);
  }
  const taken = already + (dealt ?? 0);
  const broken = dealt !== null && taken >= hp;
  // Named once is decided: a call that only asks what the object is still
  // fixes its numbers for the blows after it.
  if (campaign && kept && (dealt !== null || !record)) {
    recordObject(campaign.id, kept, { taken: broken ? hp : taken, ac, hp, ...(threshold ? { threshold } : {}), ...(broken ? { broken: true } : {}) });
  }
  if (campaign && section && broken) {
    notes.push(breakWallSection(campaign, section));
  }
  // Cut through, the net frees the creature unharmed and is destroyed; the
  // next net thrown at it starts whole.
  if (campaign && net && broken) {
    notes.push(freeFromNet(campaign, net.netted, true));
    forgetObject(campaign.id, `net ${nettedId(net.netted)}`);
  }
  return {
    ok: true,
    ac,
    hp,
    ...(dealt !== null ? { damage: dealt, broken } : {}),
    ...(args.name ? { damageTaken: broken ? hp : taken, hpLeft: Math.max(0, hp - taken) } : {}),
    ...(notes.length ? { notes } : {}),
    ...(immune ? { immune: true } : {}),
    note:
      dealt === null
        ? `That object has AC ${ac} and ${hp} HP; a hit needs to beat AC ${ac} and enough damage to matter.`
        : broken
          ? `${dealt} damage brings it to ${taken} of its ${hp} HP: it breaks. Narrate it giving way.`
          : `${dealt} damage holds (${taken} of ${hp} HP taken${args.name ? "; the server keeps the count for the next blow" : ""}).`,
  };
}
