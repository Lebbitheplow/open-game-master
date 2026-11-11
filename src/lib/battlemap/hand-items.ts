// The Hand's cards for the spells magic items cast: a wand, a staff, a ring or a
// cloak that casts by its table (src/lib/srd/item-spells.ts), and a spell scroll
// (src/lib/srd/scrolls.ts). Each spell is a card of its own, as a Ring of Spell
// Storing's are (hand-ring.ts): a card holds one target and one area, and a Staff
// of Fire offers a cone, a burst and a wall.
//
// The card is the spell's own card (hand-spells.ts spellCard), with the item's
// level and numbers on it and the item's gates in place of the caster's: SRD 5.1,
// Magic Items, a spell cast from an item takes no slot and no components, so a
// fighter holds it as a wizard does. What it costs of the turn is what use_item
// charges (src/lib/dm/item-use.ts), an action or the bonus action the item's text
// names, whatever the spell's own casting time.
//
// Dealt only for what the engine carries out. An item whose charges do something
// other than cast a spell has no card: use_item spends the charge and tells the
// narrator to resolve the rest, which at a table a person runs is nobody.
//
// A card casts at the fewest charges, as a slot's card casts at the lowest slot;
// more charges for a higher level are asked for in words.
//
// Pure, with hand-spells.ts: scripts/test-hand-items.mjs drives it.
import { spellAttackFor, spellSaveDcFor } from "@/lib/srd";
import { textKey } from "@/lib/language/text-logic";
import { castingOf, completedCastingOf } from "@/lib/dm/long-casting-logic";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { itemBarrier } from "@/lib/srd/item-barrier";
import { spellDrawnMark } from "@/lib/srd/item-cast-credit";
import { chargeMax, chargeRuleOf, chargesLeft, chargesShort } from "@/lib/srd/item-charge-rules";
import { linesNamed } from "@/lib/srd/item-row";
import { itemSpellsOfRow, type ItemSpell } from "@/lib/srd/item-spells";
import { hasItemTag } from "@/lib/srd/item-tags";
import { scrollCheckDc, scrollNumbers, scrollSpell, scrollUnreadable } from "@/lib/srd/scrolls";
import { isSpellStorer } from "@/lib/srd/spell-storing";
import { scrollCastLevel } from "@/lib/srd/ar-ws-conjured";
import { beadRefusal, beadsOf, isPrayerNecklace } from "@/lib/srd/prayer-beads";
import { checklistSpell } from "@/lib/srd/spell-lists";
import type { CombatRiders } from "@/lib/srd/feature-effects";
import { costGate, standingGate, type Gate, type HandCard, type HandCost, type HandOptions, type HandTurn, type SpellFact } from "@/lib/battlemap/hand-core";
import { castingCost, factFor, spellCard } from "@/lib/battlemap/hand-spells";

export type ItemCastRow = { item: EquipmentItem; entry: ItemSpell; scroll: boolean };

export function unnamedBeads(item: Pick<EquipmentItem, "name">): boolean {
  return isPrayerNecklace(item.name) && !beadsOf(item.name);
}

