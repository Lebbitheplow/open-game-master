// The Hand's cards for what a Ring of Spell Storing holds. Each spell is a card
// of its own, so a ring holding several needs no words to say which: use_item
// asked "which one?" and the player had to type it.
//
// The card is the spell's own card (hand-spells.ts spellCard), with the stored
// spell's level and numbers on it and the ring's gates in place of the caster's:
// SRD 5.1, Magic Items, a spell cast from an item takes no slot and no
// components, so a fighter with no spellcasting holds it as a wizard does.
//
// A reaction spell waits for what it answers: its card here stays grey, and the
// card that casts it comes up when the attack lands (hand-react.ts). A spell of a
// minute or more is begun in a fight and held across turns, so the card aims at
// nothing until the casting is done (src/lib/dm/spell-storing.ts).
//
// Pure, with hand-spells.ts: scripts/test-hand-ring.mjs drives it.
import { castingOf, completedCastingOf } from "@/lib/dm/long-casting-logic";
import { findNamed, textKey } from "@/lib/language/text-logic";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { spellDrawnMark } from "@/lib/srd/item-cast-credit";
import { isSpellStorer, ringBarrier, storedSpellsOf, type StoredSpell } from "@/lib/srd/spell-storing";
import type { CombatRiders } from "@/lib/srd/feature-effects";
import { costGate, standingGate, type Gate, type HandCard, type HandCost, type HandOptions, type HandTurn, type SpellFact } from "@/lib/battlemap/hand-core";
import { castingCost, factFor, ringCardName, spellCard } from "@/lib/battlemap/hand-spells";
import { waitsForTrigger } from "@/lib/battlemap/hand-react-triggers";

export { ringCardName };

export type RingSpell = { ring: EquipmentItem; entry: StoredSpell };

// A ring holding two of one spell casts the first it finds (storedSpellNamed), so
// that is the one card; the other is dealt when the first has gone.
export function ringSpells(sheet: Pick<CharacterSheet, "equipment">): RingSpell[] {
  return sheet.equipment.filter(isSpellStorer).flatMap((ring) => {
    const seen = new Set<string>();
    return storedSpellsOf(ring).flatMap((entry) => {
      const key = textKey(entry.spell);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ ring, entry }];
    });
  });
}

export const ringBarrierGate = (sheet: CharacterSheet, ring: EquipmentItem): Gate => {
  const reason = ringBarrier(sheet, ring);
  return reason ? { reason, spent: false } : null;
};

function gatesFor(sheet: CharacterSheet, turn: HandTurn, row: RingSpell, cost: HandCost, paid: boolean): Gate[] {
  const { ring, entry } = row;
  const barrier = ringBarrierGate(sheet, ring);
  if (cost === "reaction") return [barrier, waitsForTrigger(entry.spell)];
  const held = castingOf(sheet);
  const casting: Gate = held?.fromRing && findNamed([held.spell], entry.spell, (name) => [name])
    ? { reason: `${sheet.name} is casting ${entry.spell}: it takes effect when the casting is done, and leaves the ring only then.`, spent: false }
    : null;
  return [
    barrier,
    standingGate(sheet, turn, cost === "bonus" ? "bonus" : "action"),
    casting,
    paid ? null : costGate(cost, turn, sheet, `casting ${entry.spell} from ${ring.name}`),
  ];
}

export function ringSpellCards(sheet: CharacterSheet, turn: HandTurn, riders: CombatRiders, options: HandOptions): HandCard[] {
  return ringSpells(sheet).flatMap((row) => {
    const { ring, entry } = row;
    const fact: SpellFact = factFor(entry.spell, options) ?? { level: entry.level, school: "", castingTime: "", range: "", desc: "", higherLevel: "", concentration: false };
    const long = castingCost(fact.castingTime) === null;
    const done = long && Boolean(completedCastingOf(sheet, entry.spell));
    const cost: HandCost = castingCost(fact.castingTime) ?? "action";
    // Paid for already: a casting held to its end, or a draw whose cast was refused.
    const paid = done || new Set(turn.marks ?? []).has(spellDrawnMark(entry.spell));
    const card = spellCard(sheet, turn, riders, entry.spell, fact, options, {
      ring: ring.name,
      entry,
      holds: long && Boolean(turn.table) && !done,
      free: done,
      gates: gatesFor(sheet, turn, row, cost, paid),
      fromItem: { key: textKey(ring.name), label: ring.name, note: `Holds ${storedSpellsOf(ring).length}` },
    });
    return card ? [card] : [];
  });
}

// What the Hand looks up beyond the sheet's own spells: a fighter's ring has no
// spell list behind it, and its card reads the pack's words as any card does.
export function ringSpellNames(sheet: Pick<CharacterSheet, "equipment">): string[] {
  return ringSpells(sheet).map((row) => row.entry.spell);
}
