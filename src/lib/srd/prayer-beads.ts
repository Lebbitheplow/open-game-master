// The magic beads of a Necklace of Prayer Beads.
//
// SRD 5.1: "This necklace has 1d4 + 2 magic beads ... The GM decides the type
// of each bead or determines it randomly", each bead "contains a spell that
// you can cast from it", and "Once a magic bead's spell is cast, that bead
// can't be used again until the next dawn." The GM's decision is written the
// way a family's member is (a Crystal Ball (Telepathy)): in brackets after the
// name, "Necklace of Prayer Beads (Blessing, Curing x2, Smiting)". With none
// written the beads are unknown: a card would let the player pick a bead the
// GM never gave, so none is dealt, and use_item leaves the bead to the GM.
// `beadsSpent` on the row names each bead used since dawn.
//
// Pure: the Hand's cards (src/lib/battlemap/hand-items.ts) and use_item
// (src/lib/dm/item-use.ts) ask the same questions.
import { findNamed, textKey } from "@/lib/language/text-logic";

export type BeadKind = "blessing" | "curing" | "favor" | "smiting" | "summons" | "wind walking";

const BEAD_SPELLS: Record<BeadKind, string[]> = {
  blessing: ["Bless"],
  curing: ["Cure Wounds", "Lesser Restoration"],
  favor: ["Greater Restoration"],
  smiting: ["Branding Smite"],
  summons: ["Planar Ally"],
  "wind walking": ["Wind Walk"],
};

const NECKLACE = textKey("Necklace of Prayer Beads");
const KINDS = Object.keys(BEAD_SPELLS) as BeadKind[];

// The name without the GM's note in brackets.
function bare(name: string): string {
  return name.trim().replace(/\s*\([^()]*\)\s*$/, "");
}

export function isPrayerNecklace(name: string): boolean {
  return textKey(bare(name)) === NECKLACE;
}

// A bead's kind by its whole name, as the table writes it: "Curing" or "Bead
// of Curing".
function kindOf(word: string): BeadKind | null {
  return findNamed(KINDS, word.trim(), (kind) => [kind, `bead of ${kind}`]) ?? null;
}

// How many beads of each kind the necklace's name says it holds, or null when
// it names none.
export function beadsOf(name: string): Partial<Record<BeadKind, number>> | null {
  const note = /\(([^()]*)\)\s*$/.exec(name.trim());
  if (!isPrayerNecklace(name) || !note) {
    return null;
  }
  const beads: Partial<Record<BeadKind, number>> = {};
  for (const part of note[1].split(/[,;]/)) {
    const match = /^\s*(\d+)?\s*[x×]?\s*(.*?)\s*(?:[x×]\s*(\d+))?\s*$/i.exec(part);
    const kind = match ? kindOf(match[2]) : null;
    if (kind) {
      beads[kind] = (beads[kind] ?? 0) + Math.max(1, Number(match![1] ?? match![3] ?? 1));
    }
  }
  return Object.keys(beads).length ? beads : null;
}

export function beadCount(beads: Partial<Record<BeadKind, number>>): number {
  return Object.values(beads).reduce((sum, count) => sum + (count ?? 0), 0);
}

// The bead a spell is cast from.
export function beadForSpell(spell: string): BeadKind | null {
  const key = textKey(spell);
  return KINDS.find((kind) => BEAD_SPELLS[kind].some((entry) => textKey(entry) === key)) ?? null;
}

// Whether a spell is cast from one of these beads.
export function beadsCast(beads: Partial<Record<BeadKind, number>>, spell: string): boolean {
  const kind = beadForSpell(spell);
  return Boolean(kind && beads[kind]);
}

// Why this bead cannot be used now, or null: none of its kind on the
// necklace, or every one of them used since dawn.
export function beadRefusal(item: { name: string; beadsSpent?: string[] }, spell: string): string | null {
  const beads = beadsOf(item.name);
  const kind = beadForSpell(spell);
  if (!beads || !kind) {
    return null;
  }
  const held = beads[kind] ?? 0;
  if (!held) {
    return `${item.name} holds no bead of ${kind}, so it does not cast ${spell}. Nothing was spent.`;
  }
  const spent = (item.beadsSpent ?? []).filter((entry) => entry === kind).length;
  return spent >= held ? `Every bead of ${kind} on ${item.name} has been used since dawn. Nothing was spent.` : null;
}
