// The post-apocalyptic classes' features that are read from the sheet alone
// (src/lib/classes/post-apocalyptic-features.json; WAVE2 D5), for the pure
// engines: the rest, the checks, the weapon tables.
//
// Pure: no database.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { frameSpeedWhole } from "@/lib/srd/genre-b-steampunk-moves";
import { ADAPTED } from "@/lib/srd/genre-b-post-apocalyptic-conditions";

type Uses = Record<string, { max: number; used: number }>;

const CALL_THE_WILD = "post_apocalyptic_call_the_wild";
const THE_PACK_PROVIDES = "post_apocalyptic_the_pack_provides";

// The Pack Provides: "Call the Wild ... recharges on a short rest 1/day". A
// short rest gives a spent Call the Wild back and spends The Pack Provides'
// own counter, which a long rest restores (the day). Returns the counters
// after it, or null when nothing changes (src/lib/dm/rest-logic.ts
// shortRestResourcePatch lays it over the rest's own refill).
export function packProvides(sheet: Pick<CharacterSheet, "class" | "features"> & Partial<Pick<CharacterSheet, "classes">>, resources: Uses | undefined): Uses | null {
  const call = resources?.[CALL_THE_WILD];
  const day = resources?.[THE_PACK_PROVIDES];
  if (!resources || !call || !day || call.used <= 0 || day.used >= day.max || !holdsGenreFeature(sheet, "packmaster", "The Pack Provides")) {
    return null;
  }
  return { ...resources, [CALL_THE_WILD]: { ...call, used: 0 }, [THE_PACK_PROVIDES]: { ...day, used: day.used + 1 } };
}

type Holder = Pick<CharacterSheet, "class" | "features"> & Partial<Pick<CharacterSheet, "classes">>;

// Second Adaptation: "a climb or swim speed for an hour", by the condition its
// spend lays ("adapted (climb)", "adapted (swim)"). The board's walk reads it
// (src/lib/battlemap/passage.ts pcMoveTraits): a climbing surface or water
// costs no extra movement.
export function adaptedSpeeds(conditions: readonly string[] | undefined): { climb: boolean; swim: boolean } {
  const held = (conditions ?? []).filter((entry) => isConditionNamed(entry, ADAPTED));
  return { climb: held.some((entry) => isConditionNamed(entry, `${ADAPTED} (climb)`)), swim: held.some((entry) => isConditionNamed(entry, `${ADAPTED} (swim)`)) };
}

// Unstoppable: "Your speed cannot be reduced ... while conscious". What slows a
// creature (Slow's half, Ray of Frost's ten feet, two levels of exhaustion)
// leaves a conscious road warrior's speed whole; what quickens it still does. A
// grapple or a restraint holds them where they are: that speed is 0 because
// they are held, which the text's own next clause (prone) shows it lists apart.
export function speedCannotBeReduced(sheet: Holder & Pick<CharacterSheet, "currentHp">): boolean {
  // Juggernaut Frame (steam knight 14): "Your speed cannot be reduced"
  // (src/lib/srd/genre-b-steampunk-moves.ts).
  return sheet.currentHp > 0 && (holdsGenreFeature(sheet, "road_warrior", "Unstoppable") || frameSpeedWhole(sheet));
}

// Packrat: "Carry capacity doubles" (src/lib/srd/encumbrance.ts encumbranceFor).
export function carryDoubled(wearer: { class?: string; features?: Array<{ name: string }>; classes?: Array<{ id: string }> } | undefined): boolean {
  return Boolean(wearer?.class && wearer.features && holdsGenreFeature({ class: wearer.class, features: wearer.features, classes: wearer.classes } as Holder, "scavenger", "Packrat"));
}
