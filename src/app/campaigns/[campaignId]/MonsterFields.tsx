"use client";

import { useId, useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Select } from "@/components/ui/Select";
import { CONDITION_BLURBS, DAMAGE_TYPE_BLURBS, glossaryFor } from "@/lib/help/terms";
import {
  MAX_ATTACKS,
  SAVE_ABILITIES,
  SIZES,
  type MonsterDraft,
  type MonsterReadout,
} from "@/lib/bestiary/monster-draft";
import { CONDITIONS, DAMAGE_TYPES } from "@/lib/bestiary/kit";
import { CREATURE_TYPES, creatureTypeOf } from "@/lib/bestiary/creature-type";
import { SpeedPicker, TermPicker } from "@/app/campaigns/[campaignId]/MonsterKitFields";
import { crLabel, type CrPart } from "@/lib/bestiary/derive-cr";
import { Reveal } from "@/components/ui/Reveal";
import { AttackDetails } from "@/app/workshop/bestiary/AttackDetails";
import { useLocale, useT } from "@/lib/locale";
import { damageTypeWord, damageWords } from "@/lib/dm/damage-logic";
import { contentName } from "@/lib/content/names";
import type { Locale } from "@/lib/messages-logic";

// The parts of a stat block that are more than one number in a box, split
// out of DmBestiaryPanel the way NpcFields was split out of the NPC forge:
// the panel around them fetches and saves, and these are the fields.
//
// Nothing here decides anything. Every edit produces a draft the server
// re-checks through src/lib/bestiary/monster-draft.ts, which is also where
// the rule that matters lives: a damage expression the dice engine cannot
// roll is refused rather than repaired.

const input =
  "rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200 focus:border-amber-500/50 focus:outline-none";

// The shape of a translator, as the pure helpers take it
// (src/lib/characters/seat-preview.ts).
type T = (key: string, vars?: Record<string, string | number>) => string;

// An initial capital, as FeatChoicesFields writes its option labels.
const capital = (value: string) => value.replace(/(^|\s)([a-z])/g, (_, before, letter) => `${before}${letter.toUpperCase()}`);

export function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-stone-500">{label}</span>
      <NumberStepper min={min} max={max} value={value} onChange={onChange} label={label} size="sm" className="w-fit" />
      {hint ? <span className="text-[10px] text-stone-600">{hint}</span> : null}
    </div>
  );
}

// The attack list. This is where a monster's whole offensive rating comes
// from, and where the only refusal in the editor lives.
export function AttackEditor({
  draft,
  onChange,
}: {
  draft: MonsterDraft;
  onChange: (draft: MonsterDraft) => void;
}) {
  const t = useT();
  const locale = useLocale();
  // One list per mounted editor: a fixed id collided when two were open.
  const damageListId = useId();
  // Which rows show their reach, range, riders and on-hit effect.
  const [opened, setOpened] = useState<Set<number>>(() => new Set());
  const toggle = (index: number) =>
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  const attacks = draft.stats.attacks;
  const setAttacks = (next: typeof attacks) =>
    onChange({ ...draft, stats: { ...draft.stats, attacks: next } });

  return (
    <div className="flex flex-col gap-1.5">
      <datalist id={damageListId}>
        {DAMAGE_TYPES.map((type) => (
          <option key={type} value={type} />
        ))}
      </datalist>
      {attacks.map((attack, index) => (
        <div key={index} className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={attack.name}
            onChange={(event) =>
              setAttacks(
                attacks.map((row, at) =>
                  at === index ? { ...row, name: event.target.value } : row,
                ),
              )
            }
            placeholder={t("Bite")}
            className={cn(input, "w-28")}
          />
          <span className="flex items-center gap-1 text-[10px] text-stone-500">
            {t("to hit")}
            <NumberStepper
              min={-5}
              max={20}
              value={attack.toHit}
              onChange={(toHit) => setAttacks(attacks.map((row, at) => (at === index ? { ...row, toHit } : row)))}
              label={t("To hit, {name}", { name: attack.name || t("attack", { context: "workshop.bestiary.attack.unnamed" }) })}
              size="sm"
            />
          </span>
          <input
            value={attack.damage}
            onChange={(event) =>
              setAttacks(
                attacks.map((row, at) =>
                  at === index ? { ...row, damage: event.target.value } : row,
                ),
              )
            }
            placeholder="2d6+3"
            className={cn(input, "w-24")}
          />
          {/* A list rather than a select: the thirteen types the engine
              knows are one keystroke away, and "chitin-shredding" is still
              typeable for a monster that wants it. */}
          <input
            list={damageListId}
            value={attack.type}
            onChange={(event) =>
              setAttacks(
                attacks.map((row, at) =>
                  at === index ? { ...row, type: event.target.value } : row,
                ),
              )
            }
            placeholder={t("slashing", { context: "workshop.bestiary.attack.typePlaceholder" })}
            className={cn(input, "w-24")}
          />
          <button
            type="button"
            aria-expanded={opened.has(index)}
            onClick={() => toggle(index)}
            className="inline-flex items-center gap-1 rounded-md border border-stone-700 px-1.5 py-0.5 text-[10px] text-stone-400 hover:text-amber-100"
          >
            {attackExtras(attack, t, locale)}
            <ChevronDown className={cn("size-3 transition-transform duration-200", opened.has(index) && "rotate-180")} />
          </button>
          <button
            type="button"
            onClick={() => {
              setAttacks(attacks.filter((_, at) => at !== index));
              setOpened(new Set());
            }}
            className="text-stone-600 hover:text-red-300"
            aria-label={t("Remove {name}", { name: attack.name || t("attack", { context: "workshop.bestiary.attack.unnamed" }) })}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
        <Reveal open={opened.has(index)}>
          {opened.has(index) ? (
            <AttackDetails
              attack={attack}
              onChange={(next) => setAttacks(attacks.map((row, at) => (at === index ? next : row)))}
            />
          ) : null}
        </Reveal>
        </div>
      ))}
      {attacks.length < MAX_ATTACKS ? (
        <button
          type="button"
          onClick={() =>
            setAttacks([...attacks, { name: "", toHit: 3, damage: "1d6+1", type: "untyped" }])
          }
          className="inline-flex w-fit items-center gap-1 rounded-md border border-stone-700 px-2 py-0.5 text-[11px] text-stone-400 hover:text-amber-100"
        >
          <Plus className="size-3" /> {t("Attack")}
        </button>
      ) : null}
      <p className="text-[10px] text-stone-600">
        {t("The engine swings the Multiattack routine when the block has one, otherwise its best attack as many times as Swings says. Damage has to be something the dice roller can read.")}
      </p>
    </div>
  );
}

