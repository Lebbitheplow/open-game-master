// The card a creature warded by Bastion of Law is dealt while damage on
// record against it is open: its ward's dice, spent off that blow for no
// reaction (src/lib/dm/ar-ws-bastion.ts spendWardDice, which the card names
// with the variant the engine reads). The number of dice is the composer's;
// sent with none, the engine spends one.
//
// Pure; hand-react.ts reactionCards deals it with the hit reactions.
import type { PublicLastHit } from "@/lib/db/encounter-view";
import { gated, standingGate, type HandCard, type HandTurn } from "@/lib/battlemap/hand-core";
import { BASTION_OF_LAW, WARD_DIE, WARD_REDUCE, wardOn } from "@/lib/dm/ar-ws-bastion-logic";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { triggerKey } from "@/lib/srd/trigger-table";

export function wardCards(sheet: CharacterSheet, turn: HandTurn, hits: PublicLastHit[]): HandCard[] {
  const ward = wardOn(sheet);
  const key = triggerKey(textKey(BASTION_OF_LAW), sheet.id);
  // The heaviest blow still unanswered by the ward, as the engine picks it.
  const [hit] = hits
    .filter((entry) => entry.characterId === sheet.id && entry.hit && entry.damage > 0 && !(entry.answeredBy ?? entry.answered).includes(key))
    .sort((a, b) => b.damage - a.damage);
  if (!ward || !hit || sheet.deathSaves?.dead) return [];
  const card: HandCard = {
    id: `reaction:bastion-of-law:${hit.id ?? hit.characterId}`,
    type: "ward",
    name: BASTION_OF_LAW,
    cost: "free",
    range: "Self",
    dice: `-1${WARD_DIE} a die`,
    roll: "no roll",
    rules: `Spend dice of your ward (${ward.dice}${WARD_DIE} left) to take their total off the damage. It costs no reaction.`,
    resource: `Ward ${ward.dice}${WARD_DIE}`,
    condition: "",
    icon: { kind: "feature", key: BASTION_OF_LAW, family: null },
    target: "none",
    toHit: null,
    damage: null,
    damageType: "",
    heals: false,
    save: null,
    melee: false,
    disabled: null,
    spent: false,
    compose: true,
    unit: "dice",
    intent: { card: "feature", resourceId: BASTION_OF_LAW, variant: WARD_REDUCE },
    prompt: `${hit.attacker}: ${hit.damage} damage from ${hit.attack}`,
  };
  // Open on anyone's turn and to a creature the blow dropped: only the dead spend none.
  return [sheet.currentHp > 0 ? gated(card, standingGate(sheet, turn, "reaction")) : card];
}
