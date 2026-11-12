// "Fill what's left" for a feat-shaped grant: a feat the player took, or a
// subclass's training. Every pick the grant leaves open, made from the
// grant's own lists, counted as the save counts them, so the fill ends where
// the gate passes (scripts/test-quick-build.mjs):
//
//   - training (languages, skills, expertise, tools, weapons): each kind's own
//     count plus what is left of a shared pick ("three skills or tools"),
//     from pickSlots, the counter feat-grants.ts applies. Counting a shared
//     pick by hand left College of the Cat's weapon unmade.
//   - a damage type (Elemental Adept).
//   - the spells it teaches (Magic Initiate, Ritual Caster, Fey Touched, Spell
//     Sniper): a class list and a casting ability where it leaves them open,
//     then the cantrips and spells, on that list, of the level, school, ritual
//     tag and attack the text asks for (feat-spells.ts featSpellsOwed). The
//     maintainer's decision R12 (2026-11-09 wave 1): "Fill what's left" fills
//     a feat's taught spells and damage types too; it left them to the player
//     before.
//
// quickBuild.ts fillRound calls this for every grant it fills; nothing else
// makes these picks for the player. Pure.
import { ALL_SKILLS, STANDARD_LANGUAGES } from "@/lib/content/mechanics";
import { textKey } from "@/lib/language/text-logic";
import type { Ability } from "@/lib/schemas/sheet";
import { preferredSpellOrder } from "@/lib/srd/companion-build";
import { KNOWN_TOOLS } from "@/lib/srd/feat-grant-text";
import { pickSlots, type FeatGrantSpec, type FeatPicks, type PickKind } from "@/lib/srd/feat-grants";

type ListKind = "languages" | "skills" | "expertise" | "weapons" | "tools" | "armor" | "cantrips" | "spells";
import { listAbility, type CastingAbility } from "@/lib/srd/feat-spells";
import spellManifest from "@/lib/srd/manifest/spells.json";
import { SRD_WEAPONS } from "@/lib/srd/weapons";

export type HeldTraining = {
  skills: Set<string>;
  languages: Set<string>;
  tools: Set<string>;
  weapons: Set<string>;
  // Cantrips and spells the character already has, by textKey: a feat's
  // spell is a new one.
  spells: Set<string>;
};

export type FeatFillFacts = {
  // The skills a pick may take, best first, none already held.
  skillOrder: (held: ReadonlySet<string>, from: readonly string[]) => string[];
  // The final scores, for a casting ability the feat leaves open.
  abilities?: Partial<Record<Ability, number>> | null;
  // The class's own spell list, where a feat lets the player choose one.
  classList?: string | null;
};

const has = (list: readonly string[], name: string) => list.some((entry) => textKey(entry) === textKey(name));

// The weapons a grant that picks them may take, best first: one not yet
// trained with before one that is, a martial weapon before a simple one,
// and for a pick of two (a kensei's) a ranged weapon second, as Path of the
// Kensei asks one of each.
function weaponOrder(from: readonly string[], held: ReadonlySet<string>): string[] {
  const rows = from.map((name) => SRD_WEAPONS.find((weapon) => textKey(weapon.name) === textKey(name)) ?? { name, category: "simple", kind: "melee" });
  const score = (row: { name: string; category: string }) =>
    (held.has(textKey(row.name)) || held.has(textKey(row.category)) ? 2 : 0) + (row.category === "martial" ? 0 : 1);
  const ranked = rows.map((row, index) => ({ row, index })).sort((a, b) => score(a.row) - score(b.row) || a.index - b.index).map((entry) => entry.row);
  const melee = ranked.filter((row) => row.kind !== "ranged");
  const ranged = ranked.filter((row) => row.kind === "ranged");
  return [...new Set([...melee.slice(0, 1), ...ranged.slice(0, 1), ...ranked].map((row) => row.name))];
}

// The SRD 5.1 cantrips that make a spell attack roll, for a feat that asks
// for an attack cantrip (Spell Sniper): the card filters the same way.
const ATTACK_CANTRIPS = new Set(["chill touch", "eldritch blast", "fire bolt", "produce flame", "ray of frost", "shocking grasp"]);

type ManifestSpell = { n: string; l: number; s?: string; c?: string; r?: boolean; missing?: boolean };
const SPELLS = (spellManifest as { spells: ManifestSpell[] }).spells.filter((spell) => !spell.missing);

// The spells a feat's pick may be, best first.
function spellCandidates(
  lists: readonly string[],
  level: number,
  rules: { schools: readonly string[]; ritual: boolean; attack: boolean },
): string[] {
  const wanted = new Set(lists.map(textKey));
  const rows = SPELLS.filter(
    (spell) =>
      spell.l === level &&
      (!wanted.size || (spell.c ?? "").split(",").some((entry) => wanted.has(textKey(entry)))) &&
      (!rules.schools.length || rules.schools.includes(textKey(spell.s ?? ""))) &&
      (!rules.ritual || spell.r === true) &&
      (!rules.attack || ATTACK_CANTRIPS.has(textKey(spell.n))),
  );
  return preferredSpellOrder(rows.map((spell) => ({ name: spell.n }))).map((spell) => spell.name);
}

