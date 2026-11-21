"use client";

import { applyHalfDragon, DRAGON_COLORS, type DragonColor } from "@/lib/bestiary/half-dragon";
import { Plus, Wand2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Select as KitSelect } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { OptionGlossary } from "@/components/ui/OptionGlossary";
import type { GlossaryEntry } from "@/lib/help/terms";
import {
  ANCESTRY_OPTIONS,
  CLASS_KIT_OPTIONS,
  MOVEMENT_MODES,
  addTrait,
  applyAncestry,
  applyArmor,
  applyClassChassis,
  addAttack,
  armorOptionsFor,
  classFeatureLines,
  describeChassis,
  findWeapon,
  formatSpeed,
  hasTerm,
  parseSpeed,
  parseTerms,
  subclassOptionsFor,
  toggleTerm,
  weaponAttack,
  weaponOptionsFor,
} from "@/lib/bestiary/kit";
import { MAX_TRAITS, type MonsterDraft } from "@/lib/bestiary/monster-draft";
import { proficiencyBonus } from "@/lib/srd";
import { textKey } from "@/lib/language/text-logic";
import { useLocale, useT } from "@/lib/locale";
import { contentName } from "@/lib/content/names";
import { damageWords } from "@/lib/dm/damage-logic";
import type { Locale } from "@/lib/messages-logic";

// The half of the monster editor that picks rather than types.
//
// Split out of MonsterFields for the reason every panel here is split: that
// file is the fields of a stat block, and this is the catalogue over them.
// Nothing in here decides anything either. Every control below produces an
// ordinary MonsterDraft through src/lib/bestiary/kit.ts, lands in a field
// MonsterFields already renders, and can be renamed, retyped or deleted
// afterwards like anything hand-written.

const input =
  "rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200 focus:border-amber-500/50 focus:outline-none";

const chip =
  "rounded-full border px-2 py-0.5 text-[10px] transition-colors duration-150";

// A term list stored as one comma-joined string. The catalogue is offered as
// chips; anything not in it stays typeable, because a monster immune to
// "sunlight" is a real monster and no list of ours will ever hold every
// answer.
export function TermPicker({
  label,
  value,
  known,
  onChange,
  glossary,
  wordFor,
}: {
  label: string;
  value: string;
  known: readonly string[];
  onChange: (value: string) => void;
  // What the known terms mean, one line each, behind a ⓘ in the caption.
  glossary?: readonly GlossaryEntry[];
  // A catalogue term as the reader reads it (« Tranchants », « Aveuglé »);
  // left out, the term itself. The extras are the reader's own words and
  // always read as typed.
  wordFor?: (term: string) => string;
}) {
  const t = useT();
  const extras = parseTerms(value).filter(
    (term) => !known.some((entry) => textKey(entry) === textKey(term)),
  );
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-stone-500">
        {label}
        {glossary ? <OptionGlossary title={label} entries={glossary} /> : null}
      </span>
      <div className="stagger-pop flex flex-wrap gap-1">
        {known.map((term) => {
          const on = hasTerm(value, term);
          return (
            <button
              key={term}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(toggleTerm(value, term))}
              className={cn(
                chip,
                on
                  ? "border-amber-500/50 bg-stone-800 text-amber-100"
                  : "border-stone-700 text-stone-500 hover:text-stone-200",
              )}
            >
              {wordFor ? wordFor(term) : term}
            </button>
          );
        })}
        {extras.map((term) => (
          <button
            key={term}
            type="button"
            aria-pressed
            onClick={() => onChange(toggleTerm(value, term))}
            title={t("Your own; click to remove")}
            className={cn(chip, "border-amber-500/50 bg-stone-800 text-amber-100")}
          >
            {term}
          </button>
        ))}
      </div>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("or type your own, comma separated")}
        className={cn(input, "w-full")}
      />
    </div>
  );
}

// The movement words the French SRD's own stat blocks print (« marche »,
// « fouissement », « escalade », « vol », « nage »). English keeps the raw
// mode, exactly as the picker always read it.
const MOVEMENT_WORDS_FR: Record<string, string> = {
  walk: "marche",
  burrow: "fouissement",
  climb: "escalade",
  fly: "vol",
  swim: "nage",
};

function movementModeWord(mode: string, locale: Locale): string {
  if (locale !== "fr") {
    return mode;
  }
  return MOVEMENT_WORDS_FR[mode] ?? mode;
}

