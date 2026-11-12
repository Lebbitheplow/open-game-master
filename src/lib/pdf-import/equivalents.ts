import { parseMonster, type EnemyStats } from "@/lib/bestiary/statblock";
import { checkMonsterDraft } from "@/lib/bestiary/monster-draft";
import { resolveMonster } from "@/lib/bestiary/index";
import { isValidExpression } from "@/lib/dice";
import { matchKey } from "@/lib/pdf-import/ai-logic";
import type { Draft, DraftRecord } from "@/lib/pdf-import/draft-logic";
import { SYSTEM_LABELS, type BookSystem } from "@/lib/pdf-import/foreign-statblock-logic";
import type { PrintedMonster } from "@/lib/pdf-import/statblock-text-logic";
import { matchCreature, matchItem, matchSpell, srdAvailable } from "@/lib/pdf-import/srd-match";
import { oneOf, withoutCount } from "@/lib/pdf-import/srd-names-logic";

// Every creature, item and spell of a book set beside its SRD 5.1
// equivalent, whatever system the book was written for.
//
// A creature the SRD has (by its name, another printing's name, or a name
// that ends in it) plays as that SRD 5.1 creature: under the SRD's name when
// they are the same, or as a copy with the SRD's numbers under the book's
// name ("Starved Grey Ooze" is the Gray Ooze). A 5e book's own stat block
// for a creature the SRD lacks is kept as printed; another system's is
// converted (foreign-statblock-logic.ts) and put to the GM in the review
// beside its closest SRD 5.1 creatures (matches.ts). Items and
// spells the SRD has are the SRD's; the rest become the workshop's own.

const SETTING = { genre: "high_fantasy" };

export function srdStats(name: string): { stats: EnemyStats; baseName: string } | null {
  const found = resolveMonster(name, SETTING, {});
  return found ? { stats: found.stats, baseName: found.baseName } : null;
}

// The bestiary's own check on numbers read from a page; an attack whose
// dice cannot be rolled is dropped rather than losing the whole block.
function playable(record: DraftRecord, stats: EnemyStats): EnemyStats | null {
  let check = checkMonsterDraft({ name: record.name, ...stats });
  if (!("error" in check)) return stats;
  const kept = (stats.attacks ?? []).filter((attack) => attack.name && attack.damage && isValidExpression(attack.damage));
  const dropped = (stats.attacks ?? []).length - kept.length;
  const trimmed = { ...stats, attacks: kept, specials: undefined };
  check = checkMonsterDraft({ name: record.name, ...trimmed });
  if (dropped) record.check.push(`${dropped} attack${dropped === 1 ? "" : "s"} could not be read into dice and ${dropped === 1 ? "was" : "were"} left as text.`);
  return "error" in check ? null : trimmed;
}

export function conversionNote(system: BookSystem, readable: boolean): string {
  return readable
    ? `Converted from ${SYSTEM_LABELS[system]}: no SRD 5.1 creature has this name, so its numbers are a conversion. Check them.`
    : `This stat block could not be read into numbers a fight can play; it is kept as the GM's lore.`;
}

function playAsSrd(record: DraftRecord, srdName: string, why: string, exact: boolean): boolean {
  const srd = srdStats(srdName);
  if (!srd) return false;
  // "Kobolds" is the Kobold: the record takes the SRD's name.
  if (exact) record.name = srd.baseName;
  const same = matchKey(srd.baseName) === matchKey(record.name);
  record.data.srd = srd.baseName;
  // The same name: fights and the Cast use the SRD's own creature. Another
  // name: a copy with the SRD's numbers under the book's name.
  record.data.srdDiffers = !same;
  record.data.stats = same ? null : srd.stats;
  record.data.asSrd = !same;
  record.check.push(same ? `The SRD 5.1 ${srd.baseName}${why}.` : `Plays as the SRD 5.1 ${srd.baseName}${why}, under the book's name.`);
  return true;
}

// Numbers a scan's text layer misread: a CR past 30, a creature of some
// power with 1 hit point, or a big one with CR 0.
function implausible(stats: EnemyStats | null): boolean {
  if (!stats) return false;
  return stats.cr > 30 || (stats.maxHp <= 1 && stats.cr >= 1) || (stats.cr === 0 && stats.maxHp > 30) || stats.ac > 30;
}

// The same creature printed twice (an encounter and the appendix, two
// rooms with oil beetles) is one creature: the first keeps the pages of
// both.
function mergeDuplicates(draft: Draft): void {
  const seen = new Map<string, DraftRecord>();
  draft.records = draft.records.filter((record) => {
    if (record.kind !== "monster") return true;
    const key = matchKey(record.name);
    const first = seen.get(key);
    if (!first) {
      seen.set(key, record);
      return true;
    }
    first.pages = [...new Set([...first.pages, ...record.pages])].sort((a, b) => a - b);
    return false;
  });
}

