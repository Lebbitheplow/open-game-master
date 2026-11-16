// Ammunition tracking, off by default and switched on per table through the
// `ammunition` variant rule.
//
// It was a deliberate omission for a long time (docs/rules-coverage.md:
// "assumed supplied; tracking it is tedious with no upside at this table"),
// and for an AI-run game that is still the right default. A human DM asking
// for it is a different case: counting arrows is exactly the bookkeeping a
// person wants the machine to do for them.
//
// Pure by design: no "@/" imports and no I/O, so
// scripts/test-ammunition.mjs can import it directly.

import type { ToolError } from "../dm/tool-errors.ts";
import { hasItemTag, type TaggedItem } from "@/lib/srd/item-tags";
import { lineNamed, magicItemBonus } from "@/lib/srd/item-row";

export type AmmoKind = "arrows" | "bolts" | "bullets" | "needles";

// What each ammunition weapon fires, by the SRD weapon row's name
// (src/lib/srd/weapons.ts).
const WEAPON_AMMO = new Map<string, AmmoKind>([
  ["Blowgun", "needles"],
  ["Hand Crossbow", "bolts"],
  ["Heavy Crossbow", "bolts"],
  ["Light Crossbow", "bolts"],
  ["Shortbow", "arrows"],
  ["Longbow", "arrows"],
  ["Sling", "bullets"],
  ["Pistol", "bullets"],
  ["Revolver", "bullets"],
  ["Musket", "bullets"],
  ["Hunting Rifle", "bullets"],
]);

// Pounds per round, from the SRD equipment table: 20 arrows weigh 1 lb, 20
// bolts or sling bullets 1.5 lb, 50 blowgun needles 1 lb. Per round rather
// than per bundle because a quiver's count moves as it is fired
// (src/lib/srd/encumbrance.ts weighs it that way).
export const AMMO_WEIGHT_LB: Record<AmmoKind, number> = {
  arrows: 0.05,
  bolts: 0.075,
  bullets: 0.075,
  needles: 0.02,
};

export const AMMO_LABELS: Record<AmmoKind, string> = {
  arrows: "arrows",
  bolts: "bolts",
  bullets: "bullets",
  needles: "needles",
};

// What an SRD weapon fires, by its row's name; null for any other.
export function ammoKindForWeapon(srdName: string | undefined): AmmoKind | null {
  return (srdName && WEAPON_AMMO.get(srdName)) || null;
}

type Item = TaggedItem & { qty: number };

// How many rounds an inventory line holds. `qty` is authoritative, but a
// line written as "Arrows (20)" carries its count in the name and would
// otherwise read as a single arrow, so the parenthesised number wins when
// qty is the schema default of 1.
export function ammoCount(item: Item): number {
  const bracketed = /\((\d+)\)\s*$/.exec(item.name.trim());
  if (bracketed && item.qty <= 1) {
    return Number(bracketed[1]);
  }
  return item.qty;
}

// The ammunition kinds, each the tag an inventory line carries for it
// (src/lib/srd/item-tags.ts).
const AMMO_KINDS: AmmoKind[] = ["arrows", "bolts", "bullets", "needles"];

// Which kind of ammunition an inventory line IS, as opposed to which kind a
// weapon fires. Null for everything that is not ammunition.
export function ammoKindForItem(item: TaggedItem): AmmoKind | null {
  return AMMO_KINDS.find((kind) => hasItemTag(item, kind)) ?? null;
}

// A magic ammunition line's bonus (SRD 5.1, Ammunition, +1, +2, or +3): the
// one its name declares ("+1 Arrows", "Bolts +2"), 0 for an ordinary line.
export function ammoBonus(item: Pick<TaggedItem, "name">): number {
  return magicItemBonus(item.name);
}

// The inventory line this weapon draws from when the shot names none, or
// null when the character is carrying none. The first ordinary line wins,
// which keeps the choice predictable when someone carries both plain and
// silvered arrows. Magic ammunition is fired only when the shot names it
// (namedAmmo): drawn as the first line, a +1 arrow was spent as a plain one.
export function findAmmo(
  equipment: Item[],
  kind: AmmoKind,
): { index: number; item: Item; count: number } | null {
  for (let index = 0; index < equipment.length; index += 1) {
    const item = equipment[index];
    if (hasItemTag(item, kind) && ammoCount(item) > 0 && ammoBonus(item) === 0) {
      return { index, item, count: ammoCount(item) };
    }
  }
  return null;
}

// The magic ammunition lines this weapon can fire, for the Hand's pick and
// the refusals that name them.
export function magicAmmoFor(equipment: Item[], weaponBase: string | undefined): Array<{ index: number; name: string; count: number; bonus: number }> {
  const kind = ammoKindForWeapon(weaponBase);
  if (!kind) {
    return [];
  }
  return equipment.flatMap((item, index) =>
    hasItemTag(item, kind) && ammoCount(item) > 0 && ammoBonus(item) > 0 ? [{ index, name: item.name, count: ammoCount(item), bonus: ammoBonus(item) }] : [],
  );
}

