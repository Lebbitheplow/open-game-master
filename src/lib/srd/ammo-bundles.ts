// Ammunition sold by the bundle and carried by the round.
//
// SRD 5.1, Adventuring Gear, prices ammunition in bundles: "Arrows (20) 1 gp",
// "Blowgun needles (50) 1 gp", "Crossbow bolts (20) 1 gp", "Sling bullets
// (20) 4 cp". A pack counts it by the round: the starting kits give "Arrows"
// x20, a shot spends one, and src/lib/srd/ammunition.ts ammoCount reads a
// line written "Arrows (20)" as twenty only while its qty is 1. A bundle
// bought twice merged into "Arrows (20)" x2 and was counted as two arrows,
// so a bundle that enters a pack becomes its rounds here, under the name
// without its count.
//
// Relative imports only: src/lib/dm/mutation-math.ts imports this and stays
// runnable by plain node (scripts/test-mutations.mjs).
import { textKey } from "../language/text-logic.ts";

// The SRD's bundles, by the words a line names them with. Firearm bullets are
// not among them: the SRD sells none, and a "Bullets (10)" keeps its own
// reading.
const BUNDLES = [
  { names: ["arrows", "arrow"], count: 20, costCp: 100 },
  { names: ["blowgun needles", "blowgun needle", "needles"], count: 50, costCp: 100 },
  { names: ["crossbow bolts", "crossbow bolt", "bolts"], count: 20, costCp: 100 },
  { names: ["sling bullets", "sling bullet"], count: 20, costCp: 4 },
] as const;

const COUNT = /\s*\((\d{1,4})\)\s*$/;

// The SRD bundle a name is, its words without a count ("Arrows (20)" and
// "Arrows" alike), or null.
function bundleNamed(name: string | undefined): (typeof BUNDLES)[number] | null {
  const bare = textKey((name ?? "").replace(COUNT, ""));
  return bare ? (BUNDLES.find((bundle) => (bundle.names as readonly string[]).includes(bare)) ?? null) : null;
}

// What one round of an SRD bundle's ammunition is worth, in copper (a
// fraction for sling bullets, 4 cp the twenty), by the line's name or the
// row it is listed as; null for anything else.
export function roundPriceCp(item: { name: string; srdName?: string }): number | null {
  const bundle = bundleNamed(item.srdName) ?? bundleNamed(item.name);
  return bundle ? bundle.costCp / bundle.count : null;
}

// The count a bundle line names ("Arrows (20)": 20), or null. Only an SRD
// bundle's words count: "Gems (3)" is no bundle.
export function bundleCount(name: string | undefined): number | null {
  const counted = COUNT.exec(name ?? "");
  return counted && bundleNamed(name) ? Number(counted[1]) : null;
}

type Line = { name: string; qty: number; srdName?: string };

// A line of `qty` bundles as rounds: "Arrows (20)" x2 is "Arrows" x40. The
// count is the name's, else the row's (a "Quiver of arrows" listed as
// "Arrows (20)"); the row loses its count too, and goes when it only repeats
// the name. Anything that is no bundle comes back as it was.
export function bundlesAsRounds<T extends Line>(line: T, bundles: number): T {
  const count = bundleCount(line.name) ?? bundleCount(line.srdName);
  if (count === null) {
    return line;
  }
  const name = line.name.replace(COUNT, "").trim() || line.name;
  const srdName = line.srdName?.replace(COUNT, "").trim();
  const { srdName: _old, ...rest } = line;
  void _old;
  return {
    ...rest,
    name,
    qty: Math.max(1, Math.floor(bundles)) * count,
    ...(srdName && textKey(srdName) !== textKey(name) ? { srdName } : {}),
  } as T;
}

// `qty` of a carried line as rounds, read as a shot reads the line (by its
// name, ammunition.ts ammoCount): one "Arrows (20)" is twenty, while a line
// the shots rewrote ("Arrows (15)" x15) already counts a round in each qty.
export function carriedAsRounds<T extends Line>(line: T, qty: number): T {
  if (bundleCount(line.name) === null) {
    return { ...line, qty: Math.max(1, Math.floor(qty)) };
  }
  return line.qty <= 1 ? bundlesAsRounds(line, qty) : { ...bundlesAsRounds(line, 1), qty: Math.max(1, Math.floor(qty)) };
}
