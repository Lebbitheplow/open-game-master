// What a person's adjudication leaves in the chronicle (issue 713).
//
// At a table the AI runs, the rolls a turn makes ride on the narration the
// turn writes when it ends (src/lib/dm/turn.ts places a "[roll:<id>]" marker
// for each), and that narration tells the table what they did. A turn a
// person opens (src/lib/dm/invoke.ts) has no narration step: it closed with
// nothing written, so at a test fight its author ran, the Hand's card rolls,
// the kills and the GM console's damage and healing reached the table only
// as toasts. Each adjudication a person makes now leaves one table note: its
// rolls, which the chronicle draws as roll cards (the note's rollIds, never
// markers in its words, which an app built before the field reads as plain
// text), and a sentence that stands alone: who rolled what, and what changed
// on the heroes and the foes. A roll behind the screen stays off it
// (src/lib/dm/persons-record.ts), and no number of a foe's goes in: a foe is
// named only when it falls or runs, and no total is written out.
//
// Pure, for scripts/test-persons-record.mjs.

export type HeroChange = {
  name: string;
  damage: number;
  healed: number;
  hp: number;
  // At 0 hit points after the blow: still dying, stable, or dead.
  down: "dying" | "stable" | "dead" | null;
};

export type FoeChange = { name: string; status: "dead" | "fled" };

type AuditLike = { characterId: string; kind: string; delta: Record<string, unknown> };
type SheetLike = {
  name: string;
  currentHp: number;
  deathSaves?: { stable: boolean; dead: boolean } | null;
};

function amount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

// The damage and healing each hero took in the call, from the sheet audit
// the call wrote, read against the sheet as it now stands. A blow to a beast
// form is the form's (its own hit points, not the hero's), so it is left to
// the roll card.
export function heroChanges(entries: readonly AuditLike[], sheets: ReadonlyMap<string, SheetLike>): HeroChange[] {
  const byHero = new Map<string, { damage: number; healed: number }>();
  for (const entry of entries) {
    const damage = entry.kind === "apply_damage" && !entry.delta.form ? amount(entry.delta.amount) : 0;
    const healed = entry.kind === "heal" && !entry.delta.form ? amount(entry.delta.amount) : 0;
    if (!damage && !healed) {
      continue;
    }
    const sum = byHero.get(entry.characterId) ?? { damage: 0, healed: 0 };
    sum.damage += damage;
    sum.healed += healed;
    byHero.set(entry.characterId, sum);
  }
  const changes: HeroChange[] = [];
  for (const [id, sum] of byHero) {
    const sheet = sheets.get(id);
    if (!sheet) {
      continue;
    }
    const track = sheet.deathSaves ?? null;
    const down = sheet.currentHp > 0 ? null : track?.dead ? "dead" : track?.stable ? "stable" : "dying";
    changes.push({ name: sheet.name, damage: sum.damage, healed: sum.healed, hp: sheet.currentHp, down });
  }
  return changes;
}

function names(list: readonly string[]): string {
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : (list[0] ?? "");
}

function heroSentence(hero: HeroChange): string {
  if (hero.damage && hero.healed) {
    return `${hero.name} takes ${hero.damage} damage and regains ${hero.healed} hit points (${hero.hp} HP).`;
  }
  if (hero.healed) {
    return `${hero.name} regains ${hero.healed} hit points (${hero.hp} HP).`;
  }
  // A death the engine already announces (killed outright, died of wounds)
  // is its own line; this one says only the blow.
  if (hero.down === "dying") {
    return `${hero.name} takes ${hero.damage} damage and drops to 0 hit points, dying.`;
  }
  if (hero.down === "stable") {
    return `${hero.name} takes ${hero.damage} damage and is knocked out, stable at 0 hit points.`;
  }
  return `${hero.name} takes ${hero.damage} damage (${hero.hp} HP).`;
}

// One sentence per hero, then the foes who fell or ran, or null when the
// call changed none of it.
export function changesLine(heroes: readonly HeroChange[], foes: readonly FoeChange[]): string | null {
  const parts = heroes.map(heroSentence);
  const fallen = foes.filter((foe) => foe.status === "dead").map((foe) => foe.name);
  const fled = foes.filter((foe) => foe.status === "fled").map((foe) => foe.name);
  if (fallen.length) {
    parts.push(`${names(fallen)} ${fallen.length > 1 ? "fall" : "falls"}.`);
  }
  if (fled.length) {
    parts.push(`${names(fled)} ${fled.length > 1 ? "flee" : "flees"}.`);
  }
  return parts.length ? parts.join(" ") : null;
}

// A roll as the note words it: who rolled, the kind, and the detail the
// engine stored (the same words its card shows), without its total.
export type RollWords = { id: string; kind: string; detail: string; who: string };

const ROLLED: Record<string, string> = {
  attack: "to hit",
  damage: "damage",
  skill_check: "a check",
  ability_check: "a check",
  saving_throw: "a saving throw",
  initiative: "initiative",
};

// "Rowan rolls to hit and damage (Longsword vs Goblin 1). Goblin 1 rolls
// initiative." One sentence for each run of rolls by one roller about one
// thing, in the order they were rolled.
export function rollsSentence(rolls: readonly RollWords[]): string | null {
  const runs: Array<{ who: string; detail: string; kinds: string[] }> = [];
  for (const roll of rolls) {
    // Initiative's detail is the word itself.
    const detail = roll.kind === "initiative" ? "" : roll.detail.replaceAll("_", " ").trim();
    const kind = ROLLED[roll.kind] ?? "dice";
    const last = runs.at(-1);
    if (last && last.who === roll.who && last.detail === detail) {
      if (!last.kinds.includes(kind)) last.kinds.push(kind);
      continue;
    }
    runs.push({ who: roll.who, detail, kinds: [kind] });
  }
  return runs.length
    ? runs.map((run) => `${run.who} rolls ${names(run.kinds)}${run.detail ? ` (${run.detail})` : ""}.`).join(" ")
    : null;
}

export type RecordGlyph = "die-d20" | "cue-battle" | "cue-death" | "cue-heal";

// The note: its words, its icon and the rolls it carries. Null when the call
// rolled nothing and changed nothing. The words are never empty, so a screen
// that draws only them still reads what happened.
export function personsRecord(
  rolls: readonly RollWords[],
  heroes: readonly HeroChange[],
  foes: readonly FoeChange[],
): { content: string; glyph: RecordGlyph; rollIds: string[] } | null {
  const content = [rollsSentence(rolls), changesLine(heroes, foes)].filter((part): part is string => Boolean(part)).join(" ");
  if (!content) {
    return null;
  }
  const glyph: RecordGlyph = heroes.some((hero) => hero.down)
    ? "cue-death"
    : foes.length || heroes.some((hero) => hero.damage)
      ? "cue-battle"
      : heroes.length
        ? "cue-heal"
        : "die-d20";
  return { content, glyph, rollIds: rolls.map((roll) => roll.id) };
}
