// What every face the server paints is drawn from, in the words an image
// model reads (issue 569). Each painter used to build its own prompt and each
// dropped something the record held: a companion's gender and appearance, an
// NPC's gender and role, a homebrew race's name, a dragonborn's colour. One
// builder per kind of subject, fed by callers that turn ids into words, so a
// field one painter reads every painter reads.
//
// Pure, so scripts/test-portrait-prompt.mjs reads the words without a render.

const FRAME = "Tabletop RPG character portrait, head and shoulders, centered, looking at viewer";
const FINISH = "Detailed digital painting, dramatic lighting, plain dark background";

// A character with a sheet: a player's, one in the library, a companion.
// Every field is words, never an id ("Marsh Folk", not "homebrew:<id>").
export type CharacterLook = {
  gender: string;
  race: string;
  // A dragonborn's dragon ("gold"), painted as the colour of their scales.
  ancestry?: string;
  className: string;
  background: string;
  // What they look like, as the builder's Appearance field says it. A
  // companion the GM wrote has none and is painted from their personality.
  appearance: string;
  backstory: string;
};

// Deterministic, and genre-neutral unless the caller passes the campaign's
// portrait style: classes span all six genre catalogs.
export function characterPortraitPrompt(look: CharacterLook, style = ""): string {
  const race = look.ancestry && look.race ? `${look.ancestry}-scaled ${look.race}` : look.race;
  const identity = [look.gender, race, look.className].filter(Boolean).join(" ");
  return [
    FRAME,
    identity,
    style,
    look.background ? `${look.background} background` : "",
    look.appearance,
    look.backstory.slice(0, 200),
    FINISH,
  ]
    .filter(Boolean)
    .join(". ");
}

// Who an NPC is at a glance: their gender, their people and what they do
// ("Female Wood Elf Merchant"). The name stays out: a render is not improved
// by a proper noun the model has never seen. The people rides because the
// placeholder an elf draws is an elf's, and a painted face replaces it.
export function npcIdentity(npc: { gender: string; race?: string; role: string }): string {
  return [npc.gender, npc.race?.trim(), npc.role.trim()].filter(Boolean).join(" ");
}

export type NpcLook = {
  gender: string;
  // Their people in words ("Wood Elf", src/lib/npc-race.ts raceWords).
  race?: string;
  // The role's label ("Merchant"), or the text the author typed.
  role: string;
  // Their distinguishing trait, in English.
  trait: string;
  // The engine's own English adjectives (describePersonality).
  personality: string;
};

export function npcPortraitPrompt(npc: NpcLook, style = ""): string {
  return [FRAME, npcIdentity(npc), style, npc.trait, npc.personality, FINISH].filter(Boolean).join(". ");
}

// An id as words ("hill_dwarf" is "hill dwarf"). A homebrew or workshop id
// ("homebrew:<id>", "homebrew-<id>") says nothing a reader can use, so it is
// "" when its name could not be found.
export function idWords(id: string): string {
  const value = id.trim();
  if (/^homebrew[:-]/.test(value)) {
    return "";
  }
  return value.replace(/[-_]/g, " ").trim();
}
