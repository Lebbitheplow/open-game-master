"use client";

import type { CSSProperties, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import { GameTerm } from "@/components/ui/GameTerm";
import { InfoChipList } from "@/components/ui/InfoDialog";
import { CountPop } from "@/components/ui/Reveal";
import { cn } from "@/lib/cn";
import { conditionIconKey } from "@/lib/battlemap/condition-glyphs";
import { describeConditionDuration } from "@/lib/dm/condition-logic";
import { backgroundFeatureReference, contentSlug, describeFeature } from "@/lib/help";
import { useClassFeatureText } from "@/lib/classes/use-feature-text";
import { ABILITIES } from "@/lib/schemas/sheet";
import { formatModifier, skillLabel, SRD_SKILLS } from "@/lib/srd";
import { useLocale, useT } from "@/lib/locale";
import { wearingIsExplicit } from "@/lib/srd/armor";
import { oneOfKind, wornButIdle } from "@/lib/srd/wear-slots";
import { magicItemBonus, rowName, srdNameWithBonus } from "@/lib/srd/item-row";
import { backgroundFeatureName, classFeatureName, contentName, speciesTraitName } from "@/lib/content/names";
import { matchWeapon } from "@/lib/srd/weapons";
import { cardArtwork } from "@/lib/battlemap/card-art";
import { ITEM_CATEGORY_LABEL, itemCategory, itemCategoryIcon, itemToneStyle, type CategoryItem } from "@/lib/srd/item-category-logic";

// The pieces of the character sheet (docs/visual-overhaul-plan.md 8b.5), one
// implementation drawn by both the session's sheet dialog and the character
// page: a medallion portrait, painted ability tiles with tiered numbers,
// vitals medallions, save and skill rows with their icons, and the spell,
// equipment, feature and feat lists as icon chips that open their write-up.
// Styles are in src/app/styles/sheet.css.

type Ability = (typeof ABILITIES)[number];

// The abilities' names as message keys (sheet.ability.*), read with the
// component's own translator; the tile's eyebrow keeps the short code.
const ABILITY_KEYS: Record<Ability, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

// How a score reads at a glance: a weakness is dim, an ordinary score plain,
// a strength gold, and an exceptional one lit.
function scoreTier(score: number): "low" | "plain" | "high" | "peak" {
  if (score <= 9) return "low";
  if (score <= 13) return "plain";
  if (score <= 17) return "high";
  return "peak";
}

// The portrait in a gold ring with the class emblem riding its rim. The
// portrait itself is whatever the caller draws (a lightbox, a plate).
export function PortraitMedallion({
  classId,
  level,
  children,
  className,
  style,
}: {
  classId: string;
  level?: number;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cn("sheet-medallion", className)} style={style}>
      <div className="sheet-medallion-face">{children}</div>
      <span className="sheet-medallion-emblem" title={classId}>
        <GameIcon icon={{ kind: "family", key: `class-${classId.toLowerCase()}` }} size="size-7" />
      </span>
      {level ? <span className="sheet-medallion-level">{level}</span> : null}
    </div>
  );
}

export function SheetBlock({
  title,
  aside,
  hint,
  children,
  className,
}: {
  title: ReactNode;
  aside?: ReactNode;
  // A hover explanation for the heading itself (how a DC was summed).
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("sheet-block", className)}>
      <header className="sheet-block-head" title={hint}>
        <h3 className="sheet-block-title">{title}</h3>
        <span className="sheet-block-rule motion-rule" aria-hidden="true" />
        {aside ? <span className="sheet-block-aside">{aside}</span> : null}
      </header>
      {children}
    </section>
  );
}

