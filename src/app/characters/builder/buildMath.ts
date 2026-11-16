// The build math table (backlog F10): every number the sheet will carry,
// beside the picks, with the parts each is made of. Pure, so
// scripts/test-builder-build-math.mjs can check it without React.
//
// Nothing is worked out here. Each number is read from the calculation the
// save and the sheet use: computeSheetDerived's parts for saves, skills,
// initiative and spellcasting, builderHp.ts for hit points, acBreakdownFor
// for armor class, the gear receipt's weapon lines (receiptMath.ts) and the
// slots the save stores (casting.ts builderSpellSlots). This module only
// lays them out as rows and says what changed.
import type { Ability } from "@/lib/schemas/sheet";
import { pickedVariant, type SpeciesVariantGroup } from "@/lib/content/species-variants";
import { SRD_SKILLS, findSkill, formatModifier, mathPartLabel, proficiencyBonus, skillLabel, type DerivedPart } from "@/lib/srd";
import { ABILITY_NAMES } from "@/lib/srd/legality/types";
import { armorClassLine, hitPointsLine } from "./derivedReasons";
import { casterLevelFor } from "@/lib/srd/multiclass";
import type { BuilderDerived } from "./useBuilderDerived";
import { pluralOf } from "@/lib/messages-logic";
import { textKey } from "@/lib/language/text-logic";

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const COUNT_WORDS: Record<number, string> = { 1: "one", 2: "two", 3: "three", 4: "four" };

export type BuildMathRow = {
  // Stable across renders: the announcement compares rows by it.
  id: string;
  // The row header.
  label: string;
  value: string;
  // How the number is made: "Dex +3, proficiency +2".
  working: string;
};

export type BuildMathSection = { id: string; title: string; rows: BuildMathRow[] };

// The reading takes the translator from the panel that draws the table.
type Translator = (key: string, vars?: Record<string, string | number>) => string;

export type BuildMathInput = {
  t: Translator;
  derived: Pick<
    BuilderDerived,
    | "preview"
    | "hp"
    | "acInfo"
    | "ac"
    | "shownAbilities"
    | "effectiveLevel"
    | "spellSlots"
    | "purse"
    | "racialBonus"
    | "abilityGains"
  > &
    // A character with levels in more than one class (backlog F9).
    Partial<Pick<BuilderDerived, "extras" | "casterKlass" | "casterLevel" | "pactSlots" | "multiclass" | "casterDesks" | "classList">>;
  // The scores as assigned, before the race's bonus.
  scores: Record<Ability, number | null>;
  klass: { name: string; hitDie: number } | undefined;
  // Built for a table that has chosen how hit points are worked.
  atTable: boolean;
};

// The parts as a line, in the sheet's own words and signs, as the sheet's
// own breakdown writes them: "Dexterity modifier +3, proficiency +2". Each
// label reads in the reader's language (mathPartLabel, the words the sheet's
// own explain lines go through); an unknown label (a pack's own) reads as it
// was built.
export function workingOf(t: Translator, parts: DerivedPart[]): string {
  return parts
    .map((part) => `${mathPartLabel(t, part.label)} ${formatModifier(part.value)}`)
    .join(", ");
}

// The slot levels in order, keyed as the sheet keys its slots.
const SLOT_LEVELS: Array<[string, string]> = [
  ["1", "1st"], ["2", "2nd"], ["3", "3rd"], ["4", "4th"], ["5", "5th"], ["6", "6th"], ["7", "7th"], ["8", "8th"], ["9", "9th"],
];

