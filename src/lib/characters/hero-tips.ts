// The hero page a new character lands on after its first save (backlog F23
// and F26): three things to try on a first turn, and one line that notices
// the build. Every number comes from the helpers the table itself uses: the
// Hand's cards (src/lib/battlemap/hand.ts) for the attack and the spell, the
// resource table for a limited use, computeSheetDerived for the skills, the
// spell DC and the scores. Nothing is invented: a character with no spell
// gets no spell tip, and the reveal line says only what the sheet holds.
// The sentences are the reader's (t-first with the enT default, like the
// Hand's own cards), the skill's and the ability's names following the
// locale through skillLabel and the sheet's own keys. Pure and
// database-free; scripts/test-hero-tips.mjs drives it.
import { carriedWeapons, deriveHand, FRESH_TURN, SAVE_LABEL, type HandCard, type SpellFact } from "@/lib/battlemap/hand";
import type { CharacterSheet, CreateSheetInput } from "@/lib/schemas/sheet";
import { computeSheetDerived, skillLabel, SRD_SKILLS, formatModifier } from "@/lib/srd";
import { populateResources, rechargeOf, resourceDef } from "@/lib/srd/class-resources";
import { ammoKindForWeapon, findAmmo } from "@/lib/srd/ammunition";
import { combatRiders } from "@/lib/srd/feature-effects";
import { weaponAttackProfile } from "@/lib/dm/attack-logic";
import { textKey } from "@/lib/language/text-logic";
import { translate, type Locale } from "@/lib/messages-logic";
import { ABILITIES, type Ability } from "@/lib/schemas/abilities";
import type { IconRef } from "@/lib/icons";
import { cardIcon } from "@/lib/battlemap/spell-glyph-logic";
import { proficiencyBonusOf } from "@/lib/srd/proficiency";
import { pluralOf } from "@/lib/messages-logic";

// The sentences the tips read in, English unless a caller passes the
// reader's own (the t-first idiom with the enT default).
type T = (key: string, vars?: Record<string, string | number>) => string;
const enT: T = (key, vars) => translate("en", key, vars);

// The library row the hero page reads: the sheet as saved, with its level.
export type LibraryHero = {
  id: string;
  name: string;
  level: number;
  sheet: CreateSheetInput;
};

// One tip: the line to read, and the note beside it that explains a limited
// use ("1 use, back after a short rest"), or "" when nothing runs out.
export type HeroTip = {
  kind: "attack" | "spell" | "feature" | "skill";
  text: string;
  note: string;
  // The Hand card's own picture, or the skill's glyph.
  icon: IconRef;
};

// The saved library sheet as a fresh table sheet: full hit points, every
// slot and use in hand, nothing spent. This is the sheet the character
// sits down with, so the Hand's cards read as they will on the first turn.
// A sheet stored before a field existed comes back without it, so every
// list falls back to empty here rather than in each reader.
export function freshPlaySheet(hero: LibraryHero): CharacterSheet {
  const stored = hero.sheet;
  const sheet = {
    ...stored,
    classes: stored.classes ?? [],
    hitDicePools: stored.hitDicePools ?? null,
    equipment: stored.equipment ?? [],
    feats: stored.feats ?? [],
    features: stored.features ?? [],
    speed: stored.speed ?? 30,
    gold: stored.gold ?? 0,
    copper: stored.copper ?? 0,
    spellcasting: stored.spellcasting ?? null,
    portrait: stored.portrait ?? null,
    backstory: stored.backstory ?? "",
    proficiencies: {
      ...stored.proficiencies,
      saves: stored.proficiencies?.saves ?? [],
      skills: stored.proficiencies?.skills ?? [],
      expertise: stored.proficiencies?.expertise ?? [],
      languages: stored.proficiencies?.languages ?? [],
      tools: stored.proficiencies?.tools ?? [],
      armor: stored.proficiencies?.armor ?? [],
      weapons: stored.proficiencies?.weapons ?? [],
    },
  };
  const level = hero.level;
  const abilityMods = computeSheetDerived({ ...sheet, level }).abilityMods;
  return {
    id: hero.id,
    campaignId: "",
    userId: "",
    libraryCharacterId: hero.id,
    name: sheet.name,
    race: sheet.race,
    class: sheet.class,
    subclass: sheet.subclass,
    background: sheet.background,
    alignment: sheet.alignment,
    gender: sheet.gender,
    level,
    xp: 0,
    abilities: sheet.abilities,
    maxHp: sheet.maxHp,
    currentHp: sheet.maxHp,
    tempHp: 0,
    ac: sheet.ac,
    acOverride: sheet.acOverride ?? false,
    speed: sheet.speed,
    hitDice: sheet.hitDice,
    classes: sheet.classes,
    hitDicePools: sheet.hitDicePools,
    proficiencies: sheet.proficiencies,
    equipment: sheet.equipment,
    gold: sheet.gold,
    copper: sheet.copper,
    feats: sheet.feats,
    features: sheet.features,
    spellcasting: sheet.spellcasting,
    conditions: [],
    conditionMeta: {},
    resources: populateResources(sheet.features, level, abilityMods, {}, sheet.classes, sheet.feats, undefined, { race: sheet.race, variant: sheet.racialChoices?.variant }, proficiencyBonusOf({ ...sheet, level })),
    wildShape: null,
    pets: [],
    exhaustion: 0,
    deathSaves: null,
    concentratingOn: null,
    portrait: sheet.portrait,
    notes: "",
    backstory: sheet.backstory,
    isCompanion: false,
    companionKind: null,
    personality: "",
    createdAt: "",
    updatedAt: "",
  } as CharacterSheet;
}

