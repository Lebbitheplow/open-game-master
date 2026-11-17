"use client";
// The workshop's controls for the standing effects an SRD item's text gives
// beyond a bonus, a set score and a resistance (src/lib/srd/magic-items.ts):
// a raised score (Belt of Dwarvenkind), an immunity (Periapt of Proof
// against Poison), a speed (Winged Boots), a spell attack or DC bonus (Robe
// of the Archmagi), and a weapon's training and damage (Bracers of Archery).
// Without them a copied item lost what it does on a sheet.

import type { ComponentProps } from "react";
import { IMMUNE_CONDITIONS, SPEED_MODES } from "@/lib/homebrew/item-data";
import type { MagicItemEffect } from "@/lib/srd/magic-items";
import { SRD_WEAPONS, UNARMED_STRIKE_KEY } from "@/lib/srd/weapons";
import { textKey } from "@/lib/language/text-logic";
import { damageTypeWord } from "@/lib/dm/damage-logic";
import { contentName } from "@/lib/content/names";
import { useLocale, useT } from "@/lib/locale";
import type { Locale } from "@/lib/messages-logic";
import { CheckField, ToggleChips } from "@/app/workshop/homebrew/fields";
import { DAMAGE_TYPES } from "@/app/workshop/homebrew/types";
import { FieldLabel } from "@/app/workshop/kit";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Select } from "@/components/ui/Select";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
// Speed words in the reader's language: the EN labels upstream shipped, and
// the movement words the French SRD's stat blocks print (MonsterKitFields'
// movement family: « vol », « nage », « escalade »), capitalized here as the
// picker's options. Values stay the SPEED_MODES ids.
const SPEED_LABELS: Record<(typeof SPEED_MODES)[number], string> = { fly: "Flying", swim: "Swimming", climb: "Climbing" };
const SPEED_LABELS_FR: Record<string, string> = { fly: "Vol", swim: "Nage", climb: "Escalade" };
const speedLabel = (mode: string, locale: Locale): string =>
  locale === "fr" ? (SPEED_LABELS_FR[mode] ?? SPEED_LABELS[mode as (typeof SPEED_MODES)[number]]) : SPEED_LABELS[mode as (typeof SPEED_MODES)[number]];
// The unarmed strike, then the SRD's own weapons, by the key the attack engine
// matches them on. Labels read the reader's language through the names layer
// (the unarmed strike's FR print is official; the SRD weapons' names are data).
const WEAPON_KEYS = [UNARMED_STRIKE_KEY, ...SRD_WEAPONS.filter((weapon) => weapon.category === "simple" || weapon.category === "martial").map((weapon) => textKey(weapon.name))];
const WEAPON_LABELS = { [UNARMED_STRIKE_KEY]: "Unarmed strike", ...Object.fromEntries(SRD_WEAPONS.map((weapon) => [textKey(weapon.name), weapon.name])) };
// The chips' words: damage types capitalized out of the French SRD's own list
// (damageTypeWord's pattern, src/lib/dm/damage-logic.ts), conditions through
// the official names layer. English keeps the raw term, exactly as shipped.
const capital = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const damageLabel = (type: string, locale: Locale): string => (locale === "fr" ? capital(damageTypeWord(type, locale)) : type);
const conditionLabel = (term: string, locale: Locale): string => contentName("conditions", term, locale);

export const MORE_EFFECT_LABELS = {
  increase_ability: "Raises an ability score",
  immunity: "Damage immunity",
  condition_immunity: "Condition immunity",
  spell_attack_bonus: "Spell attack bonus",
  spell_dc_bonus: "Spell save DC bonus",
  spell_save_advantage: "Advantage on saves against spells",
  speed: "A speed",
  weapon_rider: "Training and bonuses with weapons",
} as const;

// What a newly picked kind starts as, each the SRD's commonest.
export function startingEffect(kind: MagicItemEffect["kind"]): MagicItemEffect {
  switch (kind) {
    case "set_ability":
      return { kind, ability: "str", score: 19 };
    case "resistance":
      return { kind, types: ["fire"] };
    case "increase_ability":
      return { kind, ability: "con", amount: 2, max: 20 };
    case "immunity":
      return { kind, types: ["poison"] };
    case "condition_immunity":
      return { kind, conditions: ["poisoned"] };
    case "spell_save_advantage":
      return { kind };
    case "speed":
      return { kind, mode: "fly", feet: "walk" };
    case "weapon_rider":
      return { kind, weapons: ["longbow", "shortbow"], ranged: true, damage: 2, proficient: true };
    default:
      return { kind, amount: 1 };
  }
}

