// The features that give a character advantage on attacks against one
// creature, read from what the Hand can see: the character's sheet and the
// encounter as the table sees it. The engine decides the roll itself
// (src/lib/dm/authored-hooks.ts authoredAttackSituation); this mirrors the
// parts of that a seat can see, so a card's hit odds carry the advantage the
// roll will have. Without it a vowed paladin's card showed one d20's odds
// against the creature their Vow of Enmity names, and an assassin's showed
// the same against a creature yet to act.
//
// Pure; scripts/test-hand.mjs drives it.
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { activeAuthored } from "@/lib/srd/authored-effects";
import { vowedFoe } from "@/lib/srd/vow-of-enmity";
import { textKey } from "@/lib/language/text-logic";

export type EdgeClock = Pick<PublicEncounter, "round" | "orderReady" | "order">;

export function featureAdvantage(
  sheet: CharacterSheet,
  enemy: { id: string; type?: string },
  clock?: EdgeClock,
): string[] {
  const out: string[] = [];
  if (vowedFoe(sheet) === enemy.id) {
    out.push("Vow of Enmity");
  }
  const type = textKey(enemy.type ?? "");
  for (const { effect, held } of activeAuthored(sheet, "attack_adv")) {
    let applies = false;
    if (effect.vs === "types") {
      applies = Boolean(type) && (effect.types ?? []).some((kind) => type.includes(kind));
    } else if (effect.vs === "not_acted" && clock?.orderReady && clock.round <= 1) {
      // Not yet acted in the first round: it comes after this character in
      // the order the table sees. The Hand previews on the character's own
      // turn, so they are the one acting; a creature hidden from the seat is
      // no chip to aim at.
      const self = clock.order.findIndex((entry) => entry.kind === "pc" && entry.id === sheet.id);
      const at = clock.order.findIndex((entry) => entry.kind === "enemy" && entry.id === enemy.id);
      applies = self >= 0 && at > self;
    }
    if (applies && !out.includes(held.feature)) {
      out.push(held.feature);
    }
  }
  return out;
}