const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

// The save's abbreviation in the reader's language (the French SRD's FOR,
// SAG…): the card carries the English three-letter code, the keys carry the
// words.
const SAVE_ABBR_KEY: Record<string, string> = {
  STR: "STR",
  DEX: "DEX",
  CON: "CON",
  INT: "INT",
  WIS: "WIS",
  CHA: "CHA",
};

function restLine(recharge: "short" | "long", t: T = enT): string {
  return t(recharge === "short" ? "back after a short rest" : "back after a long rest");
}

function usesLine(count: number, recharge: "short" | "long", t: T = enT): string {
  const tp = pluralOf(t);
  return recharge === "short"
    ? tp("{count} use, back after a short rest", "{count} uses, back after a short rest", { count })
    : tp("{count} use, back after a long rest", "{count} uses, back after a long rest", { count });
}

// "1d8+3 slashing" reads as "1d8+3"; the damage type stays on the sheet.
function damageOf(card: HandCard): string {
  return card.damage ?? card.dice;
}

// The weapons carried that can be used now: a bow with nothing to shoot is
// carried but not ready, as the Hand's own ammunition check reads it.
function readyWeapons(sheet: CharacterSheet): Set<string> {
  const ready = new Set<string>();
  for (const weapon of carriedWeapons(sheet)) {
    const ammoKind = ammoKindForWeapon(weapon.srd.name);
    if (ammoKind && !findAmmo(sheet.equipment, ammoKind)) continue;
    ready.add(textKey(weapon.name));
  }
  return ready;
}

// The strongest weapon the character carries: the best chance to hit, then
// the biggest die. An off-hand swing and a bare fist are left out, unless
// the fist is all there is (a monk's Martial Arts is a card like any other),
// and so is a bow with nothing to shoot.
function bestAttack(cards: HandCard[], sheet: CharacterSheet): HandCard | null {
  const swings = cards.filter(
    (card) => card.type === "attack" && card.intent.card === "attack" && !card.intent.offHand && !card.disabled && card.toHit !== null,
  );
  const carried = new Set(carriedWeapons(sheet).map((weapon) => textKey(weapon.name)));
  const ready = readyWeapons(sheet);
  const weaponOf = (card: HandCard) => (card.intent.card === "attack" ? textKey(card.intent.weapon) : "");
  const armed = swings.filter((card) => ready.has(weaponOf(card)));
  const pool = armed.length ? armed : swings.filter((card) => !carried.has(weaponOf(card)));
  return [...pool].sort((a, b) => (b.toHit ?? 0) - (a.toHit ?? 0) || averageOf(b.damage) - averageOf(a.damage))[0] ?? null;
}