// A stepper in a standing effect's row, with its caption in the form's
// caption style. The row is one line of controls, so the caption sits beside
// the figure rather than above it, and the same words name the stepper for a
// screen reader. Without it the Belt of Dwarvenkind's row read "2" and "20"
// with only the summary at its end to say which was which.
export function EffectStepper({ label, ...stepper }: ComponentProps<typeof NumberStepper>) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <NumberStepper label={label} {...stepper} />
    </span>
  );
}

const abilityOptions = ABILITIES.map((ability) => ({
  value: ability,
  label: ability.toUpperCase(),
  icon: { kind: "glyph" as const, key: `ability-${ability}` },
}));

export function MoreEffectFields({ effect, update }: { effect: MagicItemEffect; update: (next: MagicItemEffect) => void }) {
  const t = useT();
  const locale = useLocale();
  switch (effect.kind) {
    case "increase_ability":
      return (
        <>
          <span className="w-32">
            <Select value={effect.ability} label={t("Ability")} options={abilityOptions} onChange={(ability) => update({ ...effect, ability })} />
          </span>
          <EffectStepper label={t("Raised by", { context: "workshop.homebrew.itemEffect.raisedBy" })} value={effect.amount} min={1} max={4} onChange={(amount) => update({ ...effect, amount })} />
          <EffectStepper label={t("To at most")} value={effect.max} min={3} max={30} onChange={(max) => update({ ...effect, max })} />
        </>
      );
    case "immunity":
      return <ToggleChips options={DAMAGE_TYPES} labels={Object.fromEntries(DAMAGE_TYPES.map((type) => [type, damageLabel(type, locale)]))} selected={effect.types} onChange={(types) => update({ ...effect, types })} />;
    case "condition_immunity":
      return <ToggleChips options={IMMUNE_CONDITIONS} labels={Object.fromEntries(IMMUNE_CONDITIONS.map((term) => [term, conditionLabel(term, locale)]))} selected={effect.conditions} onChange={(conditions) => update({ ...effect, conditions })} />;
    case "speed":
      return (
        <>
          <span className="w-36">
            <Select
              value={effect.mode}
              label={t("Speed")}
              options={SPEED_MODES.map((mode) => ({ value: mode, label: speedLabel(mode, locale) }))}
              onChange={(mode) => update({ ...effect, mode })}
            />
          </span>
          <CheckField
            label={t("Equal to walking speed")}
            checked={effect.feet === "walk"}
            onChange={(on) => update({ ...effect, feet: on ? "walk" : 30 })}
          />
          {effect.feet === "walk" ? null : (
            <EffectStepper label={t("Feet")} value={effect.feet} min={5} max={120} step={5} onChange={(feet) => update({ ...effect, feet })} />
          )}
        </>
      );
    case "weapon_rider":
      return (
        <>
          <ToggleChips options={WEAPON_KEYS} selected={effect.weapons} labels={{ ...WEAPON_LABELS, [UNARMED_STRIKE_KEY]: contentName("weapons", "Unarmed strike", locale) }} max={8} onChange={(weapons) => update({ ...effect, weapons, ranged: weapons.includes(UNARMED_STRIKE_KEY) ? undefined : effect.ranged })} />
          <CheckField label={t("Trained with them")} checked={effect.proficient === true} onChange={(on) => update({ ...effect, proficient: on || undefined })} />
          <EffectStepper label={t("Bonus to hit")} value={effect.attack ?? 0} min={0} max={3} onChange={(attack) => update({ ...effect, attack: attack || undefined })} />
          <EffectStepper label={t("Extra damage")} value={effect.damage ?? 0} min={0} max={3} onChange={(damage) => update({ ...effect, damage: damage || undefined })} />
          {/* A fist is never at range: left on, the effect would silently never apply. */}
          {effect.weapons.includes(UNARMED_STRIKE_KEY) ? null : (
            <CheckField label={t("Only at range")} checked={effect.ranged === true} onChange={(on) => update({ ...effect, ranged: on || undefined })} />
          )}
        </>
      );
    default:
      return null;
  }
}