export function settleMonsters(draft: Draft): void {
  const system = (draft.system ?? "5e") as BookSystem;
  const foreign = system !== "5e";
  for (const record of draft.records) {
    if (record.kind !== "monster") continue;
    const printed = record.data.printed as PrintedMonster;
    // How many is the encounter's business; the stat block is for one.
    const counted = withoutCount(record.name);
    if (counted !== record.name) {
      record.name = oneOf(counted);
      printed.name = record.name;
    }
    const kind = /\(([^)]*[a-z][^)]*)\)/i.exec(record.name)?.[1] ?? record.name;
    const hit = srdAvailable() ? (matchCreature(record.name) ?? matchCreature(kind)) : null;
    const stats = playable(record, parseMonster(printed as unknown as Record<string, unknown>, printed.cr));

    if (foreign) {
      // The SRD's name (or another printing's): its SRD 5.1 creature.
      if (hit && hit.via !== "within" && playAsSrd(record, hit.entry.name, ` (this book is written for ${SYSTEM_LABELS[system]})`, hit.via === "exact")) continue;
      // Otherwise the conversion stands until the GM confirms a match in
      // the review (matches.ts): a name that only ends in an SRD one
      // ("Starved Grey Ooze") is its suggestion. The book's numbers are
      // kept whatever is chosen, so a choice can be taken back.
      record.data.stats = stats;
      record.data.bookStats = stats;
      record.data.converted = true;
      record.data.wasConverted = true;
      if (hit) record.data.nameHit = hit.entry.name;
      record.data.matchCheck = [conversionNote(system, Boolean(stats))];
      continue;
    }

    // A 5e book: its own block is already 5.1's terms. Beside a built-in of
    // the same name, the built-in is used when the numbers agree. A row of
    // a creature table is the SRD's creature when it has the SRD's name.
    if (record.data.table && hit && hit.via !== "within" && playAsSrd(record, hit.entry.name, "", hit.via === "exact")) continue;
    if (record.data.table && stats) record.check.push("Read from a row of the book's creature table; its traits are in the GM's lore.");
    if (!stats) {
      record.check.push("This stat block could not be read into numbers a fight can play; it is kept as the GM's lore.");
      record.data.stats = null;
      continue;
    }
    record.data.stats = stats;
    if (hit && matchKey(hit.entry.name) === matchKey(record.name)) {
      const srd = srdStats(hit.entry.name);
      if (srd) {
        const same = srd.stats.ac === stats.ac && srd.stats.maxHp === stats.maxHp && srd.stats.cr === stats.cr;
        record.data.srd = srd.baseName;
        record.data.srdDiffers = !same;
        record.check.push(
          same
            ? `The same as the SRD 5.1 ${srd.baseName}; fights use the SRD's.`
            : `The SRD 5.1 also has a ${srd.baseName}; the book's version is kept under the book's title so fights use the right one.`,
        );
      }
    }
  }
  mergeDuplicates(draft);
  for (const record of draft.records) {
    if (record.kind === "monster" && implausible(record.data.stats as EnemyStats | null)) {
      record.check.push("Some of these numbers look misread (a scan's text layer does this): check its hit points, Armor Class and challenge against the page.");
    }
  }
}

// Items and spells: an SRD 5.1 entry of that name is the SRD's (nothing new
// is made); the rest become the workshop's own.
export function settleItemsAndSpells(draft: Draft): void {
  if (!srdAvailable()) return;
  for (const record of draft.records) {
    // Settled once: a second pass (after the model's reading) leaves what
    // the first settled as it was.
    if (record.data.srd || record.data.srdFamily) continue;
    if (record.kind === "item") {
      // A thing the book made up that ends in an SRD word ("Stone Maze") is
      // not that SRD thing: items and spells match by name alone.
      const hit = matchItem(record.name);
      if (hit && hit.via === "family") {
        record.data.srdFamily = hit.entry.name;
        record.check.push(`In SRD 5.1 terms this is the ${hit.entry.name}; it comes in as the book's own item so what it is (its weapon, its spell, its bonus) is kept.`);
      } else if (hit && hit.via !== "within") {
        record.data.srd = hit.entry.name;
        record.check.push(`This is the SRD 5.1 ${hit.entry.name}; the workshop uses the SRD's.`);
      }
    } else if (record.kind === "spell") {
      const hit = matchSpell(record.name);
      if (hit && hit.via !== "within") {
        record.data.srd = hit.entry.name;
        record.check.push(`This is the SRD 5.1 spell ${hit.entry.name}; the workshop uses the SRD's.`);
      }
    }
  }
}