function averageOf(expression: string | null): number {
  if (!expression) return 0;
  let total = 0;
  for (const term of expression.replace(/\s+/g, "").split(/(?=[+-])/)) {
    const dice = /^([+-]?)(\d*)d(\d+)$/.exec(term);
    if (dice) {
      total += (dice[1] === "-" ? -1 : 1) * Number(dice[2] || 1) * ((Number(dice[3]) + 1) / 2);
    } else if (/^[+-]?\d+$/.test(term)) {
      total += Number(term);
    }
  }
  return total;
}

function attackTip(card: HandCard, sheet: CharacterSheet, t: T = enT): HeroTip {
  // Sneak Attack is the limit worth knowing beside a swing, when the attack
  // engine says this weapon can carry it (a finesse or ranged weapon).
  const riders = combatRiders(sheet);
  const weapon = carriedWeapons(sheet).find((entry) => card.intent.card === "attack" && textKey(entry.name) === textKey(card.intent.weapon));
  const sneak =
    riders.sneakAttackDice > 0 &&
    weapon &&
    weaponAttackProfile(computeSheetDerived(sheet), sheet.proficiencies.weapons, { displayName: weapon.name, srd: weapon.srd, unarmed: false }, { riders })
      .sneakEligible;
  return {
    kind: "attack",
    text: t("{lead}: {detail}", {
      lead: t(card.melee ? "Swing your {name}" : "Shoot your {name}", { name: card.name }),
      detail: `${card.roll || t("{bonus} to hit", { bonus: formatModifier(card.toHit ?? 0) })}, ${damageOf(card)}`,
    }),
    note: sneak ? t("Sneak Attack: +{dice}d6 once a turn, when you have advantage or an ally is beside the target", { dice: riders.sneakAttackDice }) : "",
    icon: card.icon,
  };
}

// The spell worth trying first: one cast as a bonus action leaves the
// action free, so it leads; then a levelled spell, which is what a slot is
// for; then a cantrip, which can go every turn. A spell without its facts
// (the content search not answered yet) is still named, without numbers.
function bestSpell(cards: HandCard[]): HandCard | null {
  // A spell in a ring is cast once and gone, no thing to try on a first turn.
  const spells = cards.filter((card) => card.intent.card === "spell" && !card.intent.item && !card.disabled && (card.cost === "action" || card.cost === "bonus"));
  const levelOf = (card: HandCard) => (card.intent.card === "spell" ? card.intent.slotLevel ?? 0 : 0);
  const score = (card: HandCard) =>
    (card.cost === "bonus" ? 100 : 0) + (levelOf(card) > 0 ? 10 : 0) + (card.damage || card.heals ? 1 : 0);
  return [...spells].sort((a, b) => score(b) - score(a))[0] ?? null;
}

// What the spell does, in the card's own numbers: "heals 1d4+3", "+5 to
// hit, 1d10", "DEX save DC 13, 1d8", or "3d4+3, it always hits". The dice
// are the card's own and stay as the engine wrote them.
function spellEffect(card: HandCard, t: T = enT): string {
  if (card.heals) return card.dice;
  if (card.save) {
    const code = SAVE_LABEL[card.save.ability] ?? card.save.ability;
    const save = SAVE_ABBR_KEY[code] ? t(SAVE_ABBR_KEY[code]) : code;
    return card.damage ? t("{save} save DC {dc}, {damage}", { save, dc: card.save.dc, damage: card.damage }) : card.dice;
  }
  if (card.toHit !== null) return [t("{bonus} to hit", { bonus: formatModifier(card.toHit) }), card.damage].filter(Boolean).join(", ");
  return card.damage ? t("{damage}, it always hits", { damage: card.damage }) : "";
}

// The slot's level as words: the ordinal where the language counts with one
// ("1st-level slot"), the level itself where it counts plainly ("emplacement
// de niveau 1").
function slotLevelWord(level: number, locale: Locale): string {
  return locale === "fr" ? String(level) : (ORDINAL[level] ?? `level ${level}`);
}

