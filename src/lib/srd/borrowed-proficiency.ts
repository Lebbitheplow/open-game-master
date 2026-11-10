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

const SKILLS = (skillsJson.skills as Array<{ id: string; name: string }>).map((skill) => ({ id: skill.id, key: textKey(skill.name) }));

// SRD 5.1, Equipment, Tools: the kits beside the artisan's tools,
// instruments and gaming sets.
const KITS = ["disguise kit", "forgery kit", "herbalism kit", "navigator's tools", "poisoner's kit", "thieves' tools"];

// What can be chosen: every skill by its id, and every tool by its name.
export const BORROWABLE = [...SKILLS.map((skill) => skill.id), ...KITS, ...ARTISANS_TOOLS, ...MUSICAL_INSTRUMENTS, ...GAMING_SETS];

const conditionFor = (choice: string) => `${BORROWED_MARK} (${choice})`;

// The row's variants: each choice and the condition it lays.
export const BORROWED_VARIANTS: Record<string, string> = Object.fromEntries(BORROWABLE.map((choice) => [choice, conditionFor(choice)]));

// The skills (by id) and tools (by name) the worn conditions lend.
export function borrowedProficiencies(conditions: readonly string[] | undefined): { skills: string[]; tools: string[] } {
  const skills: string[] = [];
  const tools: string[] = [];
  for (const entry of conditions ?? []) {
    const lent = isConditionNamed(entry, BORROWED_MARK) ? nameChoice(entry) : null;
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