export function buildMathSections({ t, derived, scores, klass, atTable }: BuildMathInput): BuildMathSection[] {
  const { preview, hp, shownAbilities, effectiveLevel } = derived;
  if (!preview || !shownAbilities || !hp || !klass) {
    return [];
  }
  const sheet = preview.derived;
  const sections: BuildMathSection[] = [];

  const hpLine = hitPointsLine(t, {
    hitDie: klass.hitDie,
    level: effectiveLevel,
    maxHp: preview.maxHp,
    range: preview.hpRange,
    method: preview.hpMethod,
    kept: preview.hpKept,
    atTable,
    ...(derived.multiclass ? { dice: [klass.hitDie, ...(derived.extras ?? []).map((entry) => entry.klass.hitDie)] } : {}),
  });
  const parts = hp.parts;
  // A class list's later levels, class by class: each its own die.
  const split = hp.split ?? null;
  const nameOf = (id: string) =>
    derived.extras?.find((entry) => entry.klass.id === id)?.klass.name ?? klass.name;
  const level1 = t("level 1: d{die} {max}, Con {con}{bonus} = {first}", {
    die: parts.hitDie,
    max: parts.hitDie,
    con: formatModifier(parts.conMod),
    bonus: parts.bonusPerLevel ? t(", bonus {bonus}", { bonus: formatModifier(parts.bonusPerLevel) }) : "",
    first: parts.firstLevel,
  });
  const featurePart = parts.featureHp ? [t("features {bonus}", { bonus: formatModifier(parts.featureHp) })] : [];
  const levelsWord = (levels: number) => (levels === 1 ? t("level") : t("levels"));
  const hpWorking = preview.hpKept
    ? hpLine.reason
    : split
      ? [
          level1,
          ...split
            .filter((entry) => entry.levels > 0)
            .map((entry) =>
              preview.hpMethod === "rolled"
                ? t("{levels} {klass} {levelsWord} rolled on a d{die} by the server when you save", {
                    levels: entry.levels,
                    klass: nameOf(entry.id).toLowerCase(),
                    levelsWord: levelsWord(entry.levels),
                    die: entry.hitDie,
                  })
                : t("{levels} {more}{klass} {levelsWord} at {each} each (d{die}) = {sum}", {
                    levels: entry.levels,
                    more: entry === split[0] ? "" : t("more ", { context: "builder.math.more" }),
                    klass: nameOf(entry.id).toLowerCase(),
                    levelsWord: levelsWord(entry.levels),
                    each: entry.perLevel,
                    die: entry.hitDie,
                    sum: entry.levels * entry.perLevel,
                  }),
            ),
          ...featurePart,
        ].join("; ")
      : [
          level1,
          ...(effectiveLevel > 1
            ? [
                preview.hpMethod === "rolled"
                  ? t("{levels} more levels rolled by the server when you save", { levels: effectiveLevel - 1 })
                  : t("{levels} more levels at {each} each ({how} {face}, Con {con}{bonus}) = {sum}", {
                      levels: effectiveLevel - 1,
                      each: parts.perLevel,
                      how: preview.hpMethod === "max" ? t("die's highest face") : t("average"),
                      face: parts.face,
                      con: formatModifier(parts.conMod),
                      bonus: parts.bonusPerLevel ? t(", bonus {bonus}", { bonus: formatModifier(parts.bonusPerLevel) }) : "",
                      sum: parts.laterLevels,
                    }),
              ]
            : []),
          ...featurePart,
        ].join("; ");
  const acLine = armorClassLine(t, derived.acInfo?.ac ?? derived.ac, derived.acInfo?.parts);
  sections.push({
    id: "core",
    title: t("Core"),
    rows: [
      { id: "ac", label: t("Armor class", { context: "builder.math.armorClass" }), value: acLine.value, working: acLine.reason },
      { id: "hp", label: t("Hit points"), value: hpLine.value, working: hpWorking },
      { id: "initiative", label: t("Initiative"), value: formatModifier(sheet.initiative), working: workingOf(t, sheet.parts.initiative) },
      {
        id: "proficiency",
        label: t("Proficiency bonus"),
        value: formatModifier(sheet.proficiencyBonus),
        working: t("level {level}", { level: effectiveLevel }),
      },
      {
        id: "passive-perception",
        label: t("Passive Perception"),
        value: String(sheet.passivePerception),
        working: workingOf(t, sheet.parts.passivePerception),
      },
    ],
  });

  sections.push({
    id: "abilities",
    title: t("Ability scores", { context: "builder.math.abilities" }),
    rows: ABILITIES.map((ability) => {
      const assigned = scores[ability];
      const race = derived.racialBonus[ability] ?? 0;
      const gains = derived.abilityGains[ability] ?? [];
      const working = [
        assigned === null ? null : t("assigned {value}", { value: assigned }),
        race ? t("race {bonus}", { bonus: formatModifier(race) }) : null,
        ...gains.filter((gain) => gain.amount).map((gain) => `${gain.source} ${formatModifier(gain.amount)}`),
      ].filter(Boolean);
      return {
        id: `ability-${ability}`,
        label: ABILITY_NAMES[ability],
        value: `${shownAbilities[ability]} (${formatModifier(sheet.abilityMods[ability])})`,
        working: working.join(", "),
      };
    }),
  });

  sections.push({
    id: "saves",
    title: t("Saving throws"),
    rows: ABILITIES.map((ability) => ({
      id: `save-${ability}`,
      label: t("{ability} save", { ability: t(ABILITY_NAMES[ability]), context: "builder.math.saveOf" }),
      value: formatModifier(sheet.saves[ability]),
      working: workingOf(t, sheet.parts.saves[ability]),
    })),
  });

  const locale = (t as { locale?: "en" | "fr" }).locale ?? "en";
  sections.push({
    id: "skills",
    title: t("Skills"),
    rows: SRD_SKILLS.map((skill) => ({
      id: `skill-${skill.id}`,
      label: skillLabel(skill.id, locale),
      value: formatModifier(sheet.skills[skill.id] ?? 0),
      working: workingOf(t, sheet.parts.skills[skill.id] ?? []),
    })),
  });

  // The table the slots are read from: the casting class's at its own
  // level, the first class's for a single class, and the shared multiclass
  // table at the combined caster level for two or more (backlog F9).
  const slotDesks = (derived.casterDesks ?? []).filter((desk) => desk.klass.casterType !== "pact" && desk.maxSpellLevel > 0);
  const slotTable =
    derived.multiclass && slotDesks.length > 1
      ? t("multiclass table at caster level {level}", { level: casterLevelFor(derived.classList ?? []) })
      : derived.multiclass && derived.casterKlass
        ? t("{klass} table at {lower} level {level}", {
            klass: derived.casterKlass.name,
            lower: derived.casterKlass.name.toLowerCase(),
            level: derived.casterLevel ?? effectiveLevel,
          })
        : t("{klass} table at level {level}", { klass: klass.name, level: effectiveLevel });
  // With more than one casting class each has its own save DC and attack,
  // from its own ability (backlog F9, phase 2).
  const desks = (derived.casterDesks ?? []).filter((desk) => desk.ability && desk.spellSaveDc !== null);
  const perClass = derived.multiclass && desks.length > 1;
  const deskRows = perClass
    ? desks.flatMap((desk) => [
        {
          id: `spell-dc-${desk.classId}`,
          label: t("{klass} spell save DC", { klass: desk.klass.name }),
          value: String(desk.spellSaveDc),
          working: t("8, proficiency {prof}, {code} modifier {mod}", {
            prof: formatModifier(sheet.proficiencyBonus),
            code: (desk.ability ?? "").toUpperCase(),
            mod: formatModifier((desk.spellSaveDc ?? 8) - 8 - sheet.proficiencyBonus),
          }),
        },
        {
          id: `spell-attack-${desk.classId}`,
          label: t("{klass} spell attack", { klass: desk.klass.name }),
          value: formatModifier(desk.spellAttack ?? 0),
          working: t("proficiency {prof}, {code} modifier {mod}", {
            prof: formatModifier(sheet.proficiencyBonus),
            code: (desk.ability ?? "").toUpperCase(),
            mod: formatModifier((desk.spellAttack ?? 0) - sheet.proficiencyBonus),
          }),
        },
      ])
    : [];
  const slotRows = [
    ...SLOT_LEVELS.flatMap(([level, ordinal]) => {
      const slot = derived.spellSlots[level];
      return slot && slot.max > 0
        ? [{ id: `slots-${level}`, label: t("{ordinal}-level slots", { ordinal }), value: String(slot.max), working: slotTable }]
        : [];
    }),
    // A warlock's pact slots on a class list sit apart from the rest.
    ...(derived.pactSlots
      ? [
          {
            id: "slots-pact",
            label: t("Pact magic slots"),
            value: t("{count} at {ordinal} level", {
              count: derived.pactSlots.max,
              ordinal: SLOT_LEVELS[derived.pactSlots.level - 1]?.[1] ?? derived.pactSlots.level,
            }),
            working: t("warlock levels, recovered on a short rest"),
          },
        ]
      : []),
  ];
  if (sheet.spellSaveDc !== null || slotRows.length || deskRows.length) {
    sections.push({
      id: "spells",
      title: t("Spellcasting"),
      rows: [
        ...deskRows,
        ...(sheet.spellSaveDc !== null && !perClass
          ? [{ id: "spell-dc", label: t("Spell save DC", { context: "builder.math.spellDc" }), value: String(sheet.spellSaveDc), working: workingOf(t, sheet.parts.spellSaveDc) }]
          : []),
        ...(sheet.spellAttack !== null && !perClass
          ? [{ id: "spell-attack", label: t("Spell attack", { context: "builder.math.spellAttack" }), value: formatModifier(sheet.spellAttack), working: workingOf(t, sheet.parts.spellAttack) }]
          : []),
        ...slotRows,
      ],
    });
  }

  const weapons = derived.purse.receipt.rows.flatMap((row) =>
    row.weapon && row.qty > 0
      ? [
          {
            id: `weapon-${row.name}`,
            label: row.name,
            value: t("{toHit} to hit, {damage} {type}", {
              toHit: formatModifier(row.weapon.toHit),
              damage: row.weapon.damage,
              type: row.weapon.damageType,
            }),
            working: [
              t("to hit: {parts}", { parts: workingOf(t, row.weapon.toHitParts) }),
              t("damage adds {ability} modifier", { ability: ({ "str": t("Strength"), "dex": t("Dexterity"), "con": t("Constitution"), "int": t("Intelligence"), "wis": t("Wisdom"), "cha": t("Charisma") } as Record<string, string>)[textKey(row.weapon.ability)] ?? String(textKey(row.weapon.ability)) }),
              ...row.weapon.notes,
            ].join("; "),
          },
        ]
      : [],
  );
  if (weapons.length) {
    sections.push({ id: "weapons", title: t("Weapons", { context: "builder.math.weapons" }), rows: weapons });
  }
  return sections;
}

