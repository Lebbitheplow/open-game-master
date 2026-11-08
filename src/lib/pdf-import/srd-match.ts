import { getContentDb } from "@/lib/content/db";
import { bonusItem, buildIndex, itemFamily, matchSrdName, withoutBonus, type SrdCandidate, type SrdHit } from "@/lib/pdf-import/srd-names-logic";

// The SRD 5.1 a book's creatures, items and spells are matched to: the
// content pack's "wotc-srd" rows only (the pack also carries other
// publishers' 5e content, which is not what "its 5.1 equivalent" means).
// Read once per process. With no pack installed every lookup answers null,
// and the import keeps the book's own versions.

type Catalog = { entries: SrdCandidate[]; index: Map<string, SrdCandidate> };

declare global {
  var __odmSrdCatalogs: { db: unknown; monsters: Catalog; items: Catalog; spells: Catalog } | undefined;
}

const SRD_DOCUMENT = "wotc-srd";

function catalogs() {
  const db = getContentDb();
  if (globalThis.__odmSrdCatalogs && globalThis.__odmSrdCatalogs.db === db) return globalThis.__odmSrdCatalogs;
  const read = (sql: string): SrdCandidate[] => {
    if (!db) return [];
    try {
      return db.prepare(sql).all(SRD_DOCUMENT) as SrdCandidate[];
    } catch {
      return [];
    }
  };
  const make = (entries: SrdCandidate[]): Catalog => ({ entries, index: buildIndex(entries) });
  globalThis.__odmSrdCatalogs = {
    db,
    monsters: make(read(`SELECT name, slug, cr, type, json_extract(data_json, '$.size') AS size FROM monsters WHERE document_slug = ? ORDER BY name`)),
    // Magic items, and the SRD's weapons and armor: a book's longsword or
    // chain mail is the SRD's, not homebrew.
    // (The pack's armor rows also hold ways to have an Armor Class, which
    // are no one's treasure.)
    items: make(
      read(
        `SELECT name, slug, kind, substr(json_extract(data_json, '$.desc'), 1, 600) AS desc FROM items WHERE document_slug = ? AND kind IN ('magic_item', 'weapon', 'armor') AND name NOT LIKE 'Unarmored%' AND name NOT IN ('Mage Armor', 'Draconic Resilience') ORDER BY name`,
      ),
    ),
    spells: make(read(`SELECT name, slug FROM spells WHERE document_slug = ? ORDER BY name`)),
  };
  return globalThis.__odmSrdCatalogs;
}

export function srdAvailable(): boolean {
  return catalogs().monsters.entries.length > 0;
}

// Every SRD 5.1 creature, for the review's match step to guess among and
// the GM to search.
export function srdCreatures(): SrdCandidate[] {
  return catalogs().monsters.entries;
}

// A name the review sent back is an SRD 5.1 creature's, exactly.
export function isSrdCreature(name: string): boolean {
  return catalogs().monsters.entries.some((entry) => entry.name === name);
}

export function matchCreature(name: string): SrdHit | null {
  return matchSrdName(name, catalogs().monsters.index);
}

export function matchSpell(name: string): SrdHit | null {
  return matchSrdName(name, catalogs().spells.index);
}

export function matchItem(name: string): SrdHit | null {
  const items = catalogs().items;
  const sure = (hit: SrdHit | null) => (hit && hit.via !== "within" ? hit : null);
  const direct = sure(matchSrdName(name, items.index));
  if (direct) return direct;
  // "Plate Armor" is the SRD's Plate.
  const armor = /^(.+?)\s+armou?r$/i.exec(name.trim());
  const armorHit = armor ? sure(matchSrdName(armor[1], items.index)) : null;
  if (armorHit && armorHit.entry.kind === "armor") return { entry: armorHit.entry, via: "alias" };
  // A named kind of one SRD item: "Potion of Fire Giant Strength".
  const family = itemFamily(name);
  const familyHit = family ? items.index.get(family) : undefined;
  if (familyHit) return { entry: familyHit, via: "family" };
  // "Scroll of Fireball" is a Spell Scroll, when Fireball is an SRD spell
  // ("Scroll of the Ancients" is the book's own).
  const scroll = /^(?:spell\s+)?scroll\s+of\s+(.+)$/i.exec(name.trim());
  const scrollHit = scroll && sure(matchSrdName(scroll[1], catalogs().spells.index)) ? items.index.get("spell scroll") : undefined;
  if (scrollHit) return { entry: scrollHit, via: "family" };
  // "Ring of Protection +1" is the SRD's Ring of Protection, which gives
  // +1; a "+2" one is the book's own. A family ("Wand of the War Mage, +1,
  // +2, or +3") holds every bonus.
  const plain = withoutBonus(name);
  const plainHit = plain ? sure(matchSrdName(plain, items.index)) : null;
  if (plainHit && plainHit.entry.kind === "magic_item") {
    const bonus = /\+([123])/.exec(name)?.[1] ?? "";
    if (/,\s*\+1, \+2, or \+3$/.test(plainHit.entry.name)) return { entry: plainHit.entry, via: "family" };
    if (bonus && new RegExp(`\\+${bonus} bonus`).test(plainHit.entry.desc ?? "")) return { entry: plainHit.entry, via: "alias" };
    return null;
  }
  // "+1 Longsword": a +N weapon, armor or shield of the SRD's own gear.
  const bonus = bonusItem(name, (base) => {
    const hit = sure(matchSrdName(base, items.index));
    if (!hit) return null;
    if (hit.entry.kind === "weapon") return "weapon";
    if (hit.entry.kind === "armor") return /shield/i.test(hit.entry.name) ? "shield" : "armor";
    return null;
  });
  if (!bonus) return null;
  const magic = items.entries.find((entry) =>
    bonus.family === "weapon" ? /^weapon, \+1/i.test(entry.name) : bonus.family === "armor" ? /^armor, \+1/i.test(entry.name) : /^shield, \+1/i.test(entry.name),
  );
  return magic ? { entry: magic, via: "family" } : null;
}

// SRD creatures near a challenge rating, for the model to choose from when
// a book's creature has no SRD name of its own: the closest by CR first,
// the same type first among those.
export function creatureCandidates(cr: number | null, type: string, limit = 60): SrdCandidate[] {
  const all = catalogs().monsters.entries;
  // Of unknown power: the SRD's creatures of up to CR 5, the ones an
  // adventure's fights are mostly made of.
  if (cr === null) return all.filter((entry) => (entry.cr ?? 0) <= 5).slice(0, limit);
  // Within reach of its challenge (a third either way, at least one step,
  // half a step below CR 1), its own type first; topped up with the
  // nearest when few are. Half again was wide enough to put a CR 7
  // creature in a CR 10 golem's body.
  const reach = Math.max(cr < 1 ? 0.5 : 1, cr / 3);
  const near = all
    .filter((entry) => Math.abs((entry.cr ?? 0) - cr) <= reach)
    .sort((a, b) => Number(b.type === type) - Number(a.type === type) || Math.abs((a.cr ?? 0) - cr) - Math.abs((b.cr ?? 0) - cr));
  if (near.length >= 10) return near.slice(0, limit);
  const rest = all.filter((entry) => !near.includes(entry)).sort((a, b) => Math.abs((a.cr ?? 0) - cr) - Math.abs((b.cr ?? 0) - cr));
  return [...near, ...rest].slice(0, limit);
}

