// The parts of the Path of the Battlerager (src/lib/srd/subclasses.json,
// odm-expanded) that ride another action rather than a passive effect: the
// spikes' 3 piercing on a grapple made while raging in spiked armor
// (Battlerager Armor, src/lib/dm/combat-actions.ts) and Reckless Abandon's
// temporary hit points when Reckless Attack is declared while raging
// (src/lib/dm/pc-attack.ts). Pure: the sheet comes in as a value.
import { gateHolds, heldAuthored, type AuthoredSheet } from "@/lib/srd/authored-effects";
import type { Gate } from "@/lib/srd/authored-effects-types";
import { textKey } from "@/lib/language/text-logic";

const SPIKED: Gate = { raging: true, wornArmor: "Spiked Armor" };

function holdsUnder(sheet: AuthoredSheet, feature: string, gate: Gate): boolean {
  const held = heldAuthored(sheet).find((row) => textKey(row.feature) === textKey(feature));
  return Boolean(held && gateHolds(gate, sheet, held));
}

// The piercing damage a grapple the sheet just won deals, or 0.
export function grappleSpikeDamage(sheet: AuthoredSheet): number {
  return holdsUnder(sheet, "Battlerager Armor", SPIKED) ? 3 : 0;
}

// The temporary hit points Reckless Abandon gives (the Constitution
// modifier, at least 1), or 0 when the sheet holds none of it or is calm.
export function recklessAbandonTempHp(sheet: AuthoredSheet, conMod: number): number {
  return holdsUnder(sheet, "Reckless Abandon", { raging: true }) ? Math.max(1, conMod) : 0;
}