// What is already settled before the table can be worked out: before six
// scores there is no modifier, but the proficiency bonus, the class's hit
// die and saves, the ancestry's bonuses and speed and the skills picked so
// far are the sheet's already. Read from the same rows the save reads.
// The race is the one the builder reads, with its species option folded in
// (species-variants.ts withSpeciesVariant), so the option's bonuses are in
// racialBonus and the option itself is named.
export function knownSoFarRows({
  level,
  klass,
  race,
  racialBonus,
  proficientSkills,
  t,
}: {
  level: number;
  klass: { name: string; hitDie: number; saves: string[] } | undefined;
  race:
    | {
        name: string;
        speed: number;
        asi?: Partial<Record<Ability, number>>;
        asiChoice?: { count: number; amount: number; amounts?: number[] };
        variants?: SpeciesVariantGroup;
      }
    | undefined;
  racialBonus: Partial<Record<Ability, number>>;
  proficientSkills: string[];
  // The reader's words (builder.math.known*); without it the test-pinned
  // English stands.
  t?: Translator;
}): BuildMathRow[] {
  const say = (key: string, vars: Record<string, string | number> = {}, english: string) =>
    typeof t === "function" ? t(key, vars) : english;
  const bonuses = ABILITIES.flatMap((ability) =>
    racialBonus[ability] ? [`${ABILITY_NAMES[ability]} ${formatModifier(racialBonus[ability] ?? 0)}`] : [],
  );
  // The bumps the race leaves to the player (a half-elf's two +1s) that are
  // not placed yet: a placed one is in racialBonus beyond the race's own.
  const choice = race?.asiChoice;
  if (choice && choice.amount > 0) {
    const placed = ABILITIES.reduce((sum, ability) => sum + Math.max(0, (racialBonus[ability] ?? 0) - (race?.asi?.[ability] ?? 0)), 0);
    if (choice.amounts) {
      // Picks of their own amounts (a fairy's +2 then +1), placed in order.
      let left = placed;
      const open = choice.amounts.filter((amount) => (left >= amount ? ((left -= amount), false) : true));
      if (open.length) {
        bonuses.push(`${open.map((amount) => `+${amount}`).join(" and ")} to ${COUNT_WORDS[open.length] ?? open.length} ${bonuses.length ? "more " : ""}of your choice`);
      }
    } else {
      const owed = choice.count - Math.round(placed / choice.amount);
      if (owed > 0) {
        bonuses.push(
          say(
            "+{amount} to {word}{more}of your choice",
            { amount: choice.amount, word: COUNT_WORDS[owed] ?? owed, more: bonuses.length ? t?.("more ", { context: "builder.math.more" }) ?? "more " : "" },
            `+${choice.amount} to ${COUNT_WORDS[owed] ?? owed} ${bonuses.length ? "more " : ""}of your choice`,
          ),
        );
      }
    }
  }
  const variant = race?.variants ? pickedVariant(race) : null;
  const skills = proficientSkills.flatMap((id) => {
    const skill = findSkill(id);
    return skill ? [skill.name] : [];
  });
  // The level's bonus: a character being built is attuned to nothing yet
  // (attuning takes a short rest in play), so no Ioun Stone of Mastery adds.
  return [
    {
      id: "proficiency",
      label: say("Proficiency bonus", {}, "Proficiency bonus"),
      value: formatModifier(proficiencyBonus(level)),
      working: say("level {level}", { level }, `level ${level}`),
    },
    ...(klass
      ? [
          { id: "hit-die", label: say("Hit die", {}, "Hit die"), value: `d${klass.hitDie}`, working: klass.name },
          {
            id: "save-proficiencies",
            label: say("Proficient saves", {}, "Proficient saves"),
            value: klass.saves.map((save) => ABILITY_NAMES[save] ?? save).join(", "),
            working: klass.name,
          },
        ]
      : []),
    ...(race?.variants
      ? [
          {
            id: "species-choice",
            label: race.variants.label,
            value: variant?.name ?? say("still to choose", {}, "still to choose"),
            working: race.name,
          },
        ]
      : []),
    ...(race
      ? [
          {
            id: "ancestry-bonuses",
            label: say("Ancestry bonuses", {}, "Ancestry bonuses"),
            value: bonuses.join(", ") || say("none", {}, "none"),
            working: race.name,
          },
          {
            id: "speed",
            label: say("Speed", {}, "Speed"),
            value: `${race.speed} ft`,
            working: race.name,
          },
        ]
      : []),
    ...(skills.length
      ? [
          {
            id: "skill-proficiencies",
            label: say("Proficient skills", {}, "Proficient skills"),
            value: skills.join(", "),
            working: say("class, background and ancestry picks", {}, "class, background and ancestry picks"),
          },
        ]
      : []),
  ];
}

