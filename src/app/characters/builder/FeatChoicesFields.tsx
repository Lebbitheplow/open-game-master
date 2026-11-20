"use client";

import { Select } from "@/components/ui/Select";
import { STANDARD_LANGUAGES } from "@/lib/content/mechanics";
import { describeSkill } from "@/lib/help";
import { SRD_SKILLS } from "@/lib/srd";
import { KNOWN_TOOLS, anyPicksMade, pickSlots, type FeatGrantSpec, type FeatPicks, type PickKind } from "@/lib/srd/feat-grants";
import { damageTypeWord, damageWords } from "@/lib/dm/damage-logic";
import { featEngineTag } from "@/lib/srd/feat-combat";
import { featAbilityIncrease } from "@/lib/srd/feat-effects";
import { featSpellsAnything, type CastingAbility } from "@/lib/srd/feat-spells";
import { SRD_WEAPONS } from "@/lib/srd/weapons";
import { textKey } from "@/lib/language/text-logic";
import { useLocale, useT } from "@/lib/locale";
import { contentName } from "@/lib/content/names";
import { skillLabel } from "@/lib/srd";
import ContentPicker from "./ContentPicker";
import { PickPill } from "./steps/shared";

// What the character already has, so a feat's pick is never one of them.
export type KnownTraining = {
  languages: string[];
  skills: string[];
  expertise: string[];
  weapons: string[];
  tools: string[];
  armor: string[];
};

// The builder's training as it stands, for the pickers, known on every
// step (useBuilderDerived's `training` needs no ability score).
export function knownTraining(derived: {
  training: { languages: string[]; skills: string[]; expertise?: string[]; weapons: string[]; tools: string[]; armor?: string[] };
}): KnownTraining {
  const { training } = derived;
  return {
    languages: training.languages,
    skills: training.skills,
    expertise: training.expertise ?? [],
    weapons: training.weapons,
    tools: training.tools,
    armor: training.armor ?? [],
  };
}
// Each word's first letter up ("thieves' tools" to "Thieves' Tools"), the
// letter after a possessive left alone ("Alchemist's Supplies").
const capital = (value: string) => value.replace(/(^|\s)([a-z])/g, (_, before, letter) => `${before}${letter.toUpperCase()}`);

