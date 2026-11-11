// The infusions an artificer knows, as the Infuse Item door and the Hand's
// card read them (src/lib/dm/infuse-item.ts, src/lib/battlemap/hand-spells.ts).
// Pure: the Hand runs in the browser.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { infusionNamed, replicableAt, RESISTANT_TYPES, type InfusionDef } from "@/lib/srd/infusions";
import { chosenOptions } from "@/lib/srd/options";
import { classLevelOf } from "@/lib/srd/trait-rules";

export const INFUSE_COUNTER = "art_infuse_item";

// The infusions an artificer knows and their level allows, by option name.
export function knownInfusions(sheet: Pick<CharacterSheet, "features" | "class" | "level" | "classes">): InfusionDef[] {
  const level = classLevelOf(sheet, "artificer");
  return chosenOptions(sheet.features ?? [], "infusion").flatMap((name) => {
    const def = infusionNamed(name);
    return def && level >= def.level ? [def] : [];
  });
}

// The picks the Hand's card offers: each infusion known, with its choice
// spelled after a colon where it asks one ("Resistant Armor: fire").
export function infusionPicks(sheet: Pick<CharacterSheet, "features" | "class" | "level" | "classes">): string[] {
  const level = classLevelOf(sheet, "artificer");
  return knownInfusions(sheet).flatMap((def) =>
    def.choose === "damage_type"
      ? RESISTANT_TYPES.map((type) => `${def.name}: ${type}`)
      : def.choose === "magic_item"
        ? replicableAt(level).map((item) => `${def.name}: ${item}`)
        : [def.name],
  );
}