// Speed is one printed string ("30, fly 60") because that is what a stat
// block says and what the fight reads. Nobody should have to know the comma
// convention to give a dragon a fly speed.
export function SpeedPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const speeds = parseSpeed(value);
  const set = (mode: "walk" | (typeof MOVEMENT_MODES)[number], feet: number) =>
    onChange(formatSpeed({ ...speeds, [mode]: feet }));
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-stone-500">{t("Speed")}</span>
      <div className="flex flex-wrap gap-2">
        {(["walk", ...MOVEMENT_MODES] as const).map((mode) => (
          <div key={mode} className="flex flex-col gap-0.5">
            <span className="text-[10px] capitalize text-stone-600">{movementModeWord(mode, locale)}</span>
            <NumberStepper
              min={0}
              max={999}
              step={5}
              value={speeds[mode] ?? 0}
              onChange={(feet) => set(mode, feet)}
              label={t("{mode} speed in feet", { mode: movementModeWord(mode, locale) })}
              size="sm"
            />
          </div>
        ))}
      </div>
      <span className="text-[10px] text-stone-600">{t("Reads as \"{value}\". Zero hides a mode.", { value: value || "0" })}</span>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  // The first row is the "" choice ("Pick one", "None"), still pickable so a
  // choice can be taken back, as the blank option of the old list was.
  options: Array<{ value: string; label: string }>;
  className?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-stone-500">{label}</span>
      <KitSelect value={value} onChange={onChange} options={options} label={label} size="sm" className={className ?? "w-40"} />
    </label>
  );
}

// The catalogue, aimed at the block. Four independent moves: what it is,
// what it trained as, what it is holding, and which of that class's
// abilities it actually brought.

// The dragon colors the French SRD prints ("dragon rouge", "dragon
// d'airain"...). The stored value stays the English color id; the option
// label reads the reader's language, capitalized (English keeps the raw id).
const DRAGON_COLOR_WORDS_FR: Record<string, string> = {
  black: "noir",
  blue: "bleu",
  brass: "airain",
  bronze: "bronze",
  copper: "cuivre",
  gold: "or",
  green: "vert",
  red: "rouge",
  silver: "argent",
  white: "blanc",
};

const capital = (value: string) => value.replace(/(^|\s)([a-z])/g, (_, before, letter) => `${before}${letter.toUpperCase()}`);

function dragonColorWord(color: string, locale: Locale): string {
  if (locale !== "fr") {
    return color;
  }
  return DRAGON_COLOR_WORDS_FR[color] ?? color;
}