// What a screen reader hears when picks move the numbers: the first number
// that changed, said as "Armor class 16, was 14", and how many more did. A
// row that appears is said with its value alone; one that goes is not said.
export function changeLine(
  before: ReadonlyMap<string, string>,
  after: BuildMathSection[],
  t?: Translator,
): string | null {
  const tp = pluralOf(t);
  const changed: string[] = [];
  for (const row of after.flatMap((section) => section.rows)) {
    const was = before.get(row.id);
    if (was === undefined) {
      changed.push(t ? t("{label} {value}", { label: row.label, value: row.value }) : `${row.label} ${row.value}`);
    } else if (was !== row.value) {
      changed.push(
        t ? t("{label} {value}, was {was}", { label: row.label, value: row.value, was }) : `${row.label} ${row.value}, was ${was}`,
      );
    }
  }
  if (!changed.length) {
    return null;
  }
  const more = changed.length - 1;
  if (typeof t !== "function") {
    return more ? `${changed[0]}. ${more} more ${more === 1 ? "number" : "numbers"} changed.` : `${changed[0]}.`;
  }
  return more
    ? tp("{lead}. {count} more number changed.", "{lead}. {count} more numbers changed.", { count: more, lead: changed[0] })
    : `${changed[0]}.`;
}

export function snapshotOf(sections: BuildMathSection[]): Map<string, string> {
  return new Map(sections.flatMap((section) => section.rows.map((row) => [row.id, row.value] as const)));
}

type Timers = {
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

// One polite line per burst of changes. The first change after a quiet
// spell opens a window of `waitMs`; every change inside it is folded into
// the line said when it closes, compared against what was last said. The
// first table seen is the starting point and is not announced.
export function createChangeAnnouncer({
  say,
  waitMs = 1200,
  timers = { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
}: {
  say: (line: string) => void;
  waitMs?: number;
  timers?: Timers;
}) {
  let said: Map<string, string> | null = null;
  let latest: BuildMathSection[] = [];
  let pending: unknown = null;
  const flush = () => {
    pending = null;
    const line = said ? changeLine(said, latest) : null;
    said = snapshotOf(latest);
    if (line) {
      say(line);
    }
  };
  return {
    update(sections: BuildMathSection[]) {
      latest = sections;
      if (said === null || said.size === 0) {
        // Nothing to compare with yet: the table filling in for the first
        // time is not a change.
        said = snapshotOf(sections);
        return;
      }
      if (pending === null) {
        pending = timers.setTimeout(flush, waitMs);
      }
    },
    dispose() {
      if (pending !== null) {
        timers.clearTimeout(pending);
        pending = null;
      }
    },
  };
}