export function AbilityTiles({
  abilities,
  mods,
  saves,
  saveProficiencies = [],
  explainSave,
}: {
  abilities: Record<Ability, number>;
  mods: Record<Ability, number>;
  // With saves the tile carries the saving throw under the score.
  saves?: Record<Ability, number>;
  saveProficiencies?: string[];
  explainSave?: (ability: Ability) => string;
}) {
  const t = useT();
  return (
    <div className="stagger-up grid grid-cols-3 gap-2 sm:grid-cols-6">
      {ABILITIES.map((ability, index) => {
        const proficient = saveProficiencies.includes(ability);
        return (
          <div
            key={ability}
            className="sheet-ability motion-card"
            data-tier={scoreTier(abilities[ability])}
            style={{ animationDelay: `${index * 45}ms` }}
            title={t(ABILITY_KEYS[ability])}
          >
            <GameIcon icon={{ kind: "glyph", key: `ability-${ability}` }} size="size-9" className="mx-auto" />
            <p className="eyebrow mt-1 text-[10px] text-stone-400">{ability}</p>
            <p className="sheet-ability-mod">{formatModifier(mods[ability])}</p>
            <p className="sheet-ability-score">{abilities[ability]}</p>
            {saves ? (
              <p
                className={cn("sheet-ability-save", proficient && "sheet-ability-save-on")}
                title={explainSave ? explainSave(ability) : undefined}
              >
                <span className={cn("sheet-pip", proficient && "sheet-pip-on")} aria-hidden="true" />
                {t("Save {mod}", { mod: formatModifier(saves[ability]) })}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export type Vital = {
  glyph: string;
  label: ReactNode;
  value: ReactNode;
  title?: string;
  tone?: "plain" | "warn";
  // A tile that opens more about itself (Carried opens its load breakdown,
  // issue #206) is a button; `opens` is what it opens, for a screen reader.
  onOpen?: () => void;
  opens?: string;
};

export function VitalTiles({ vitals }: { vitals: Vital[] }) {
  return (
    <div className="stagger-up grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {vitals.map((vital, index) => {
        const body = (
          <>
            <GameIcon icon={{ kind: "glyph", key: vital.glyph }} size="size-7" />
            <span className="min-w-0">
              <span className="sheet-vital-label">{vital.label}</span>
              <span className="sheet-vital-value">
                {/* Gold spent, experience won, armour changed: the number pops. */}
                <CountPop value={typeof vital.value === "string" || typeof vital.value === "number" ? vital.value : null}>
                  {vital.value}
                </CountPop>
              </span>
            </span>
          </>
        );
        return vital.onOpen ? (
          <button
            key={index}
            type="button"
            className="sheet-vital sheet-vital-open"
            data-tone={vital.tone ?? "plain"}
            title={vital.title}
            aria-haspopup="dialog"
            onClick={vital.onOpen}
          >
            {body}
            <ChevronRight className="sheet-vital-more size-3.5" aria-hidden="true" />
            {vital.opens ? <span className="sr-only">{vital.opens}</span> : null}
          </button>
        ) : (
          <div key={index} className="sheet-vital" data-tone={vital.tone ?? "plain"} title={vital.title}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

// Hit points as a bar: what is left in red, temporary points riding on top
// in blue. The numbers stay beside it; the bar is the glance.
export function HpBar({
  current,
  max,
  temp = 0,
  note,
}: {
  current: number;
  max: number;
  temp?: number;
  // Why the maximum is not the sheet's own (exhaustion, an item).
  note?: string | null;
}) {
  const t = useT();
  const span = Math.max(1, max + temp);
  const width = (value: number) => `${Math.max(0, Math.min(100, (value / span) * 100))}%`;
  return (
    <div
      className="sheet-hp"
      title={`${current}${temp ? ` ${t("+{temp} temporary", { temp })}` : ""} ${t("of {max} hit points", { max })}${note ? `. ${note}` : ""}`}
    >
      <GameIcon icon={{ kind: "glyph", key: "rest-hp" }} size="size-7" />
      <div className="min-w-0 grow">
        <div className="flex items-baseline justify-between gap-2">
          <span className="sheet-vital-label">
            <GameTerm id="hit_points">Hit points</GameTerm>
          </span>
          <span className="font-display text-sm text-amber-50">
            {current}
            {temp ? <span className="text-sky-300"> +{temp}</span> : null}
            <span key={max} className={cn("motion-pop inline-block", note ? "text-orange-300" : "text-stone-500")}> / {max}</span>
          </span>
        </div>
        <div className="sheet-hp-track">
          <span
            key={`hp-${current}`}
            data-changed=""
            className="motion-bar sheet-hp-fill"
            data-low={current <= max / 4 ? "" : undefined}
            style={{ width: width(current) }}
          />
          {temp ? <span className="sheet-hp-temp" style={{ left: width(current), width: width(temp) }} /> : null}
        </div>
        {note ? <p className="reveal mt-0.5 text-[11px] text-orange-300/90">{note}</p> : null}
      </div>
    </div>
  );
}

// What the character speaks and is trained with, beside the skills, so a
// Linguist's languages or a feat's armor are never only in the DM's prompt
// (issue #125). Ids read as names; an empty kind says so.
export function TrainingLines({
  proficiencies,
  conditional = [],
}: {
  proficiencies: { languages: string[]; tools: string[]; armor: string[]; weapons: string[] };
  // Training that holds only while a condition does (SheetDerived
  // conditionalTraining): "Athletics while wearing the armor from Mystic
  // Metal (Juggernaut)", marked when it holds now.
  conditional?: Array<{ skill: string; by: string; while: string; active: boolean }>;
}) {
  const t = useT();
  const nice = (value: string) =>
    // A word's first letter, or the letter after a quote that opens one: never
    // the "s" after a possessive's apostrophe ("Alchemist'S Supplies").
    value.replace(/[-_]/g, " ").replace(/(^|\s)(['‘]?)([a-z])/g, (_, before: string, quote: string, letter: string) => `${before}${quote}${letter.toUpperCase()}`);
  const localizeValue = (value: string) => {
    const title = nice(value);
    const hit = t(title);
    if (hit !== title) return hit;
    const capFirst = value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : value;
    const capHit = t(capFirst);
    if (capHit !== capFirst) return capHit;
    return title;
  };
  const rows: Array<[string, string[]]> = [
    [t("Languages"), proficiencies.languages],
    [t("Tools"), proficiencies.tools],
    [t("Armor"), proficiencies.armor],
    [t("Weapons", { context: "sheet.training.weapons" }), proficiencies.weapons],
  ];
  return (
    <dl className="stagger-up grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      {rows.map(([label, values]) => (
        <div key={label} className="contents">
          <dt className="text-stone-500">{label}</dt>
          <dd className="text-stone-200">{values.length ? [...new Set(values.map(localizeValue))].join(", ") : <span className="text-stone-400">{t("none", { context: "sheet.training.none" })}</span>}</dd>
        </div>
      ))}
      {conditional.length ? (
        <div className="contents">
          <dt className="text-stone-500">{t("Conditional")}</dt>
          <dd className="text-stone-200">
            {conditional.map((entry, at) => (
              <span key={`${entry.by}-${entry.skill}`}>
                {at ? ", " : ""}
                {localizeValue(entry.skill)} {entry.while} ({entry.by}){entry.active ? t(": holds now") : t(": not now")}
              </span>
            ))}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

export function SkillRows({
  skills,
  proficient,
  explain,
}: {
  skills: Record<string, number>;
  proficient: string[];
  explain?: (skillId: string) => string;
}) {
  // The skill's name follows the reader's language; the glyph stays keyed by
  // the English name, which is what the art is filed under.
  const locale = useLocale();
  return (
    <div className="stagger-up grid grid-cols-1 gap-x-3 gap-y-0.5 min-[420px]:grid-cols-2">
      {SRD_SKILLS.map((skill) => {
        const on = proficient.includes(skill.id);
        return (
          <span key={skill.id} className={cn("sheet-skill", on && "sheet-skill-on")} title={explain?.(skill.id)}>
            <GameIcon icon={{ kind: "glyph", key: `skill-${skill.name}` }} size="size-5" />
            <span className="grow truncate">{skillLabel(skill.id, locale)}</span>
            <span className={cn("sheet-pip", on && "sheet-pip-on")} aria-hidden="true" />
            <span className="w-7 text-right font-mono">{formatModifier(skills[skill.id] ?? 0)}</span>
          </span>
        );
      })}
    </div>
  );
}

// Every carried thing as an icon chip that opens its entry in the library,
// so a rope and a Flame Tongue both say what they are. Worn and attuned gear
// is marked on the chip. The chip leads with the picture of the item's kind
// (a weapon, armor, something used up...), which reads at the chip's size
// where the item's own painting did not; the hover shows the painting, the
// Hand card's where the item has one.
export function EquipmentChips({
  equipment,
  extra,
}: {
  equipment: Array<{ name: string; qty: number; equipped?: boolean; attuned?: boolean; attuning?: boolean; layered?: boolean } & CategoryItem>;
  // More for a row's note, by its index: its charges ("4/7 charges").
  extra?: (index: number) => string | null | undefined;
}) {
  // A worn second cloak (or pair of boots...) is marked as not in effect
  // (src/lib/srd/wear-slots.ts); one the DM let stand beside another says so.
  const t = useT();
  const locale = useLocale();
  const explicit = wearingIsExplicit(equipment);
  const wornNote = (item: (typeof equipment)[number]) => {
    const idle = explicit ? wornButIdle(item, equipment) : null;
    if (idle) return t("worn, not in effect: {kind} at a time", { kind: oneOfKind(idle) ?? t("none", { context: "sheet.training.none" }) });
    if (item.equipped && item.layered) return t("worn beside another, on the GM's say");
    return item.equipped ? (matchWeapon(item) ? "in hand" : t("worn")) : null;
  };
  return (
    <InfoChipList
      items={equipment.map((item, index) => {
        const category = itemCategory(item);
        return {
          name: (() => {
            const shown = contentName("items", rowName(item), locale);
            const bonus = magicItemBonus(item.name);
            return `${bonus ? `${shown} +${bonus}` : shown}${item.qty > 1 ? ` x${item.qty}` : ""}`;
          })(),
          icon: cardArtwork({ kind: "item" as const, key: item.name, family: "item-gear" }),
          lead: { icon: itemCategoryIcon(category), label: ITEM_CATEGORY_LABEL[category], tone: category, style: itemToneStyle(category, "chip") },
          note:
            [
              wornNote(item),
              item.attuned ? t("attuned") : item.attuning ? t("attuning") : null,
              extra?.(index) ?? null,
            ]
              .filter(Boolean)
              .join(", ") || undefined,
          // The card is the row's (src/lib/srd/item-row.ts), with the bonus the
          // item's own name declares.
          reference: { kind: "items", slug: contentSlug(rowName(item)), name: srdNameWithBonus(item) },
        };
      })}
    />
  );
}

export function FeatureChips({
  features,
  classId,
  subclass,
  background,
  raceId,
}: {
  features: Array<{ name: string; source?: string; level?: number; classId?: string }>;
  classId: string;
  subclass?: string | null;
  // The sheet's background id: a content-pack background's feature opens
  // its row for the text the bundled tables lack.
  background?: string | null;
  // The sheet's species, so its racial traits read in the reader's language.
  raceId?: string;
}) {
  // A genre class's feature text arrives on demand (issue 411).
  const t = useT();
  const locale = useLocale();
  useClassFeatureText([classId, ...features.map((feature) => feature.classId)]);
  return (
    <InfoChipList
      items={features.map((feature) => ({
        // The class's own features read in the reader's language, as do the
        // species' trait lines and the background's granted feature; a story
        // feature stays as the DM wrote it.
        name:
          feature.source === "story"
            ? feature.name
            : feature.source === "race" && raceId
              ? speciesTraitName(raceId, feature.name, locale)
              : feature.source === "background"
                ? backgroundFeatureName(feature.name, locale)
                : classFeatureName(feature.classId ?? classId, feature.name, locale),
        icon: { kind: "feature" as const, key: feature.name, family: `class-${classId.toLowerCase()}` },
        note: feature.source === "story" ? t("(story)") : undefined,
        meta: feature.level ? t("Level {level}", { level: feature.level }) : undefined,
        text: describeFeature(classId, subclass ?? "", feature.name, locale) ?? undefined,
        reference: backgroundFeatureReference(feature, background, classId, subclass ?? "") ?? undefined,
      }))}
    />
  );
}

export function FeatChips({ feats, classId, subclass }: { feats: string[]; classId: string; subclass?: string | null }) {
  const locale = useLocale();
  return (
    <InfoChipList
      items={feats.map((feat) => ({
        // The stored English name reads in the reader's language (the
        // official maps); the reference lookup stays the stored name.
        name: contentName("feats", feat, locale),
        icon: { kind: "feat" as const, key: feat },
        text: describeFeature(classId, subclass ?? "", feat, locale) ?? undefined,
        reference: { kind: "feats", slug: contentSlug(feat), name: feat },
      }))}
    />
  );
}

export function ConditionChips({
  conditions,
  rounds,
  detail,
}: {
  conditions: string[];
  rounds?: Record<string, { rounds?: number } | undefined>;
  // What the condition's stored metadata says beyond a count of rounds:
  // "until Kael's turn", "save ends (WIS 13)", "from Goblin 2"
  // (src/components/sheet/sheet-state.ts conditionDetail). When given it
  // replaces the rounds tail, which it already includes.
  detail?: (condition: string) => string;
}) {
  const locale = useLocale();
  return (
    <div className="stagger-pop flex flex-wrap gap-1.5">
      {conditions.map((condition) => {
        const said = detail?.(condition) ?? "";
        return (
          <span key={condition} className="sheet-condition motion-pop" title={said || undefined}>
            <GameIcon icon={{ kind: "condition", key: conditionIconKey(condition) }} size="size-5" />
            {contentName("conditions", condition, locale)}
            {detail
              ? said
                ? ` (${said})`
                : ""
              : rounds?.[condition]?.rounds
                ? ` (${describeConditionDuration(rounds[condition]?.rounds ?? 0)})`
                : ""}
          </span>
        );
      })}
    </div>
  );
}
