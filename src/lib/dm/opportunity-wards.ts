// What stands between a creature's opportunity attack and the character
// walking out of its reach, read as on the creature's own turn
// (enemy-attack.ts, enemy-swing-odds.ts): the Flanking variant, measured on
// the square the character stood on as the swing was made (the attack comes
// before they leave); Sanctuary and Nature's Sanctuary turning it away, and
// Among the Dead's save, either of which loses the attack; the subclass
// wards that weigh on its roll or its blow (authored-hooks.ts
// authoredIncomingAttack); Mirror Image's duplicates; Adamantine Armor
// against a critical; the dark-fantasy weapon wards; and what the blow is
// made of for Heavy Armor Master and One Blood. The reaction's swing read
// none of them: a fighter in plate with Heavy Armor Master took a club's
// whole blow, a cleric under Sanctuary was struck with no save, and a hero
// walking out of a flank was struck on a single d20.
//
// An Arcane Ward is the damage path's (pc-damage.ts), which the swing
// already lands through.

import type { Campaign } from "@/lib/db/campaigns";
import type { EncounterEnemy } from "@/lib/db/encounters";
import type { Advantage } from "@/lib/dice";
import { enemyFlanks } from "@/lib/dm/attack-spatial";
import { authoredIncomingAttack } from "@/lib/dm/authored-hooks";
import { authoredWardSave } from "@/lib/dm/ar-wbf-warlock-ward";
import { sanctuaryWard } from "@/lib/dm/enemy-conditions";
import { mirrorImageDecoy, sanctuaryRefusal } from "@/lib/dm/spell-defenses";
import { naturesSanctuaryRefusal } from "@/lib/dm/srd-defenses";
import { darkFantasyWeaponWard } from "@/lib/dm/genre-a-dark-fantasy-wards";
import { paBlowResists } from "@/lib/dm/genre-b-post-apocalyptic-blows";
import type { BlowFlags } from "@/lib/dm/pc-damage";
import { withOpportunityTurn } from "@/lib/dm/opportunity-strike";
import { wornArmorTurnsCrits } from "@/lib/srd/armor";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type XY = { x: number; y: number };

export type OpportunityWards = {
  // The attack is lost (the reaction is spent): why.
  lost: string | null;
  sources: Advantage[];
  notes: string[];
  noCrit: boolean;
  halve: boolean;
  // What the blow is made of, for the defences that read it.
  flags: BlowFlags;
};

// Before the roll: what loses the attack, weighs on its odds, or shapes its
// blow. `at`: where the character stood as it was made.
export function opportunityWards(campaign: Campaign, encounterId: string, enemy: EncounterEnemy, sheet: CharacterSheet, at: XY, magical: boolean): OpportunityWards {
  const flags: BlowFlags = {
    attack: true,
    ...(magical ? { magical: true } : {}),
    ...paBlowResists({ campaignId: campaign.id, encounterId, attacker: enemy, target: sheet, ranged: false, spellAttack: false }),
  };
  const turned = sanctuaryWard(campaign.id, enemy, sheet, sanctuaryRefusal) ?? sanctuaryWard(campaign.id, enemy, sheet, naturesSanctuaryRefusal);
  if (turned) {
    return { lost: turned.error, sources: [], notes: [], noCrit: false, halve: false, flags };
  }
  const warded = withOpportunityTurn(campaign.id, (turn) => authoredWardSave(campaign, turn, enemy, sheet));
  if (warded.lost) {
    return { lost: warded.lost, sources: [], notes: [], noCrit: false, halve: false, flags };
  }
  const authored = authoredIncomingAttack({ campaignId: campaign.id, encounterId, attacker: enemy, target: sheet });
  const flanking = campaign.gameSettings.variantRules.flanking && enemyFlanks(encounterId, enemy.id, sheet.id, at);
  return {
    lost: null,
    sources: [...authored.sources, ...(flanking ? ["advantage" as const] : [])],
    notes: [...(warded.note ? [warded.note] : []), ...authored.notes, ...(flanking ? ["flanking: advantage"] : [])],
    noCrit: Boolean(authored.noCrit) || wornArmorTurnsCrits(sheet.equipment ?? []),
    halve: Boolean(authored.halve),
    flags: { ...flags, ...(authored.spurned.length ? { exceptFeatures: authored.spurned } : {}) },
  };
}

// After the roll: a duplicate Mirror Image puts in the way, or null.
export function opportunityDecoy(campaignId: string, sheetId: string, total: number, enemy: EncounterEnemy): string | null {
  return mirrorImageDecoy(campaignId, sheetId, total, enemy);
}

// The blow as it reaches the character: halved by a mark that halves it,
// then the dark-fantasy weapon wards (Threnody, Sepulchral Aura).
export function opportunityBlow(encounterId: string, enemy: EncounterEnemy, sheet: CharacterSheet, wards: OpportunityWards, amount: number): { amount: number; notes: string[] } {
  const halved = wards.halve ? Math.floor(amount / 2) : amount;
  return darkFantasyWeaponWard(encounterId, enemy.id, sheet, { spellAttack: false }, halved);
}