// Each spell of each item the engine would cast it from. Two scrolls under one name
// read the first it finds, so that is the one card; the other is dealt when the
// first has gone. A mystery item deals nothing until it is named.
export function itemCastRows(sheet: Pick<CharacterSheet, "equipment">): ItemCastRow[] {
  const seen = new Set<string>();
  return sheet.equipment.flatMap((item): ItemCastRow[] => {
    // A necklace whose beads the GM has not named deals none: the card would
    // let its player pick a bead nobody gave them (prayer-beads.ts).
    if (item.identified === false || isSpellStorer(item) || unnamedBeads(item)) return [];
    const held = hasItemTag(item, "scroll") ? scrollSpell(item) : null;
    if (held) {
      const key = textKey(item.name);
      if (seen.has(key)) return [];
      seen.add(key);
      const known = checklistSpell(held);
      // One higher from a Master Scrivener's scroll, as it is read (consumables.ts).
      const level = scrollCastLevel(item, known?.level ?? 1);
      const numbers = scrollNumbers(level);
      return [{ item, scroll: true, entry: { spell: known?.name ?? held, charges: 0, level, dc: numbers.saveDc, attackBonus: numbers.attackBonus } }];
    }
    return itemSpellsOfRow(item).map((entry) => ({ item, entry, scroll: false }));
  });
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// The count of charges in words, or null for an item with none, or one whose count
// is rolled the first time it is used.
function chargeCount(item: EquipmentItem): { left: number; most: number } | null {
  const rule = chargeRuleOf(item);
  if (!rule || (typeof item.charges !== "number" && typeof rule.max !== "number")) return null;
  return { left: chargesLeft(item, rule), most: chargeMax(rule) };
}

function resourceLine({ item, entry, scroll }: ItemCastRow): string {
  if (scroll) return item.qty > 1 ? `Scroll ×${item.qty}` : "Scroll, one use";
  if (entry.usesUp) return "One use";
  if (!entry.charges) return "At will";
  const count = chargeCount(item);
  return count ? `Charges ${count.left}/${count.most}, costs ${entry.charges}` : `Costs ${plural(entry.charges, "charge")}`;
}

const WORDS = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" } as const;

// What the card's face says of paying for it: no slot, and what it does take. The
// item is in the card's name, and the face has room for a line or two.
function paying(sheet: CharacterSheet, { item, entry, scroll }: ItemCastRow): string {
  if (scroll) {
    const dc = scrollCheckDc(sheet, item);
    const ability = sheet.spellcasting ? WORDS[sheet.spellcasting.ability] : "";
    return `No slot: the scroll is used up.${dc !== null ? ` A DC ${dc} ${ability} check first: a failure loses the scroll and casts nothing.` : ""}`;
  }
  const rule = chargeRuleOf(item);
  const left = rule && chargeCount(item)?.left === 0;
  const risk = entry.charges && rule?.overuseRisk && left ? ` Used again before dawn: a ${rule.overuseRisk}% chance it tears and casts nothing.` : "";
  const check = entry.check ? ` A DC ${entry.check.dc} ${WORDS[entry.check.ability]} check first: a failure casts nothing.` : "";
  const higher = entry.perCharge ? " More charges cast it higher: say so in your own words." : "";
  const spends = entry.usesUp ? "using it destroys it" : entry.charges ? plural(entry.charges, "charge") : "at will";
  return `No slot: ${spends}.${risk}${check}${higher}`;
}

// A spell of a minute or more from an item whose text does not make it an
// action: in a fight it is held across turns, as a ring's is (item-use.ts). A
// scroll is read with an action, its text says.
export function itemCastHeld({ entry, scroll }: Pick<ItemCastRow, "entry" | "scroll">, fact: Pick<SpellFact, "castingTime">): boolean {
  return !scroll && !entry.bonusAction && !entry.asAction && castingCost(fact.castingTime) === null;
}

function gatesFor(sheet: CharacterSheet, turn: HandTurn, row: ItemCastRow, fact: SpellFact, cost: HandCost, done: boolean): Gate[] {
  const { item, entry, scroll } = row;
  const paid = done || new Set(turn.marks ?? []).has(spellDrawnMark(entry.spell));
  const held = castingOf(sheet);
  const casting: Gate =
    held?.fromRing && linesNamed([item], held.fromRing).length && textKey(held.spell) === textKey(entry.spell)
      ? { reason: `${sheet.name} is casting ${entry.spell}: it takes effect when the casting is done.`, spent: false }
      : null;
  const reason = (text: string | null): Gate => (text ? { reason: text, spent: false } : null);
  const named = linesNamed(sheet.equipment, item.name);
  const standing = standingGate(sheet, turn, cost === "bonus" ? "bonus" : "action");
  const pay = paid ? null : costGate(cost, turn, sheet, `using ${item.name}`);
  if (scroll) {
    return [reason(scrollUnreadable(sheet, item)), standing, pay];
  }
  const rule = chargeRuleOf(item);
  const short = rule ? chargesShort(item, rule, entry.charges) : null;
  const beadSpent = beadRefusal(item, entry.spell);
  return [
    // The engine will not guess between them (item-use.ts).
    named.length > 1 ? reason(`"${item.name}" could mean ${named.map((line) => line.name).join(" or ")}; name the item exactly. Nothing was spent.`) : null,
    reason(itemBarrier(sheet, item)),
    standing,
    casting,
    // A reaction spell answers its trigger through use_reaction, which no action
    // from an item can stand in for (cast-guard.ts).
    castingCost(fact.castingTime) === "reaction" ? reason(`${entry.spell} is cast as a reaction: say so in your own words when its trigger comes.`) : null,
    !rule && entry.charges ? reason(`${item.name} holds no charges, and ${entry.spell} from it costs ${entry.charges}. Nothing was spent.`) : null,
    short ? { reason: `${short} Nothing was spent.`, spent: true } : null,
    beadSpent ? { reason: beadSpent, spent: true } : null,
    pay,
  ];
}

export function itemSpellCards(sheet: CharacterSheet, turn: HandTurn, riders: CombatRiders, options: HandOptions): HandCard[] {
  return itemCastRows(sheet).flatMap((row) => {
    const { item, entry, scroll } = row;
    const fact: SpellFact = factFor(entry.spell, options) ?? { level: entry.level, school: "", castingTime: "", range: "", desc: "", higherLevel: "", concentration: false };
    const cost: HandCost = entry.bonusAction ? "bonus" : "action";
    const long = itemCastHeld(row, fact);
    const done = long && Boolean(completedCastingOf(sheet, entry.spell));
    const count = chargeCount(item);
    const card = spellCard(sheet, turn, riders, entry.spell, fact, options, {
      ring: item.name,
      // No modifier of its own: a healing spell heals with the one the DC
      // implies, as the heal tool reads the item's numbers (heal-bonus.ts).
      // The card added the wielder's own and showed 5d8+3 for an Orb of
      // Dragonkind whose DC 18 heals 5d8+4.
      entry: {
        spell: entry.spell,
        level: entry.level,
        // "using your spell save DC" where the item names none of its own.
        saveDc: entry.dc ?? spellSaveDcFor(sheet, entry.spell) ?? undefined,
        attackBonus: entry.attackBonus ?? spellAttackFor(sheet, entry.spell) ?? undefined,
      },
      holds: long && Boolean(turn.table) && !done,
      free: done,
      gates: gatesFor(sheet, turn, row, fact, cost, done),
      item: {
        id: `spell:item:${textKey(item.name)}:${textKey(entry.spell)}`,
        name: scroll ? `Scroll: ${entry.spell}` : `${item.name}: ${entry.spell}`,
        cost,
        resource: resourceLine(row),
        note: `${paying(sheet, row)}${long && turn.table && !done ? " It takes turns to cast: this begins it and holds your action each turn, and the item pays when it is done." : ""}`,
      },
      fromItem: scroll
        ? { key: "scrolls", label: "Scrolls", note: "" }
        : { key: textKey(item.name), label: item.name, note: count ? `${count.left} of ${plural(count.most, "charge")}` : "" },
    });
    return card ? [card] : [];
  });
}

// What the Hand looks up beyond the sheet's own spells: a fighter's wand has no
// spell list behind it, and its card reads the pack's words as any card does.
export function itemSpellNames(sheet: Pick<CharacterSheet, "equipment">): string[] {
  return itemCastRows(sheet).map((row) => row.entry.spell);
}
