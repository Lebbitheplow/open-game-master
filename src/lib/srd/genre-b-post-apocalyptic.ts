// The post-apocalyptic classes' features that are read from the sheet alone
// (src/lib/classes/post-apocalyptic-features.json; WAVE2 D5), for the pure
// engines: the rest, the checks, the weapon tables.
//
// Pure: no database.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";

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