export function MonsterKitPanel({
  draft,
  onChange,
}: {
  draft: MonsterDraft;
  onChange: (draft: MonsterDraft) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [ancestryId, setAncestryId] = useState("");
  const [classId, setClassId] = useState("");
  const [subclass, setSubclass] = useState("");
  const [level, setLevel] = useState(5);
  const [con, setCon] = useState(14);
  const [armorName, setArmorName] = useState("");
  const [shield, setShield] = useState(false);
  const [weaponName, setWeaponName] = useState("");
  const [weaponMod, setWeaponMod] = useState(3);
  const [dragon, setDragon] = useState<DragonColor | "">("");
  const [templateNote, setTemplateNote] = useState("");

  const subclasses = subclassOptionsFor(classId);
  const features = classFeatureLines(classId, subclass, level);
  const chassis = { classId, subclass, level, con, ancestryId };
  const traitsFull = draft.stats.traits.length >= MAX_TRAITS;
  const attacksFull = draft.stats.attacks.length >= 4;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-stone-800 bg-stone-950/50 p-3">
      <h4 className="flex items-center gap-1.5 text-xs text-amber-100">
        <Wand2 className="size-3.5" /> {t("Build it out of the catalogue")}
      </h4>
      <p className="text-[10px] text-stone-600">
        {t("Everything these add is an ordinary line on the block below: rename it, retune the numbers, or delete it. Mix as many classes as you like.")}
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <Select
          label={t("Ancestry", { context: "workshop.bestiary.catalogue.ancestry" })}
          value={ancestryId}
          onChange={setAncestryId}
          options={[{ value: "", label: t("Pick one") }, ...ANCESTRY_OPTIONS.map((ancestry) => ({ value: ancestry.id as string, label: ancestry.name }))]}
        />
        <button
          type="button"
          disabled={!ancestryId}
          onClick={() => onChange(applyAncestry(draft, ancestryId))}
          className="rounded-md border border-stone-700 px-2 py-1 text-[11px] text-stone-300 hover:text-amber-100 disabled:opacity-40"
        >
          {t("Take its size, speed and traits")}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Select
          label={t("Class")}
          value={classId}
          onChange={(next) => {
            setClassId(next);
            setSubclass("");
          }}
          options={[{ value: "", label: t("Pick one") }, ...CLASS_KIT_OPTIONS.map((klass) => ({ value: klass.id as string, label: klass.name }))]}
        />
        <Select
          label={t("Subclass")}
          value={subclass}
          onChange={setSubclass}
          options={[{ value: "", label: subclasses.length ? t("None", { context: "workshop.bestiary.catalogue.none" }) : t("None available") }, ...subclasses.map((name) => ({ value: name, label: name }))]}
        />
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-stone-500">{t("Level")}</span>
          <NumberStepper min={1} max={20} value={level} onChange={setLevel} label={t("Level")} size="sm" />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-stone-500">{t("CON")}</span>
          <NumberStepper min={1} max={30} value={con} onChange={setCon} label={t("CON")} size="sm" />
        </div>
        <button
          type="button"
          disabled={!classId}
          onClick={() => onChange(applyClassChassis(draft, chassis))}
          className="rounded-md border border-stone-700 px-2 py-1 text-[11px] text-stone-300 hover:text-amber-100 disabled:opacity-40"
        >
          {t("Take its hit points, saves and swings")}
        </button>
      </div>
      {classId ? (
        <p className="reveal text-[10px] text-stone-600">{describeChassis(chassis, t)}</p>
      ) : null}

      {features.length ? (
        <div className="reveal flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-stone-500">
            {t("Its abilities at that level")} {traitsFull ? t("(trait list full)") : t("(click to add)")}
          </span>
          <div className="stagger-pop flex flex-wrap gap-1">
            {features.map((feature) => {
              const on = draft.stats.traits.some(
                (trait) => textKey(trait) === textKey(feature.line),
              );
              return (
                <button
                  key={`${feature.name}-${feature.level}`}
                  type="button"
                  disabled={on || traitsFull}
                  title={feature.text || t("Gained at level {n}", { n: feature.level })}
                  onClick={() => onChange(addTrait(draft, feature.line))}
                  className={cn(
                    chip,
                    on
                      ? "border-amber-500/50 bg-stone-800 text-amber-100"
                      : "border-stone-700 text-stone-400 hover:text-amber-100 disabled:opacity-40",
                  )}
                >
                  {on ? null : <Plus className="mr-0.5 inline size-2.5" />}
                  {feature.name}
                  <span className="ml-1 text-stone-600">{feature.level}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <Select
          label={t("Half-dragon template")}
          value={dragon}
          onChange={(value) => setDragon(value as DragonColor | "")}
          options={[{ value: "", label: t("Dragon half") }, ...DRAGON_COLORS.map((color) => ({ value: color as string, label: locale === "fr" ? capital(dragonColorWord(color, locale)) : dragonColorWord(color, locale) }))]}
        />
        <button
          type="button"
          disabled={!dragon}
          onClick={() => {
            if (!dragon) return;
            const made = applyHalfDragon(draft, dragon);
            if ("error" in made) {
              setTemplateNote(made.error);
              return;
            }
            setTemplateNote(made.note);
            onChange(made.draft);
          }}
          className="rounded-md border border-stone-700 px-2 py-1 text-[11px] text-stone-300 hover:text-amber-100 disabled:opacity-40"
        >
          {t("Make it a half-dragon")}
        </button>
        {templateNote ? <span className="live-in basis-full text-[10px] text-stone-500">{templateNote}</span> : null}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Select
          label={t("Armour")}
          value={armorName}
          onChange={setArmorName}
          options={[
            { value: "", label: t("Unarmoured") },
            ...armorOptionsFor(classId)
              .filter((armor) => armor.category !== "shield")
              .map((armor) => ({ value: armor.name, label: `${armor.name} (${armor.baseAc})` })),
          ]}
        />
        <label className="flex items-center gap-1.5 pb-1 text-[11px] text-stone-400">
          <Switch on={shield} onChange={setShield} label={t("Shield")} />
          {t("Shield")}
        </label>
        <button
          type="button"
          onClick={() => onChange(applyArmor(draft, armorName, shield))}
          className="rounded-md border border-stone-700 px-2 py-1 text-[11px] text-stone-300 hover:text-amber-100"
        >
          {t("Set the armour class")}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Select
          label={t("Weapon")}
          value={weaponName}
          onChange={setWeaponName}
          className="w-44"
          options={[{ value: "", label: t("Pick one") }, ...weaponOptionsFor(classId).map((weapon) => ({ value: weapon.name, label: `${contentName("weapons", weapon.name, locale)} (${damageWords(weapon.damage, locale)})` }))]}
        />
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-stone-500">{t("Ability mod")}</span>
          <NumberStepper min={0} max={10} value={weaponMod} onChange={setWeaponMod} label={t("Ability mod")} size="sm" />
        </div>
        <button
          type="button"
          disabled={!weaponName || attacksFull}
          onClick={() => {
            const weapon = findWeapon(weaponName);
            if (weapon) {
              onChange(
                addAttack(
                  draft,
                  weaponAttack(weapon, {
                    // A stat block's level, not a character's sheet.
                    profBonus: proficiencyBonus(level),
                    abilityMod: weaponMod,
                  }),
                ),
              );
            }
          }}
          className="rounded-md border border-stone-700 px-2 py-1 text-[11px] text-stone-300 hover:text-amber-100 disabled:opacity-40"
        >
          {attacksFull ? t("Attack list full") : t("Add it as an attack")}
        </button>
        <span className="pb-1 text-[10px] text-stone-600">
          {t("To hit +{n} at level {level}.", { n: proficiencyBonus(level) + Math.max(0, weaponMod), level })}
        </span>
      </div>
    </div>
  );
}
