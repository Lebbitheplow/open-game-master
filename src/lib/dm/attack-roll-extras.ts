// What a player character's held conditions add to their own attack roll:
// Bless's +1d4, Bane's -1d4, a flat bonus a condition names, True Strike's
// advantage, and a mote's Bardic Inspiration die, which bursts at the throw.
// pc-attack-situation.ts rolls these, and the Hand's attack and spell cards
// print them (src/lib/battlemap/hand-attack-lines.ts), so a blessed card says
// +9+1d4 and its odds count the die: it said +9.
//
// Pure: the Hand imports it.
import { holdsMoteDie } from "@/lib/dm/after-roll-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { conditionRollRiders, type ConditionRollRiders } from "@/lib/srd/condition-effects";
import type { BondRider } from "@/lib/dm/emboldening-bond-logic";

// An unspent Bardic Inspiration die: the size rides in the condition name,
// "bardic inspiration (d8)", as use_resource writes it.
function heldInspiration(conditions: string[]): { condition: string; die: string } | null {
  for (const condition of conditions) {
    const match = /^bardic inspiration \((d\d{1,2})\)$/i.exec(condition.trim());
    if (match) {
      return { condition, die: match[1].toLowerCase() };
    }
  }
  return null;
}

// `bond`: Emboldening Bond's d4 when another bonded creature stands in reach
// this turn, read off the board by the engine (src/lib/dm/emboldening-bond.ts
// bondRider); the Hand, which reads no distances, passes none.
export function attackRollExtras(sheet: Pick<CharacterSheet, "conditions" | "conditionMeta">, bond: BondRider | null = null): ConditionRollRiders {
  const riders = conditionRollRiders(sheet.conditions, "attack");
  if (bond) {
    riders.diceSuffix += `+${bond.dice}`;
    riders.notes.push(bond.note);
    riders.spent.push(bond.spend);
  }
  // A held Bardic Inspiration die is the holder's to add once the d20 is
  // rolled (SRD 5.1): the attack adds it only to a miss it can turn into a
  // hit (forced-save.ts settleHeldDie). A mote's die bursts at the throw
  // (authored-mote.ts), so it still rides the roll from the start.
  const inspiration = holdsMoteDie(sheet) ? heldInspiration(sheet.conditions) : null;
  if (inspiration) {
    riders.diceSuffix += `+1${inspiration.die}`;
    riders.notes.push(`spends their Bardic Inspiration die: +1${inspiration.die} to the attack roll`);
    riders.spent.push(inspiration.condition);
  }
  return riders;
}

// The suffix split as a card shows it: the flat part joins the bonus, the
// dice ride beside it ("+1d4", "-1d4").
export function splitRollSuffix(suffix: string): { flat: number; dice: string } {
  let flat = 0;
  let dice = "";
  for (const match of suffix.replace(/\s+/g, "").matchAll(/([+-])(\d+)(d\d+)?/g)) {
    if (match[3]) {
      dice += `${match[1]}${match[2]}${match[3]}`;
    } else {
      flat += (match[1] === "-" ? -1 : 1) * Number(match[2]);
    }
  }
  return { flat, dice };
}
