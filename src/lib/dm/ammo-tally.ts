// The ammunition a fight spends, tallied per character and quiver line
// (Encounter.ammoSpent), and the half recovered when it ends (SRD 5.1,
// Ammunition: "At the end of the battle, you can recover half your expended
// ammunition by taking a minute to search the battlefield."). Moved here
// from pc-attack.ts (the shot) and enemy-damage.ts (the recovery), which
// were both past the file size the repo keeps, when magic ammunition's hits
// joined the tally.

import { getActiveEncounter, saveEncounter, type Encounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { ammoCount, ammoKindForItem, ammoSplit, findAmmo, PLAIN_AMMO, withAmmoCount } from "@/lib/srd/ammunition";
import type { EquipmentItem } from "@/lib/schemas/sheet";

type Tally = Encounter["ammoSpent"];
type TallyEntry = Tally[string];

const spentOf = (entry: TallyEntry | undefined) => (typeof entry === "object" ? entry.spent : (entry ?? 0));
const hitsOf = (entry: TallyEntry | undefined) => (typeof entry === "object" ? (entry.hits ?? 0) : 0);

// One piece spent from the line at `index` of `carried` (`equipment` is the
// pack after the spend). Returns the line's name as the tally now holds it.
// Tallied under the line's name as it reads NOW: a quiver written
// "Arrows (20)" is renamed by every shot, and the tally follows it so the
// end of the fight finds the line it has to refill. The last one spent
// takes the line off the sheet, so the tally keeps the line itself.
export function tallyShot(encounter: Encounter, sheetId: string, ammo: { index: number; name: string; remaining: number }, carried: EquipmentItem[], equipment: EquipmentItem[]): string {
  const emptied = ammo.remaining <= 0;
  const name = emptied ? ammo.name : (equipment[ammo.index]?.name ?? ammo.name);
  const before = `${sheetId}|${ammo.name}`;
  const after = `${sheetId}|${name}`;
  const tally = { ...encounter.ammoSpent };
  const held = tally[before];
  delete tally[before];
  const spent = spentOf(tally[after]) + spentOf(held) + 1;
  const hits = hitsOf(tally[after]) + hitsOf(held);
  const line = emptied ? carried[ammo.index] : undefined;
  tally[after] = line || hits ? { spent, ...(line ? { line } : {}), ...(hits ? { hits } : {}) } : spent;
  encounter.ammoSpent = tally;
  saveEncounter(encounter);
  return name;
}

// A magic piece that hit (attack-blow.ts): "Once it hits a target, the
// ammunition is no longer magical" (SRD 5.1, Ammunition, +1, +2, or +3).
// Found by the name the shot was tallied under, or, renamed since, by the
// same name without its "(N)" count.
export function tallyHit(campaignId: string, sheetId: string, lineName: string) {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return;
  }
  const bare = (name: string) => name.replace(/\s*\(\d+\)\s*$/, "").trim();
  const keys = Object.keys(encounter.ammoSpent);
  const key = keys.find((entry) => entry === `${sheetId}|${lineName}`) ?? keys.find((entry) => entry.startsWith(`${sheetId}|`) && bare(entry.slice(sheetId.length + 1)) === bare(lineName));
  const entry = key ? encounter.ammoSpent[key] : undefined;
  if (!key || entry === undefined) {
    return;
  }
  const spent = spentOf(entry);
  const hits = Math.min(spent, hitsOf(entry) + 1);
  encounter.ammoSpent = { ...encounter.ammoSpent, [key]: { ...(typeof entry === "object" ? entry : {}), spent, hits } };
  saveEncounter(encounter);
}

// Half of each line's spent pieces back on its owner's sheet: a magic
// line's misses as itself, its hits as ordinary ammunition of its kind (the
// first ordinary line carried, else a new one). Returns what came back, by
// "<owner>: <line>".
export function recoverAmmo(encounter: Encounter): Record<string, number> {
  const recovered: Record<string, number> = {};
  for (const [key, entry] of Object.entries(encounter.ammoSpent)) {
    const { magic, plain } = ammoSplit(spentOf(entry), hitsOf(entry));
    if (magic + plain <= 0) {
      continue;
    }
    const separator = key.indexOf("|");
    const sheetId = key.slice(0, separator);
    const itemName = key.slice(separator + 1);
    const owner = getSheetById(sheetId);
    if (!owner) {
      continue;
    }
    let equipment = owner.equipment;
    if (magic > 0) {
      const index = equipment.findIndex((item) => item.name === itemName);
      // A spent-out quiver comes back as the line it was (an Italian "Frecce"
      // listed as Arrows stays arrows).
      const kept = typeof entry === "object" ? entry.line : undefined;
      equipment =
        index >= 0
          ? withAmmoCount(equipment, index, ammoCount(equipment[index]) + magic)
          : withAmmoCount([...equipment, kept ?? { name: itemName, qty: magic }], equipment.length, magic);
      recovered[`${owner.name}: ${itemName}`] = magic;
    }
    const kind = ammoKindForItem((typeof entry === "object" ? entry.line : undefined) ?? { name: itemName });
    if (plain > 0 && kind) {
      const ordinary = findAmmo(equipment, kind);
      equipment = ordinary
        ? withAmmoCount(equipment, ordinary.index, ordinary.count + plain)
        : withAmmoCount([...equipment, { name: PLAIN_AMMO[kind], qty: plain }], equipment.length, plain);
      const plainName = ordinary?.item.name ?? PLAIN_AMMO[kind];
      recovered[`${owner.name}: ${plainName}`] = (recovered[`${owner.name}: ${plainName}`] ?? 0) + plain;
    }
    patchSheet(sheetId, { equipment });
  }
  return recovered;
}
