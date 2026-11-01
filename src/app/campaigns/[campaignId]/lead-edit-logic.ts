// The pure half of the lead's Adjust dialog (LeadEditDialog.tsx): what the
// pickers may offer and how an item row keeps everything it stores.
// Database-free and JSX-free so scripts/test-lead-edit.mjs drives it.
import { spellClassFor } from "@/lib/classes";
import { thirdCasterList, thirdCasterProfileOf } from "@/lib/srd/third-caster";
import { EXPERTISE_CAP, type CharacterSheet, type EquipmentItem, type Proficiencies } from "@/lib/schemas/sheet";
import { SRD_SKILLS } from "@/lib/srd";
import { expertiseSlotsFor } from "@/lib/srd/features";
import { findNamed } from "@/lib/language/text-logic";

// The highest spell level this sheet can actually cast, read from the slots
// it has stored: the multiclass table, a third caster's slots and a
// warlock's pact level are all already in there, where the class table of
// the primary class at the total level was wrong for all three (U:UC5).
// Cantrips (level 0) always pass.
export function highestStoredSlot(spellcasting: CharacterSheet["spellcasting"]): number {
  if (!spellcasting) {
    return 0;
  }
  const shared = Object.entries(spellcasting.slots ?? {}).reduce(
    (top, [level, slot]) => (slot.max > 0 ? Math.max(top, Number(level)) : top),
    0,
  );
  const pact = spellcasting.pact && spellcasting.pact.max > 0 ? spellcasting.pact.level : 0;
  return Math.max(shared, pact);
}

// The class list the pickers search: an Eldritch Knight or Arcane Trickster
// learns from the wizard's.
export function spellListOf(sheet: Pick<CharacterSheet, "class" | "subclass" | "spellcasting">): string {
  const profile = thirdCasterProfileOf(sheet.class, sheet.subclass, sheet.spellcasting?.progression);
  return profile ? thirdCasterList(profile) : spellClassFor(sheet.class);
}

// Round and clamp shared slot edits before the Adjust dialog sends them. A
// zero maximum is intentional; only a missing or invalid edit uses the sheet.
export function editedSpellSlots(
  original: NonNullable<CharacterSheet["spellcasting"]>["slots"],
  edits: Record<string, { max: string; used: string }>,
): NonNullable<CharacterSheet["spellcasting"]>["slots"] {
  return Object.fromEntries(
    Object.entries(original).map(([level, slot]) => {
      const edited = edits[level];
      const enteredMax = Number(edited?.max);
      const max = edited?.max?.trim() && Number.isFinite(enteredMax)
        ? Math.max(0, Math.round(enteredMax))
        : slot.max;
      const used = Math.min(max, Math.max(0, Math.round(Number(edited?.used ?? slot.used)) || 0));
      return [level, { max, used }];
    }),
  );
}

// One item row in the dialog. `base` is the stored item whole, so a save
// that only changed a name or a count keeps worn, attuned, identified and
// charges (U:UC1: rows used to be rebuilt from name, qty and slug, and every
// save quietly unequipped the party's armor and dropped their attunements).
export type ItemRow = { name: string; qty: string; base: EquipmentItem };

export function itemRowsOf(equipment: EquipmentItem[]): ItemRow[] {
  return equipment.map((item) => ({ name: item.name, qty: String(item.qty), base: { ...item } }));
}

export function equipmentFrom(rows: ItemRow[]): EquipmentItem[] {
  return rows
    .map((row) => ({
      ...row.base,
      name: row.name.trim(),
      qty: Math.min(999, Math.max(1, Math.round(Number(row.qty)) || 1)),
    }))
    .filter((item) => item.name);
}

// How far a character is trained in a skill, as the Adjust dialog sets it.
export type SkillLevel = "none" | "trained" | "expert";

// Expertise holds this many entries at most (the sheet schema's cap).
export const EXPERTISE_MAX = EXPERTISE_CAP;
// What a host from before that cap was raised holds (0.31.3 and older).
export const OLDER_HOST_EXPERTISE_MAX = 6;

// Why a correction with this much expertise cannot be saved here, in plain
// words, or null when it can. An older host refuses past six with its
// schema's own message ("Too big: expected array to have <=6 items").
export function expertiseOverCap(count: number, hostHoldsMore: boolean): string | null {
  const cap = hostHoldsMore ? EXPERTISE_MAX : OLDER_HOST_EXPERTISE_MAX;
  if (count <= cap) return null;
  return hostHoldsMore
    ? `Expertise holds ${cap} at most; set some back to Trained.`
    : `This server's version holds expertise in ${cap} skills at most; set some back to Trained, or update the server.`;
}

// The expertise a sheet's classes have given by their levels (SRD 5.1: a
// rogue's at 1st and 6th, a bard's at 3rd and 10th, two skills each), for
// the lead correcting a sheet that has the wrong count.
export function earnedExpertise(sheet: Pick<CharacterSheet, "class" | "level" | "classes">): number {
  const classes = sheet.classes?.length ? sheet.classes : [{ id: sheet.class, level: sheet.level }];
  return classes.reduce((sum, entry) => sum + expertiseSlotsFor(entry.id, entry.level), 0);
}

// The skill a stored entry names, by id or by name ("Sleight of Hand",
// "sleight_of_hand"); null for anything else (a rogue's thieves' tools).
function skillOf(entry: string): string | null {
  return findNamed(SRD_SKILLS, entry, (skill) => [skill.id, skill.name])?.id ?? null;
}

// Every skill's level on the sheet, keyed by skill id.
export function skillLevelsOf(proficiencies: Proficiencies): Record<string, SkillLevel> {
  const trained = new Set(proficiencies.skills.map(skillOf));
  const expert = new Set((proficiencies.expertise ?? []).map(skillOf));
  return Object.fromEntries(
    SRD_SKILLS.map((skill) => [skill.id, expert.has(skill.id) && trained.has(skill.id) ? "expert" : trained.has(skill.id) ? "trained" : "none"]),
  );
}

// The training the dialog saves: the saves and skill levels set, and every
// other entry kept as stored (a skill a content pack names, a rogue's
// expertise in thieves' tools, languages, tools, armor and weapons).
export function trainingFrom(
  proficiencies: Proficiencies,
  levels: Record<string, SkillLevel>,
  saves: Proficiencies["saves"],
): Proficiencies {
  const other = (entries: string[]) => entries.filter((entry) => !skillOf(entry));
  const at = (wanted: SkillLevel[]) => SRD_SKILLS.filter((skill) => wanted.includes(levels[skill.id] ?? "none")).map((skill) => skill.id);
  return {
    ...proficiencies,
    saves,
    skills: [...other(proficiencies.skills), ...at(["trained", "expert"])],
    expertise: [...other(proficiencies.expertise ?? []), ...at(["expert"])],
  };
}
