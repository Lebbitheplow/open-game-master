// Which beasts a druid can become (SRD 5.1, Druid: Wild Shape) and the beast
// list the Hand's Wild Shape and Polymorph cards offer, without the whole
// bestiary: src/lib/srd/beast-forms.ts reads srd-creatures.json, too large
// for the client, and keeps the engine's checks; beast-form-index.json is its
// copy of the beasts' names and speeds (scripts/test-counter-repairs.mjs
// fails when the two differ).
//
// Pure.
import index from "@/lib/srd/beast-form-index.json";

// SRD Wild Shape ceilings by druid level (the class table's
// Wild Shape Improvement at 4th and 8th); Circle of the Moon raises the CR
// (1 from 2nd, level/3 from 6th) but not the movement gates.
export function wildShapeCapsFor(
  level: number,
  moonDruid: boolean,
): { maxCr: number; fly: boolean; swim: boolean } {
  const clamped = Math.max(1, Math.min(20, Math.floor(level)));
  const baseCr = clamped >= 8 ? 1 : clamped >= 4 ? 0.5 : 0.25;
  const moonCr = clamped >= 6 ? Math.max(1, Math.floor(clamped / 3)) : 1;
  return {
    maxCr: moonDruid ? Math.max(baseCr, moonCr) : baseCr,
    fly: clamped >= 8,
    swim: clamped >= 4,
  };
}

export type IndexedBeast = { n: string; cr: number; fly?: boolean; swim?: boolean };

export const BEAST_INDEX: IndexedBeast[] = (index as { forms: IndexedBeast[] }).forms;

// The beasts within the caps, lowest challenge rating first.
export function beastsWithin(caps: { maxCr: number; fly: boolean; swim: boolean }): IndexedBeast[] {
  return BEAST_INDEX.filter((beast) => beast.cr <= caps.maxCr && (caps.fly || !beast.fly) && (caps.swim || !beast.swim));
}

export function crWords(cr: number): string {
  return cr === 0.125 ? "1/8" : cr === 0.25 ? "1/4" : cr === 0.5 ? "1/2" : String(cr);
}
