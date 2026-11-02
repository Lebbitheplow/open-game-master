// An NPC's or an enemy's race: one of the SRD race ids the character builder
// uses ("hill_dwarf", "half_orc"), or "" while nobody has recorded one. A
// fixed id rather than free text so the stand-in face reads it the same way
// for a character and an NPC (src/lib/placeholders.ts): without a race the
// enemy NPC plates painted per race (enemy-npc/, PR 710) are never drawn.
// Pure, so the NPC form and the forge import it.
import racesJson from "@/lib/srd/races.json";
import { compareNames, textKey } from "@/lib/language/text-logic";

const RACES = (racesJson.races as Array<{ id: string; name: string }>).map((race) => ({ id: race.id, name: race.name }));
const RACE_IDS = new Set(RACES.map((race) => race.id));

// The plain word for a people with subraces in the SRD list, onto the
// subrace the builder lists first. Every subrace of one people draws the
// same face, so the choice only decides which id is stored.
const BASE_WORDS: Record<string, string> = {
  elf: "high_elf",
  dwarf: "hill_dwarf",
  halfling: "lightfoot_halfling",
  gnome: "rock_gnome",
};

// An id, a name or a word as the id's spelling: "Half-Orc" and "half orc"
// are half_orc, "Elf (Wood)" is elf_wood.
function key(raw: string): string {
  return textKey(raw).split(" ").join("_");
}

// "Elf (Wood)" and "Wood Elf" are the same people written two ways.
const BY_NAME = new Map<string, string>(
  RACES.flatMap((race) => {
    const named = key(race.name);
    const sub = /^(.+?)\s*\((.+)\)$/.exec(race.name);
    return [[named, race.id] as const, ...(sub ? [[key(`${sub[2]} ${sub[1]}`), race.id] as const] : [])];
  }),
);

// A race as told (an id, a name, a plain word in any case) as the stored id,
// or "" when it is blank, "Unknown" or not one of the SRD races. Never a
// guess: a people the list does not have is not recorded as a near one.
export function storedRace(raw: unknown): string {
  const told = typeof raw === "string" ? key(raw) : "";
  if (told === "unknown") {
    return "";
  }
  // A people named for a band of them ("elves", "half-orcs", "wood elves")
  // reads as one of them: the console's fight line says "bandit race elves".
  for (const form of [told, told.replace(/ves$/, "f"), told.replace(/s$/, "")]) {
    const read = RACE_IDS.has(form) ? form : (BASE_WORDS[form] ?? BY_NAME.get(form));
    if (form && read) {
      return read;
    }
  }
  return "";
}

// Whether a race was told that storedRace could not read: not blank, not
// "Unknown", and none of the SRD races. The DM's tool says so rather than
// recording nothing in silence.
export function unreadRace(raw: unknown): boolean {
  const told = typeof raw === "string" ? key(raw) : "";
  return Boolean(told) && told !== "unknown" && !storedRace(raw);
}

// A stored id as an image model or the narrator reads it: "Wood Elf" for
// wood_elf (its name "Elf (Wood)" turned around), "" for none.
export function raceWords(id: string | null | undefined): string {
  const name = RACES.find((race) => race.id === id)?.name ?? "";
  const sub = /^(.+?)\s*\((.+)\)$/.exec(name);
  return sub ? `${sub[2]} ${sub[1]}` : name;
}

// The NPC form's choices, sorted by name as the builder sorts them.
export const NPC_RACE_OPTIONS = RACES.map((race) => ({ value: race.id, label: race.name })).sort((a, b) => compareNames(a.label, b.label));

export const TOLD_RACE_HELP = "Their people (elf, dwarf...), which picks their face.";