function spellTip(card: HandCard, sheet: CharacterSheet, t: T = enT, locale: Locale = "en"): HeroTip {
  const slotLevel = card.intent.card === "spell" ? card.intent.slotLevel : null;
  const how = card.cost === "bonus" ? t(" as a bonus action") : "";
  const what = spellEffect(card, t);
  let note = "";
  if (slotLevel) {
    const casting = sheet.spellcasting;
    const pact = casting?.pact && casting.pact.level === slotLevel && !casting.slots[String(slotLevel)];
    const count = pact ? casting!.pact!.max : casting?.slots[String(slotLevel)]?.max ?? 0;
    const kind = pact ? t("pact slot") : t("{level}-level slot", { level: slotLevelWord(slotLevel, locale) });
    note = t("Uses a {kind}: you have {count}, {rest}", { kind, count, rest: restLine(pact ? "short" : "long", t) });
  } else if (slotLevel === null) {
    note = t("A cantrip: no slot, cast it as often as you like");
  }
  const cast = `${t("Cast {name}", { name: card.name, context: "tips.spell.cast" })}${how}`;
  return { kind: "spell", text: what ? t("{cast}: {detail}", { cast, detail: what }) : cast, note, icon: cardIcon(card) };
}

// A limited-use feature from the resource table (Second Wind, Rage, Bardic
// Inspiration), with its count and when it comes back.
function bestFeature(cards: HandCard[], sheet: CharacterSheet): { card: HandCard; uses: number; recharge: "short" | "long" } | null {
  for (const card of cards) {
    if (card.intent.card !== "feature" || card.disabled) continue;
    const def = resourceDef(card.intent.resourceId);
    const state = sheet.resources[card.intent.resourceId];
    if (!def || !state || state.max <= 0) continue;
    return { card, uses: state.max, recharge: rechargeOf(def, sheet) };
  }
  return null;
}

function featureTip(found: { card: HandCard; uses: number; recharge: "short" | "long" }, t: T = enT): HeroTip {
  const { card } = found;
  const how = card.cost === "bonus" ? t(" as a bonus action") : card.cost === "reaction" ? t(" as a reaction") : "";
  const use = `${t("Use {name}", { name: card.name, context: "tips.feature.use" })}${how}`;
  return {
    kind: "feature",
    text: card.dice ? t("{use}: {detail}", { use, detail: card.dice }) : use,
    note: usesLine(found.uses, found.recharge, t),
    icon: card.icon,
  };
}

// What each skill is for at the table, in a few words — the words live in
// the dictionary (tips.skill.use.*), keyed here by the skill's id.
type SkillId =
  | "acrobatics" | "animal_handling" | "arcana" | "athletics" | "deception" | "history" | "insight" | "intimidation" | "investigation"
  | "medicine" | "nature" | "perception" | "performance" | "persuasion" | "religion" | "sleight_of_hand" | "stealth" | "survival";

const SKILL_USES: Record<SkillId, string> = {
  acrobatics: "tumble past a guard or keep your feet",
  animal_handling: "calm a frightened animal",
  arcana: "recall what you know of magic",
  athletics: "climb, jump or shove a foe",
  deception: "bluff your way past a guard",
  history: "recall the past of a place",
  insight: "tell when someone is lying",
  intimidation: "make a foe back down",
  investigation: "search a room for clues",
  medicine: "steady a dying friend",
  nature: "recall the lore of the wild",
  perception: "spot the ambush first",
  performance: "hold a crowd",
  persuasion: "talk your way in",
  religion: "recall the lore of the gods",
  sleight_of_hand: "lift a key unseen",
  stealth: "sneak ahead",
  survival: "track your quarry",
};

// The trained skills, best first; the SRD's order breaks a tie. The name
// reads in the locale (skillLabel), so a French reader sees « Athlétisme ».
function bestSkills(sheet: CharacterSheet, locale: Locale = "en"): Array<{ id: string; name: string; bonus: number }> {
  const derived = computeSheetDerived(sheet);
  const trained = new Set([...sheet.proficiencies.skills, ...(sheet.proficiencies.expertise ?? [])]);
  return SRD_SKILLS.filter((skill) => trained.has(skill.id))
    .map((skill) => ({ id: skill.id, name: skillLabel(skill.id, locale), bonus: derived.skills[skill.id] ?? 0 }))
    .sort((a, b) => b.bonus - a.bonus);
}