// The word on an attack's details button: what it carries beyond its dice,
// or "Details" when it carries nothing yet. The riders' type words read in
// the reader's language (damageWords passes English through unchanged).
function attackExtras(attack: MonsterDraft["stats"]["attacks"][number], t: T, locale: Locale): string {
  const bits = [
    attack.bonusAction ? t("bonus action", { context: "workshop.bestiary.attack.chipBonus" }) : "",
    attack.range ? `${attack.range.normal}/${attack.range.long} ft` : attack.reach === 0 || (attack.reach && attack.reach > 5) ? t("reach {n}", { n: attack.reach }) : "",
    attack.riders?.length ? `+${attack.riders.map((rider) => damageWords(rider.type, locale)).join(", ")}` : "",
    attack.onHit?.condition ?? (attack.onHit?.damage ? t("on hit") : ""),
    attack.alternatives?.some((entry) => entry.when === "bloodied") ? t("weaker when bloodied") : "",
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : t("Details");
}

export function SaveEditor({
  draft,
  onChange,
}: {
  draft: MonsterDraft;
  onChange: (draft: MonsterDraft) => void;
}) {
  const t = useT();
  const saves = draft.stats.saveMods ?? { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  return (
    // A stepper is wider than the bare box it replaced, so the columns are as
    // many as the container holds (the 320px side panel, the workshop's half
    // page); the rows still read in the familiar stat order.
    <div className="stagger-up grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-1">
      {SAVE_ABILITIES.map((ability) => (
        <div key={ability} className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase text-stone-500">{({ "cha": t("CHA"), "con": t("CON"), "dex": t("DEX"), "int": t("INT"), "str": t("STR"), "wis": t("WIS") } as Record<string, string>)[ability] ?? String(ability)}</span>
          <NumberStepper
            min={-5}
            max={20}
            value={saves[ability]}
            onChange={(next) =>
              onChange({
                ...draft,
                stats: {
                  ...draft.stats,
                  saveMods: { ...saves, [ability]: next },
                },
              })
            }
            label={t("{ability} save", { ability: ({ "cha": t("CHA"), "con": t("CON"), "dex": t("DEX"), "int": t("INT"), "str": t("STR"), "wis": t("WIS") } as Record<string, string>)[ability] ?? String(ability), context: "workshop.bestiary.stats.saveAria" })}
            size="sm"
            className="w-fit"
          />
        </div>
      ))}
    </div>
  );
}

// The size words the French SRD's own category table prints (« Très
// petite » ... « Gigantesque »), and the creature types its ranger list and
// monster chapter print. The stored values stay the English ids; only the
// label reads the reader's language (damageTypeWord's pattern,
// src/lib/dm/damage-logic.ts). A word the maps do not carry reads as it was
// spelled.
const SIZE_WORDS_FR: Record<string, string> = {
  Tiny: "Très petite",
  Small: "Petite",
  Medium: "Moyenne",
  Large: "Grande",
  Huge: "Très grande",
  Gargantuan: "Gigantesque",
};

function sizeWord(size: string, locale: Locale): string {
  if (locale !== "fr") {
    return size;
  }
  return SIZE_WORDS_FR[size] ?? size;
}

const CREATURE_TYPE_WORDS_FR: Record<string, string> = {
  aberration: "Aberration",
  beast: "Bête",
  celestial: "Céleste",
  construct: "Artificiel",
  dragon: "Dragon",
  elemental: "Élémentaire",
  fey: "Fée",
  fiend: "Fiélon",
  giant: "Géant",
  humanoid: "Humanoïde",
  monstrosity: "Monstrosité",
  ooze: "Vase",
  plant: "Plante",
  undead: "Mort-vivant",
};

function creatureTypeWord(type: string, locale: Locale): string {
  const en = type.charAt(0).toUpperCase() + type.slice(1);
  if (locale !== "fr") {
    return en;
  }
  return CREATURE_TYPE_WORDS_FR[type] ?? en;
}

export function SizeAndDefences({
  draft,
  onChange,
}: {
  draft: MonsterDraft;
  onChange: (draft: MonsterDraft) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const set = (patch: Partial<MonsterDraft["stats"]>) =>
    onChange({ ...draft, stats: { ...draft.stats, ...patch } });
  // The chip words: the damage types capitalized out of the French SRD's own
  // list, the conditions through the official names layer. English keeps the
  // raw term, exactly as the chips always read.
  const damageWordFor = (term: string) => (locale === "fr" ? capital(damageTypeWord(term, locale)) : term);
  const conditionWordFor = (term: string) => contentName("conditions", term, locale);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-stone-500">{t("Size")}</span>
          <Select
            value={draft.stats.size ?? "Medium"}
            onChange={(size) => set({ size })}
            options={SIZES.map((size) => ({ value: size as string, label: sizeWord(size, locale) }))}
            label={t("Size")}
            size="sm"
            className="w-32"
          />
        </label>
        {/* What it is, in the SRD's fourteen words. This is also the
            thumbnail: every list the monster appears in draws the plate for
            its type until somebody paints it a portrait. */}
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-stone-500">{t("Type", { context: "workshop.bestiary.stats.type" })}</span>
          <Select
            value={creatureTypeOf(draft.stats) as string}
            onChange={(type) => set({ type })}
            options={CREATURE_TYPES.map((type) => ({ value: type as string, label: creatureTypeWord(type, locale) }))}
            label={t("Type", { context: "workshop.bestiary.stats.type" })}
            size="sm"
            className="w-32"
          />
        </label>
        <SpeedPicker value={draft.stats.speed} onChange={(speed) => set({ speed })} />
      </div>
      {/* The three damage fields offer the thirteen types the fight actually
          resists, and the condition field the fifteen condition-logic.ts
          enforces. Anything else still goes in by hand, because a monster
          immune to "being seen" is a fine monster and no chip list of ours
          will hold every answer. */}
      {/* Black Flag's resistance and vulnerability to a condition (advantage
          or disadvantage on the save) show only on a block that has them: a
          copy keeps them editable, and no other book prints them. */}
      {(
        [
          ["resist", t("Resistant to"), DAMAGE_TYPES],
          ["immune", t("Immune to", { context: "workshop.bestiary.stats.immune" }), DAMAGE_TYPES],
          ["vulnerable", t("Vulnerable to"), DAMAGE_TYPES],
          ["conditionImmune", t("Condition immunities"), CONDITIONS],
          ...(draft.stats.conditionResist ? [["conditionResist", t("Resistant to conditions (advantage on the save)"), CONDITIONS] as const] : []),
          ...(draft.stats.conditionVulnerable ? [["conditionVulnerable", t("Vulnerable to conditions (disadvantage on the save)"), CONDITIONS] as const] : []),
        ] as const
      ).map(([field, label, known]) => (
        <TermPicker
          key={field}
          label={label}
          value={draft.stats[field] ?? ""}
          known={known}
          wordFor={known === CONDITIONS ? conditionWordFor : damageWordFor}
          onChange={(value) => set({ [field]: value })}
          glossary={glossaryFor(
            known,
            known === CONDITIONS ? CONDITION_BLURBS : DAMAGE_TYPE_BLURBS,
          )}
        />
      ))}
    </div>
  );
}

// Say why. Every derived number, with the sentence that produced it. A DM
// will not trust a difficulty rating they cannot audit, and the ratings
// worth auditing are exactly the ones that disagree with their instinct.
export function Working({ parts, notes }: { parts: CrPart[]; notes: string[] }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-stone-800 bg-stone-950/60 p-2">
      {parts.map((part) => (
        <div key={part.label} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
          <span className="w-28 shrink-0 text-stone-500">{part.label}</span>
          <span className="w-16 shrink-0 text-amber-100">{part.value}</span>
          <span className="flex-1 text-stone-500">{part.detail}</span>
        </div>
      ))}
      {notes.map((note) => (
        <p key={note} className="text-[10px] text-amber-300/70">
          {note}
        </p>
      ))}
    </div>
  );
}

export function RatingLine({ readout }: { readout: MonsterReadout }) {
  const t = useT();
  return (
    <p className={cn("text-[11px]", readout.agrees ? "text-stone-500" : "text-amber-300/80")}>
      {readout.agrees
        ? t("The numbers agree: CR {cr}.", { cr: crLabel(readout.statedCr) })
        : t("Written as CR {cr}; the numbers say CR {derived}.", {
            cr: crLabel(readout.statedCr),
            derived: crLabel(readout.derived.cr),
          })}
    </p>
  );
}
