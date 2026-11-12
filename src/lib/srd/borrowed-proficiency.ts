// A proficiency a feature lends for a while, worn as a condition that names
// what it lends: "knowledge of the ages (stealth)" (Channel Divinity:
// Knowledge of the Ages, "Gain proficiency with one skill or tool of your
// choice for 10 minutes"). The skill check (src/lib/srd/index.ts
// computeSheetDerived) and the tool check (src/lib/dm/roll-riders.ts
// toolProficiencyBonus) both read it here, so the lent proficiency counts
// wherever the sheet's own would, and ends with the condition.
//
// Pure: no database.
import { textKey } from "@/lib/language/text-logic";
import { isConditionNamed, nameChoice } from "@/lib/srd/feature-names";
import skillsJson from "@/lib/srd/skills.json";
import { ARTISANS_TOOLS, GAMING_SETS, MUSICAL_INSTRUMENTS } from "@/lib/srd/tool-choices";

export const BORROWED_MARK = "knowledge of the ages";
// A Phantom's Whispers of the Dead: "Whenever you finish a short or long
// rest, you can gain one skill or tool proficiency of your choice ... You
// lose this proficiency when you use this feature to choose a different
// proficiency": the same lent proficiency, kept until the next choice.
export const WHISPERED_MARK = "whispers of the dead";
const MARKS = [BORROWED_MARK, WHISPERED_MARK];

const SKILLS = (skillsJson.skills as Array<{ id: string; name: string }>).map((skill) => ({ id: skill.id, key: textKey(skill.name) }));

// SRD 5.1, Equipment, Tools: the kits beside the artisan's tools,
// instruments and gaming sets.
const KITS = ["disguise kit", "forgery kit", "herbalism kit", "navigator's tools", "poisoner's kit", "thieves' tools"];

// What can be chosen: every skill by its id, and every tool by its name.
export const BORROWABLE = [...SKILLS.map((skill) => skill.id), ...KITS, ...ARTISANS_TOOLS, ...MUSICAL_INSTRUMENTS, ...GAMING_SETS];

// A row's variants: each choice and the condition it lays under `mark`.
export function borrowedVariants(mark: string): Record<string, string> {
  return Object.fromEntries(BORROWABLE.map((choice) => [choice, `${mark} (${choice})`]));
}
export const BORROWED_VARIANTS: Record<string, string> = borrowedVariants(BORROWED_MARK);

// The skills (by id) and tools (by name) the worn conditions lend.
export function borrowedProficiencies(conditions: readonly string[] | undefined): { skills: string[]; tools: string[] } {
  const skills: string[] = [];
  const tools: string[] = [];
  for (const entry of conditions ?? []) {
    const lent = MARKS.some((mark) => isConditionNamed(entry, mark)) ? nameChoice(entry) : null;
    if (!lent) continue;
    const choice = textKey(lent);
    const skill = SKILLS.find((entry) => entry.key === choice || textKey(entry.id) === choice);
    if (skill) {
      skills.push(skill.id);
    } else {
      tools.push(lent);
    }
  }
  return { skills, tools };
}
