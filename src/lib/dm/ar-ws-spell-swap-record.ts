// The record of a subclass spell replaced at a level-up: a sorcerer origin's
// own spell (a Divine Soul's affinity spell, an Aberrant Mind's psionic spell,
// a Clockwork Soul's clockwork spell) given up for another under the rule its
// feature states (ar-ws-origin-swap.ts decides it, at the level-up door).
//
// The record is a feature on the sheet, "Spell swap: Calm Emotions > Command":
// the spell the subclass's table names, then the spell that holds its place
// now. It is written with source "story", so the regrant of class features
// keeps it and an edit of the sheet keeps it as it keeps every boon earned in
// play; a sheet arriving from outside cannot carry one in
// (src/lib/srd/legality/features.ts isMechanicalFeature).
//
// Every reader of a subclass's free spells asks features.ts subclassSpellsFor
// with the sheet's features, which reads the records here: the spell swapped
// in is free of the spells known, always known and (for an Aberrant Mind) paid
// with sorcery points as the one it replaced was, and the one given up is the
// origin's no longer.
//
// Pure, and imports nothing of the feature tables (they import this).
import { textKey } from "@/lib/language/text-logic";

const LABEL = "Spell swap";
const RECORD = /^spell swap:\s*(.+?)\s+>\s+(.+)$/i;
// A sheet's feature name is clipped at 80 characters (schemas/sheet.ts).
const NAME_MAX = 80;

export type SpellSwap = { from: string; to: string };

export function swapRecordName(swap: SpellSwap): string {
  return `${LABEL}: ${swap.from} > ${swap.to}`;
}

// Whether both names fit a feature's name whole: a clipped record would name
// a spell that does not exist.
export function swapRecordFits(swap: SpellSwap): boolean {
  return swapRecordName(swap).length <= NAME_MAX;
}

export function swapOf(name: string): SpellSwap | null {
  const parts = RECORD.exec(name.trim());
  return parts ? { from: parts[1].trim(), to: parts[2].trim() } : null;
}

export const isSwapRecord = (name: string): boolean => swapOf(name) !== null;

export function swapsOf(features: ReadonlyArray<{ name: string }> | undefined): SpellSwap[] {
  return (features ?? []).flatMap((feature) => swapOf(feature.name) ?? []);
}

// A subclass's free spells with every recorded replacement made: the spell
// the table names gives way to the one holding its place. A record that names
// a spell the list does not hold changes nothing.
export function withSpellSwaps(spells: string[], features: ReadonlyArray<{ name: string }> | undefined): string[] {
  const swaps = swapsOf(features);
  if (!swaps.length) {
    return spells;
  }
  const placed = new Map(swaps.map((swap) => [textKey(swap.from), swap.to]));
  return [...new Set(spells.map((name) => placed.get(textKey(name)) ?? name))];
}

export function withoutSwapRecords<T extends { name: string }>(features: ReadonlyArray<T> | undefined): T[] {
  return (features ?? []).filter((feature) => !isSwapRecord(feature.name));
}

// The sheet's features with the swap records set to those a level-up settled
// on (`settled`: the caster's features after it, levelUpSpells' view).
export function carrySwapRecords<T extends { name: string }>(
  features: T[],
  settled: ReadonlyArray<{ name: string }> | undefined,
  record: (name: string) => T,
): T[] {
  const wanted = swapsOf(settled).map(swapRecordName);
  const held = features.filter((feature) => isSwapRecord(feature.name)).map((feature) => feature.name);
  if (wanted.length === held.length && wanted.every((name, at) => name === held[at])) {
    return features;
  }
  return [...withoutSwapRecords(features), ...wanted.map(record)];
}

type SpellLists = { known?: string[]; prepared?: string[]; pending?: string[] };

// A sheet's lists as an edit sends them, without the spell a recorded swap
// took out of them. The builder rebuilds a sheet from the subclass's table and
// writes the table's spell back among the spells known; it is the origin's no
// longer, and judged as a spell learned it would be off the class's list and
// refuse the whole edit (src/lib/srd/legality/spells.ts judgeSpellcasting). A
// spell the stored sheet holds stays: the sorcerer learned it again since.
export function withoutSwappedOut<T extends SpellLists & { casters?: SpellLists[] }>(
  sent: T | null,
  features: ReadonlyArray<{ name: string }> | undefined,
  held: (SpellLists & { casters?: SpellLists[] }) | null | undefined,
): T | null {
  const swaps = swapsOf(features).filter((swap) => textKey(swap.from) !== textKey(swap.to));
  if (!sent || !swaps.length) {
    return sent;
  }
  const kept = new Set(
    [held, ...(held?.casters ?? [])].flatMap((lists) => [...(lists?.known ?? []), ...(lists?.prepared ?? []), ...(lists?.pending ?? [])]).map(textKey),
  );
  const gone = new Set(swaps.map((swap) => textKey(swap.from)).filter((name) => !kept.has(name)));
  if (!gone.size) {
    return sent;
  }
  const strip = <L extends SpellLists>(lists: L): L => ({
    ...lists,
    ...(lists.known ? { known: lists.known.filter((name) => !gone.has(textKey(name))) } : {}),
    ...(lists.prepared ? { prepared: lists.prepared.filter((name) => !gone.has(textKey(name))) } : {}),
    ...(lists.pending ? { pending: lists.pending.filter((name) => !gone.has(textKey(name))) } : {}),
  });
  const top = strip(sent);
  return sent.casters ? { ...top, casters: sent.casters.map(strip) } : top;
}