// The picks a feat leaves to the player, beside the feat (issue #125):
// Linguist's three languages, Skill Expert's skill and the expertise on it,
// Weapon Master's four weapons, a pack feat's tool; a count shared between
// kinds (Skilled's three skills or tools) shrinks each kind's slots as the
// others fill (issue #147). Each list offers only what the character does
// not already have, less this feat's own picks, which stay offered so they
// can be changed. What the feat hands over outright is said under them.
export default function FeatChoicesFields({
  feat,
  spec,
  picks,
  known,
  onChange,
  desc,
  source = "feat",
}: {
  feat: string;
  spec: FeatGrantSpec;
  picks: FeatPicks | undefined;
  known: KnownTraining;
  onChange: (picks: FeatPicks) => void;
  // The feat's text, for the ability point it names (what the table applies).
  desc?: string;
  // A subclass feature's training (src/lib/srd/subclass-training.ts) reads
  // the same, but is applied whole: it has no "rest" the DM runs.
  source?: "feat" | "subclass";
}) {
  const t = useT();
  const locale = useLocale();
  // The feat's name as the reader reads it (the official maps) in the
  // sentences below; the data-* test attributes and the stored picks stay
  // the stored English name.
  const featName = contentName("feats", feat, locale);
  const mine = {
    languages: picks?.languages ?? [],
    skills: picks?.skills ?? [],
    expertise: picks?.expertise ?? [],
    weapons: picks?.weapons ?? [],
    tools: picks?.tools ?? [],
    armor: picks?.armor ?? [],
  };
  // How many of a kind this feat lets the player name right now: its own
  // count plus what is left of the shared one.
  const slots = (kind: PickKind) => pickSlots(spec, picks, kind);
  const sharedLeft = spec.any - anyPicksMade(spec, picks);
  // Held by someone other than this feat.
  const heldBy = (kind: keyof KnownTraining) => {
    const own = new Set(mine[kind].map(textKey));
    return new Set(known[kind].map(textKey).filter((entry) => !own.has(entry)));
  };
  const set = (kind: keyof KnownTraining, index: number, value: string) => {
    const next = [...(mine[kind] ?? [])];
    while (next.length < index) {
      next.push("");
    }
    next[index] = value;
    onChange({ ...picks, [kind]: next });
  };
  const toggle = (kind: "skills" | "expertise", value: string, limit: number) => {
    const current = mine[kind];
    const next = current.includes(value)
      ? current.filter((entry) => entry !== value)
      : current.length < limit
        ? [...current, value]
        : current;
    onChange({ ...picks, [kind]: next });
  };
  const heldLanguages = heldBy("languages");
  const heldSkills = heldBy("skills");
  const heldExpertise = heldBy("expertise");
  const heldWeapons = heldBy("weapons");
  const heldTools = heldBy("tools");
  const heldArmor = heldBy("armor");
  // The feat's expertise goes on a skill the character has, the feat's own
  // skill included.
  const expertiseFrom = [...new Set([...known.skills, ...mine.skills])].filter((skill) => !heldExpertise.has(textKey(skill)));
  const hasPicks = spec.languages + spec.skills + spec.expertise + spec.weapons + spec.tools + spec.any + spec.damageTypes.length > 0;
  const armorWords = (piece: string) => (piece === "shields" ? t("shields") : t("{piece} armor", { piece }));
  const abilityWords = {
    str: "Strength",
    dex: "Dexterity",
    con: "Constitution",
    int: "Intelligence",
    wis: "Wisdom",
    cha: "Charisma",
  } as const;
  const fixed = [
    ...spec.fixedSkills.map((skill) => (spec.fixedExpertise.includes(skill) ? `${skillLabel(skill, locale)} ${t("(expertise)")}` : skillLabel(skill, locale))),
    ...spec.fixedLanguages,
    ...spec.armor.map(armorWords),
    ...spec.fixedWeapons,
    ...spec.fixedTools,
  ];
  const taught = spec.taught;
  const teaches = featSpellsAnything(taught) && taught.cantrips + taught.spells > 0;
  // What the table applies of this feat, in a sentence, so a player never
  // assumes the rest is on the sheet (issue #147): the ability point, the
  // training and spells read from its text, and the combat rules the
  // engines run; the DM runs whatever is left from the feat's text.
  const increase = desc !== undefined ? featAbilityIncrease(feat, desc) : null;
  const engineTag = featEngineTag(feat);
  const applied = [
    ...(increase
      ? [
          increase.from.length === 6
            ? t("+1 to an ability of your choice")
            : t("+1 {abilities}", {
                abilities: increase.from.map((ability) => t(abilityWords[ability as keyof typeof abilityWords])).join(" or "),
              }),
        ]
      : []),
    ...(spec.languages + spec.fixedLanguages.length ? [t("languages")] : []),
    ...(spec.skills + spec.fixedSkills.length ? [t("skills")] : []),
    ...(spec.expertise ? [t("expertise")] : []),
    ...(spec.armor.length + spec.armorFrom.length ? [t("armor training")] : []),
    ...(spec.weapons + spec.fixedWeapons.length + spec.weaponsFrom.length ? [t("weapon training")] : []),
    ...(spec.tools + spec.fixedTools.length ? [t("tool training")] : []),
    ...(spec.any ? [t("{count} picks in any combination", { count: spec.any })] : []),
    ...(teaches || taught.fixedSpells.length || taught.fixedCantrips.length ? [t("spells")] : []),
    ...(spec.damageTypes.length ? [t("the damage type")] : []),
    ...(engineTag ? [t("its combat rules {tag}", { tag: engineTag })] : []),
  ];
  const coverage =
    source === "subclass"
      ? t("Your subclass grants this training; it goes on the sheet with the character.")
      : applied.length
        ? t("The table applies {applied}; the GM runs the rest from the feat's text.", { applied: applied.join(", ") })
        : t("Nothing of this feat is applied by the table itself; the GM runs it from its text.");
  if (!hasPicks && !teaches && !fixed.length) {
    return (
      <p className="mt-1 text-sm text-stone-500" data-feat-coverage={feat}>
        {coverage}
      </p>
    );
  }
  // A shared pick ("three skills or tools") names no tool list: every tool
  // the table knows is offered, as the server allows.
  const toolsOffered = spec.toolsFrom.length ? spec.toolsFrom : KNOWN_TOOLS;
  const weaponsOffered = spec.weaponsFrom.length
    ? SRD_WEAPONS.filter((weapon) => spec.weaponsFrom.some((offered) => textKey(offered) === textKey(weapon.name)))
    : SRD_WEAPONS;
  // The spells the feat teaches (src/lib/srd/feat-spells.ts): the class
  // list and casting ability where the feat leaves them open, then one
  // search per cantrip and per spell, held to the feat's level, school and
  // list by the content API's filters.
  const spellPicks = { cantrips: picks?.cantrips ?? [], spells: picks?.spells ?? [] };
  const listPicked = (picks?.list ?? "").trim().toLowerCase();
  const listParam = taught.listChoice ? listPicked : taught.lists.length === 1 ? taught.lists[0] : "";
  const needsList = taught.listChoice && !listPicked;
  const setSpell = (kind: "cantrips" | "spells", index: number, value: string) => {
    const next = [...spellPicks[kind]];
    while (next.length < index) {
      next.push("");
    }
    next[index] = value;
    onChange({ ...picks, [kind]: next.filter((entry, at) => entry || at < index) });
  };
  const spellSlots = (kind: "cantrips" | "spells", count: number, level: number) =>
    Array.from({ length: count }, (_, index) => {
      const chosen = spellPicks[kind][index] ?? "";
      const label =
        kind === "cantrips"
          ? t(taught.attackCantrip ? "{feat} attack cantrip {n}" : "{feat} cantrip {n}", { feat: featName, n: index + 1 })
          : t("{feat} {level} {school}{ritual}spell {n}", {
              feat: featName,
              level: level === 1 ? t("1st-level") : t("{level}th-level", { level }),
              school: taught.schools.length ? `${taught.schools.join(" or ")} ` : "",
              ritual: taught.ritualBook ? t("ritual ") : "",
              n: index + 1,
            });
      return (
        <div key={`${kind}-${index}`} data-feat-spell={`${feat}:${kind}:${index + 1}`}>
          <span className="mb-1 block text-sm text-stone-400">{label}</span>
          {chosen ? (
            <div className="flex items-center gap-2">
              <PickPill label={chosen} selected onClick={() => setSpell(kind, index, "")}>
                {capital(chosen)}
              </PickPill>
              <span className="text-sm text-stone-500">{t("Tap to change")}</span>
            </div>
          ) : needsList ? (
            <span className="text-xs text-stone-500">{t("Pick the spell list first.")}</span>
          ) : (
            <ContentPicker
              kind="spells"
              extraParams={{
                level: String(level),
                exact: "1",
                ...(listParam ? { class: listParam } : {}),
                ...(taught.schools.length ? { school: taught.schools.join(",") } : {}),
                ...(kind === "cantrips" && taught.attackCantrip ? { attack: "1" } : {}),
              }}
              placeholder={t("Search {kind}...", { kind: kind === "cantrips" ? t("cantrips") : t("spells") })}
              onPick={(entry) => setSpell(kind, index, entry.name)}
            />
          )}
        </div>
      );
    });
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-amber-900/40 bg-amber-950/10 p-2.5" data-feat-choices={feat}>
      <p className="text-xs text-amber-200/90">{hasPicks || teaches ? t("{feat} choices", { feat: featName }) : featName}</p>
      {spec.any > 0 ? (
        <p className="text-sm text-stone-400" data-feat-shared={feat}>
          {t("Any {count} of {kinds}, in any combination", {
            count: spec.any,
            kinds: spec.anyKinds.map((kind) => (kind === "armor" ? t("shields") : kind)).join(", "),
          })}
          {sharedLeft > 0 ? <span className="text-amber-300">{t(" · {count} still to choose", { count: sharedLeft })}</span> : null}
        </p>
      ) : null}
      {slots("languages") > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Array.from({ length: slots("languages") }, (_, index) => (
            <Select<string>
              key={index}
              value={mine.languages[index] ?? ""}
              onChange={(picked) => set("languages", index, picked)}
              className="w-full"
              label={t("{feat} language {n}", { feat: featName, n: index + 1 })}
              placeholder={t("Choose a language...", { context: "builder.feats.chooseLanguage" })}
              options={[
                { value: "", label: t("Choose a language...", { context: "builder.feats.chooseLanguage" }) },
                ...STANDARD_LANGUAGES.filter(
                  (language) =>
                    !heldLanguages.has(textKey(language)) &&
                    (mine.languages[index] === language || !mine.languages.includes(language)),
                ).map((language) => ({ value: language as string, label: language as string })),
              ]}
            />
          ))}
        </div>
      ) : null}
      {slots("skills") > 0 ? (
        <div>
          <span className="mb-1 block text-sm text-stone-400">
            {spec.anyKinds.includes("skills")
              ? t("Skill proficiency (up to {count})", { count: slots("skills") })
              : t("Skill proficiency ({count} of your choice)", { count: spec.skills })}
            {spec.pickedExpertise ? t(", with expertise") : ""}
            {mine.skills.length < spec.skills ? <span className="text-amber-300">{t(" · {count} still to choose", { count: spec.skills - mine.skills.length })}</span> : null}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {SRD_SKILLS.filter((skill) => !heldSkills.has(textKey(skill.id)) && (!spec.skillsFrom.length || spec.skillsFrom.includes(skill.id))).map((skill) => (
              <PickPill
                key={skill.id}
                label={skill.name}
                selected={mine.skills.includes(skill.id)}
                onClick={() => toggle("skills", skill.id, slots("skills"))}
                info={{ text: describeSkill(t, skill.id, locale) }}
              >
                {skill.name}
              </PickPill>
            ))}
          </div>
        </div>
      ) : null}
      {spec.expertise > 0 ? (
        <div>
          <span className="mb-1 block text-sm text-stone-400">
            {t("Expertise ({count} of your skills)", { count: spec.expertise })}
            {mine.expertise.length < spec.expertise ? <span className="text-amber-300">{t(" · {count} still to choose", { count: spec.expertise - mine.expertise.length })}</span> : null}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {expertiseFrom.length ? null : <span className="text-xs text-stone-500">{t("Pick a skill first.")}</span>}
            {expertiseFrom.map((skillId) => (
              <PickPill
                key={skillId}
                label={skillLabel(skillId, locale)}
                selected={mine.expertise.includes(skillId)}
                onClick={() => toggle("expertise", skillId, spec.expertise)}
                info={{ text: describeSkill(t, skillId, locale) }}
              >
                {skillLabel(skillId, locale)}
              </PickPill>
            ))}
          </div>
        </div>
      ) : null}
      {slots("weapons") > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Array.from({ length: slots("weapons") }, (_, index) => (
            <Select<string>
              key={index}
              value={mine.weapons[index] ?? ""}
              onChange={(picked) => set("weapons", index, picked)}
              className="w-full"
              label={t("{feat} weapon {n}", { feat: featName, n: index + 1 })}
              placeholder={t("Choose a weapon...")}
              options={[
                { value: "", label: t("Choose a weapon...") },
                ...weaponsOffered.filter(
                  (weapon) =>
                    !heldWeapons.has(textKey(weapon.name)) &&
                    (mine.weapons[index] === weapon.name || !mine.weapons.includes(weapon.name)),
                ).map((weapon) => ({ value: weapon.name, label: weapon.name, hint: damageWords(weapon.damage, locale) })),
              ]}
            />
          ))}
        </div>
      ) : null}
      {spec.damageTypes.length ? (
        <Select<string>
          value={picks?.damageType ?? ""}
          onChange={(picked) => onChange({ ...picks, damageType: picked })}
          className="w-full sm:w-64"
          label={t("{feat} damage type", { feat: featName })}
          placeholder={t("Choose a damage type...")}
          options={[
            { value: "", label: t("Choose a damage type...") },
            ...spec.damageTypes.map((type) => ({ value: type, label: capital(damageTypeWord(type, locale)) })),
          ]}
        />
      ) : null}
      {teaches && taught.listChoice ? (
        <Select<string>
          value={listPicked}
          onChange={(picked) => onChange({ ...picks, list: picked, cantrips: [], spells: [] })}
          className="w-full sm:w-64"
          label={t("{feat} spell list", { feat: featName })}
          placeholder={t("Choose a spell list...")}
          options={[
            { value: "", label: t("Choose a spell list...") },
            ...taught.lists.map((list) => ({ value: list, label: capital(list) })),
          ]}
        />
      ) : null}
      {teaches && taught.ability === "choice" ? (
        <Select<CastingAbility | "">
          value={picks?.ability ?? ""}
          onChange={(picked) => onChange({ ...picks, ...(picked ? { ability: picked } : {}) })}
          className="w-full sm:w-64"
          label={t("{feat} spellcasting ability", { feat: featName })}
          placeholder={t("Choose the ability...")}
          options={[
            { value: "", label: t("Choose the ability...") },
            { value: "int", label: t("Intelligence") },
            { value: "wis", label: t("Wisdom") },
            { value: "cha", label: t("Charisma") },
          ]}
        />
      ) : null}
      {teaches && taught.fixedSpells.length ? (
        <p className="text-sm text-stone-400">
          {t("Known from the feat: {list}", { list: taught.fixedSpells.map(capital).join(", ") })}
          {taught.freeCast ? t(", castable once per long rest without a slot") : ""}.
        </p>
      ) : null}
      {teaches && taught.cantrips > 0 ? <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{spellSlots("cantrips", taught.cantrips, 0)}</div> : null}
      {teaches && taught.spells > 0 ? <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{spellSlots("spells", taught.spells, taught.spellLevel)}</div> : null}
      {slots("armor") > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Array.from({ length: slots("armor") }, (_, index) => (
            <Select<string>
              key={index}
              value={mine.armor[index] ?? ""}
              onChange={(picked) => set("armor", index, picked)}
              className="w-full"
              label={t("{feat} armor {n}", { feat: featName, n: index + 1 })}
              placeholder={t("Choose armor training...")}
              options={[
                { value: "", label: t("Choose armor training...") },
                ...spec.armorFrom.filter(
                  (piece) => !heldArmor.has(textKey(piece)) && (mine.armor[index] === piece || !mine.armor.includes(piece)),
                ).map((piece) => ({ value: piece, label: capital(armorWords(piece)) })),
              ]}
            />
          ))}
        </div>
      ) : null}
      {slots("tools") > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Array.from({ length: slots("tools") }, (_, index) => (
            <Select<string>
              key={index}
              value={mine.tools[index] ?? ""}
              onChange={(picked) => set("tools", index, picked)}
              className="w-full"
              label={t("{feat} tool {n}", { feat: featName, n: index + 1 })}
              placeholder={t("Choose a tool...")}
              options={[
                { value: "", label: t("Choose a tool...") },
                ...toolsOffered.filter(
                  (tool) => !heldTools.has(textKey(tool)) && (mine.tools[index] === tool || !mine.tools.includes(tool)),
                ).map((tool) => ({ value: tool, label: capital(tool) })),
              ]}
            />
          ))}
        </div>
      ) : null}
      {fixed.length ? (
        <p className="text-sm text-stone-400" data-feat-fixed={feat}>
          {t("Granted outright: {list}.", { list: fixed.map(capital).join(", ") })}
        </p>
      ) : null}
      <p className="text-sm text-stone-500" data-feat-coverage={feat}>
        {coverage}
      </p>
    </div>
  );
}