// The damage type a fill names for Elemental Adept: fire, the commonest
// among the spells a caster takes, where the feat offers it.
const DAMAGE_ORDER = ["fire", "cold", "lightning", "acid", "thunder"];

export function fillFeatPicks(spec: FeatGrantSpec, picks: FeatPicks | undefined, facts: FeatFillFacts, held: HeldTraining): FeatPicks | null {
  const out: FeatPicks = { ...picks };
  let changed = false;
  const top = (kind: ListKind, count: number, candidates: string[]) => {
    const have = (out[kind] ?? []).filter(Boolean);
    const room = count - have.length;
    if (room <= 0) return;
    const add = candidates.filter((entry) => !has(have, entry)).slice(0, room);
    if (add.length) {
      out[kind] = [...have, ...add];
      changed = true;
    }
  };
  // Each kind's slots as the save counts them, read again after each kind is
  // filled so a shared pick is spent once (skills first, as the card lists).
  const slots = (kind: PickKind) => pickSlots(spec, out, kind);
  // From the grant's own list where it names one, as the save checks: an
  // Order cleric's fill took History for a pick of Intimidation or
  // Persuasion, and the save then refused the build.
  const skillsFrom = spec.skillsFrom.length ? spec.skillsFrom : ALL_SKILLS;
  top("skills", slots("skills"), facts.skillOrder(held.skills, skillsFrom));
  for (const skill of out.skills ?? []) held.skills.add(skill);
  top("languages", slots("languages"), STANDARD_LANGUAGES.filter((language) => !held.languages.has(textKey(language))));
  // Held from here on, so the next grant picks another: a ranger's three
  // Favored Enemy languages were all the same one.
  for (const language of out.languages ?? []) held.languages.add(textKey(language));
  top("expertise", spec.expertise, [...held.skills]);
  // A tool or weapon pick with no list of its own takes any (feat-grants.ts
  // allows any): left blank, the fill ended with the pick still owed.
  top("tools", slots("tools"), (spec.toolsFrom.length ? spec.toolsFrom : KNOWN_TOOLS).filter((tool) => !held.tools.has(textKey(tool))));
  for (const tool of out.tools ?? []) held.tools.add(textKey(tool));
  const weapons = spec.weaponsFrom.length ? spec.weaponsFrom : SRD_WEAPONS.filter((weapon) => weapon.category === "simple" || weapon.category === "martial").map((weapon) => weapon.name);
  top("weapons", slots("weapons"), weaponOrder(weapons, held.weapons));
  for (const weapon of out.weapons ?? []) held.weapons.add(textKey(weapon));
  top("armor", slots("armor"), spec.armorFrom);

  if (spec.damageTypes.length && !(out.damageType ?? "").trim()) {
    out.damageType = DAMAGE_ORDER.find((type) => spec.damageTypes.includes(type)) ?? spec.damageTypes[0];
    changed = true;
  }

  const taught = spec.taught;
  if (taught.cantrips + taught.spells > 0) {
    const score = (ability: CastingAbility) => facts.abilities?.[ability] ?? 10;
    if (taught.listChoice && !(out.list ?? "").trim() && taught.lists.length) {
      const own = facts.classList ? taught.lists.find((list) => textKey(list) === textKey(facts.classList ?? "")) : undefined;
      // The class's own list where the feat offers it, else the one whose
      // casting score is highest.
      out.list = own ?? [...taught.lists].sort((a, b) => score(listAbility(b)) - score(listAbility(a)))[0];
      changed = true;
    }
    if (taught.ability === "choice" && !out.ability) {
      out.ability = (["int", "wis", "cha"] as const).reduce((best, ability) => (score(ability) > score(best) ? ability : best), "int" as CastingAbility);
      changed = true;
    }
    const lists = taught.listChoice ? (out.list ? [out.list] : []) : taught.lists;
    if (!taught.listChoice || lists.length) {
      const fresh = (names: string[]) => names.filter((name) => !held.spells.has(textKey(name)));
      top("cantrips", taught.cantrips, fresh(spellCandidates(lists, 0, { schools: [], ritual: false, attack: taught.attackCantrip })));
      top("spells", taught.spells, fresh(spellCandidates(lists, taught.spellLevel, { schools: taught.schools, ritual: taught.ritualBook, attack: false })));
      for (const name of [...(out.cantrips ?? []), ...(out.spells ?? [])]) held.spells.add(textKey(name));
    }
  }
  return changed ? out : null;
}
