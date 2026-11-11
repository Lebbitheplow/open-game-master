// The spells a monk casts with ki (wave 2, part mr). "Spend 2 ki to cast
// darkness, darkvision, pass without trace or silence, and you know minor
// illusion" (Shadow Arts), and the elemental disciplines that cast a spell
// ("Spend 3 ki to cast hold person"), whose "spell save DC and attacks use
// your ki save DC" (Disciple of the Elements).
//
// They were narrated ("the cast tools with the ki spent by use_resource"): a
// monk keeps no spell list, so the cast guard refused the spell, and the ki
// was a second call nobody had to make. Each row here is a grant the cast
// guard reads (src/lib/srd/granted-casts.ts grantedCastsOf): the spell's own
// tool casts it with no slot and spends the ki, as a counter cast spends its
// counter (src/lib/srd/counter-casts.ts), and Wisdom is its casting ability
// (src/lib/srd/index.ts grantedSpellAbility), so the DC is the ki save DC.
//
// Pure.

import { textKey } from "@/lib/language/text-logic";
import { isNamed } from "@/lib/srd/feature-names";
import { chosenOptions } from "@/lib/srd/options";

export type KiCast = { source: string; spell: string; cost: number; selfOnly?: boolean };

const SHADOW_ARTS = "Shadow Arts";
const SHADOW_ARTS_KI = 2;
const SHADOW_ARTS_SPELLS = ["Darkness", "Darkvision", "Pass without Trace", "Silence"];
export const SHADOW_ARTS_CANTRIP = "Minor Illusion";

// The disciplines that cast a spell, by the option's name
// (src/lib/srd/options.json, kind "discipline": "Spend N ki to cast X";
// scripts/test-enforce-sweep-clauses-martial-monk.mjs holds the two tables
// together). The others (Fangs of the Fire Snake, Water Whip) cast nothing.
export const DISCIPLINE_CASTS: Record<string, { spell: string; cost: number; selfOnly?: boolean }> = {
  "Breath of Winter": { spell: "Cone of Cold", cost: 6 },
  "Clench of the North Wind": { spell: "Hold Person", cost: 3 },
  "Eternal Mountain Defense": { spell: "Stoneskin", cost: 5, selfOnly: true },
  "Fist of Four Thunders": { spell: "Thunderwave", cost: 2 },
  "Flames of the Phoenix": { spell: "Fireball", cost: 4 },
  "Gong of the Summit": { spell: "Shatter", cost: 3 },
  "Mist Stance": { spell: "Gaseous Form", cost: 4, selfOnly: true },
  "Ride the Wind": { spell: "Fly", cost: 4, selfOnly: true },
  "River of Hungry Flame": { spell: "Wall of Fire", cost: 5 },
  "Rush of the Gale Spirits": { spell: "Gust of Wind", cost: 2 },
  "Sweeping Cinder Strike": { spell: "Burning Hands", cost: 2 },
  "Wave of Rolling Earth": { spell: "Wall of Stone", cost: 6 },
};

type Feature = { name: string; source?: string };

// A subclass feature, never a species trait or a background feature that
// shares its name (as counter-casts.ts reads its own).
const NOT_A_SUBCLASS = new Set(["race", "background"]);
const holdsShadowArts = (features: ReadonlyArray<Feature>) => features.some((feature) => !NOT_A_SUBCLASS.has(feature.source ?? "") && isNamed(feature.name, SHADOW_ARTS));

// Every spell the sheet's features cast with ki, and what each costs.
export function kiCastsHeld(features: ReadonlyArray<Feature>): KiCast[] {
  const out: KiCast[] = [];
  if (holdsShadowArts(features)) {
    for (const spell of SHADOW_ARTS_SPELLS) {
      out.push({ source: SHADOW_ARTS, spell, cost: SHADOW_ARTS_KI });
    }
  }
  for (const discipline of chosenOptions([...features], "discipline")) {
    const row = Object.entries(DISCIPLINE_CASTS).find(([name]) => textKey(name) === textKey(discipline));
    if (row) {
      out.push({ source: row[0], spell: row[1].spell, cost: row[1].cost, ...(row[1].selfOnly ? { selfOnly: true } : {}) });
    }
  }
  return out;
}

// Shadow Arts' cantrip, known and cast at will.
export function kiCantripsHeld(features: ReadonlyArray<Feature>): Array<{ source: string; spell: string }> {
  return holdsShadowArts(features) ? [{ source: SHADOW_ARTS, spell: SHADOW_ARTS_CANTRIP }] : [];
}

// Wisdom, for a spell the sheet casts through one of these: "spell save DC
// and attacks use your ki save DC". Null for any other spell.
export function kiCastAbility(features: ReadonlyArray<Feature> | undefined, spell: string): "wis" | null {
  const wanted = textKey(spell);
  const held = features ?? [];
  return [...kiCastsHeld(held), ...kiCantripsHeld(held)].some((cast) => textKey(cast.spell) === wanted) ? "wis" : null;
}