// The ammunition line a shot names (pc_attack `ammo`), by its whole name:
// the line, its bonus and its count, or the refusal naming what the weapon
// can fire. Null for a weapon that fires no ammunition.
export function namedAmmo(
  equipment: Item[],
  weapon: { base: string | undefined; name: string },
  named: string,
): { ok: true; index: number; name: string; count: number; bonus: number; kind: AmmoKind } | ({ ok: false } & ToolError) | null {
  const kind = ammoKindForWeapon(weapon.base);
  if (!kind) {
    return { ok: false, error: `The ${weapon.name} fires no ammunition; send the attack without ammo.`, retry: true };
  }
  const index = lineNamed(equipment, named);
  const item = equipment[index];
  if (!item || !hasItemTag(item, kind) || ammoCount(item) <= 0) {
    const magic = magicAmmoFor(equipment, weapon.base).map((line) => line.name);
    return {
      ok: false,
      error: `The ${weapon.name} fires ${AMMO_LABELS[kind]}, and no ${AMMO_LABELS[kind]} line called "${named}" is carried.${magic.length ? ` Magic ${AMMO_LABELS[kind]} carried: ${magic.join(", ")}.` : ""} Leave ammo out to fire ordinary ${AMMO_LABELS[kind]}.`,
      refused: "rules",
    };
  }
  return { ok: true, index, name: item.name, count: ammoCount(item), bonus: ammoBonus(item), kind };
}

export type AmmoSpend =
  | { ok: true; index: number; name: string; remaining: number; kind: AmmoKind; bonus?: number }
  | ({ ok: false; kind: AmmoKind } & ToolError);

// Spends one round. Returns the new count rather than mutating, so the
// caller decides how to persist it.
export function spendAmmo(
  equipment: Item[],
  // The SRD weapon it is (AttackProfile's base), and the name it is carried
  // under.
  weapon: { base: string | undefined; name: string },
  characterName: string,
  // The line the shot names (pc_attack `ammo`), magic ammunition most often.
  named?: string,
): AmmoSpend | null {
  const kind = ammoKindForWeapon(weapon.base);
  if (!kind) {
    // Not an ammunition weapon; nothing to track.
    return null;
  }
  if (named) {
    const line = namedAmmo(equipment, weapon, named);
    if (!line) {
      return null;
    }
    if (!line.ok) {
      return { ...line, kind };
    }
    return { ok: true, kind, index: line.index, name: line.name, remaining: line.count - 1, bonus: line.bonus };
  }
  const found = findAmmo(equipment, kind);
  if (!found) {
    // Magic ammunition left, but the shot did not name it.
    const magic = magicAmmoFor(equipment, weapon.base).map((line) => line.name);
    return {
      ok: false,
      kind,
      error: magic.length
        ? `${characterName} has no ordinary ${AMMO_LABELS[kind]} left for the ${weapon.name}, only ${magic.join(", ")}: name it in ammo to fire it.`
        : `${characterName} is out of ${AMMO_LABELS[kind]} and cannot fire the ${weapon.name}.`,
      refused: "rules",
    };
  }
  return {
    ok: true,
    kind,
    index: found.index,
    name: found.item.name,
    remaining: found.count - 1,
  };
}

// Rewrites the inventory line to a new count, dropping a line that hits
// zero. A "(20)"-style name is rewritten in place so the two never disagree.
export function withAmmoCount<T extends Item>(items: T[], index: number, count: number): T[] {
  const next = [...items];
  const item = next[index];
  if (!item) {
    return next;
  }
  if (count <= 0) {
    next.splice(index, 1);
    return next;
  }
  const bracketed = /\((\d+)\)\s*$/.exec(item.name.trim());
  next[index] = {
    ...item,
    qty: count,
    name: bracketed ? item.name.replace(/\((\d+)\)\s*$/, `(${count})`) : item.name,
  };
  return next;
}

// After a battle a character recovers half the ammunition they spent,
// rounded down (PHB, "Ammunition"). Spent counts are tallied per encounter.
export function recoveredAmmo(spent: number): number {
  return Math.floor(Math.max(0, spent) / 2);
}

// The ordinary line each kind comes back as, by the SRD gear row's own name
// (src/lib/srd/adventuring-gear.ts), which carries the kind's tag.
export const PLAIN_AMMO: Record<AmmoKind, string> = {
  arrows: "Arrows",
  bolts: "Crossbow Bolts",
  bullets: "Sling Bullets",
  needles: "Blowgun Needles",
};

// What half of a quiver line's spent pieces come back as. SRD 5.1,
// Ammunition, +1, +2, or +3: "Once it hits a target, the ammunition is no
// longer magical." Of the half recovered, the half of the misses comes back
// as the magic line and the rest as ordinary ammunition of its kind; every
// recovered piece came back magical, the ones that hit too. `hits` is
// counted only for a magic line (ammo-tally.ts), so an ordinary line comes
// back whole as itself.
export function ammoSplit(spent: number, hits: number): { magic: number; plain: number } {
  const back = recoveredAmmo(spent);
  if (hits <= 0) {
    return { magic: back, plain: 0 };
  }
  const magic = Math.min(back, recoveredAmmo(spent - hits));
  return { magic, plain: back - magic };
}

// Whether the party is there to gather it: SRD 5.1, Ammunition: "At the end
// of the battle, you can recover half your expended ammunition by taking a
// minute to search the battlefield." A party that fled, or lies beaten, has
// no field to search; the arrows it loosed stay where they fell.
export function searchesTheField(outcome: string): boolean {
  return outcome !== "party_fled" && outcome !== "party_defeated";
}