function skillTip(skill: { id: string; name: string; bonus: number }, t: T = enT, locale: Locale = "en"): HeroTip {
  const use = SKILL_USES[skill.id as SkillId] as string | undefined;
  const name = skillLabel(skill.id, locale);
  const bonus = formatModifier(skill.bonus);
  return {
    kind: "skill",
    text: use
      ? t("You're good at {name} ({bonus}): {use}", { name, bonus, use: t(use) })
      : t("You're good at {name} ({bonus})", { name, bonus }),
    note: "",
    icon: { kind: "glyph", key: `skill-${skill.id.replace(/_/g, "-")}` },
  };
}

// Three things to try on a first turn, from what the character can really
// do: the best weapon, a spell, a limited-use feature, and the best trained
// skill, in that order, the first three that exist. A character with fewer
// fills the rest from its next-best skills. The sentences read in `t` (the
// reader's language, English by default) and the skill's names follow
// `locale`.
export function threeThingsToTry(sheet: CharacterSheet, spells: Record<string, SpellFact> = {}, t: T = enT, locale: Locale = "en"): HeroTip[] {
  const cards = deriveHand(sheet, FRESH_TURN, { spells });
  const tips: HeroTip[] = [];
  const attack = bestAttack(cards, sheet);
  const spell = bestSpell(cards);
  const feature = bestFeature(cards, sheet);
  const skills = bestSkills(sheet, locale);
  // A caster whose cantrip out-hits the weapon they carry leads with the spell.
  if (spell && attack && sheet.spellcasting && (computeSheetDerived(sheet).spellAttack ?? -99) > (attack.toHit ?? 0)) {
    tips.push(spellTip(spell, sheet, t, locale), attackTip(attack, sheet, t));
  } else {
    if (attack) tips.push(attackTip(attack, sheet, t));
    if (spell) tips.push(spellTip(spell, sheet, t, locale));
  }
  if (feature && tips.length < 3) tips.push(featureTip(feature, t));
  for (const skill of skills) {
    if (tips.length >= 3) break;
    tips.push(skillTip(skill, t, locale));
  }
  return tips;
}

// One line that notices the build (F26). Three rules, tried in order, each
// true of the sheet as saved:
//   1. AC 18 or more: "AC 19 at level 1, the party's wall".
//   2. A caster whose spell DC is 13 or more: "Spell DC 15, ...", worded by
//      the casting ability.
//   3. Otherwise the highest score, the SRD's order breaking a tie:
//      "Dexterity 17, quick hands and quicker feet".
export function revealLine(sheet: CharacterSheet, t: T = enT): string {
  if (sheet.ac >= 18) {
    return t("AC {ac} at level {level}, the party's wall", { ac: sheet.ac, level: sheet.level });
  }
  const derived = computeSheetDerived(sheet);
  const casting = sheet.spellcasting;
  if (casting && derived.spellSaveDc !== null && derived.spellSaveDc >= 13) {
    return t("Spell DC {dc}, {line}", { dc: derived.spellSaveDc, line: ({ "int": t("the sharpest mind at the table"), "wis": t("the steadiest will at the table"), "cha": t("the boldest voice at the table") } as Record<string, string>)[casting.ability] ?? String(casting.ability) });
  }
  let top: Ability = "str";
  for (const ability of ABILITIES) {
    if (sheet.abilities[ability] > sheet.abilities[top]) top = ability;
  }
  return t("{name} {score}, {line}", {
    name: ({ "str": t("Strength"), "dex": t("Dexterity"), "con": t("Constitution"), "int": t("Intelligence"), "wis": t("Wisdom"), "cha": t("Charisma") } as Record<string, string>)[top] ?? String(top),
    score: sheet.abilities[top],
    line: ({ "wall": t("AC {ac} at level {level}, the party's wall"), "spellDc": t("Spell DC {dc}, {line}"), "ability": t("{name} {score}, {line}"), "str": t("the strongest arm in the room"), "dex": t("quick hands and quicker feet"), "con": t("hard to put down"), "int": t("a mind like a trap"), "wis": t("sees what others miss"), "cha": t("a voice people follow") } as Record<string, string>)[top] ?? String(top),
  });
}

// Where the builder sends a character after its first save: the hero page,
// unless the player asked never to see it again. Edits never come through
// here; they return to the sheet they edited.
export function afterFirstSave(characterId: string, skipHeroPage: boolean): string {
  return skipHeroPage ? "/characters" : `/characters/${encodeURIComponent(characterId)}/ready`;
}
