"use client";

import { useId } from "react";
import { InfoButton } from "@/components/ui/InfoDialog";
import { ATTRACTION_CHOICES, ATTRACTION_NOTE_MAX, openToMore, type Attraction } from "@/lib/attraction";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";
import { useLocale, useT } from "@/lib/locale";

const CHIP =
  "inline-flex h-10 items-center rounded-full border border-stone-700/70 bg-stone-950/60 px-3 text-xs text-stone-300 transition-colors duration-150 hover:border-amber-500/40 hover:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 aria-pressed:border-rose-400/60 aria-pressed:bg-rose-500/10 aria-pressed:text-rose-100 motion-press";

// The chip labels, in the reader's language (the MonsterFields
// SIZE_WORDS_FR pattern): the words the DM reads and the values the note
// matching compares stay the English attraction.ts carries.
const CHOICE_LABELS_FR: Record<string, string> = {
  Women: "Femmes",
  Men: "Hommes",
  "Nonbinary people": "Personnes non binaires",
};

// "Drawn to" (issue 501): who a character or an NPC could fall for, as
// chips beside their gender and a short note. One tap picks or drops a
// chip; nothing picked means unspecified. A real group with a visible label,
// each chip a pressed-or-not button at the kit's 40px, so it reads and works
// the same by keyboard, by finger and to a screen reader.
export function AttractionPicker({
  value,
  onChange,
  hintKey,
  className,
}: {
  value: Attraction;
  onChange: (next: Attraction) => void;
  // The ⓘ text's message key: what blank means differs for a character and
  // an NPC. Read here, in the reader's language.
  hintKey: string;
  className?: string;
}) {
  const labelId = useId();
  const t = useT();
  const locale = useLocale();
  // Open to more than one partner (issue 642), beside who they are drawn to
  // because it is the same kind of fact about them. Off is the default and
  // most tables never touch it; a host from before it would drop it unsaved.
  const offersOpen = hostOffers(useCapabilities(), "openRelationships");
  const open = openToMore(value);
  return (
    <div role="group" aria-labelledby={labelId} className={cn("min-w-0", className)} data-attraction-picker>
      <span className="mb-1 flex items-center gap-1 text-xs text-stone-400">
        <span id={labelId}>{t("Drawn to")}</span>
        <InfoButton label={t("Drawn to")} text={t(hintKey)} />
      </span>
      <span className="flex flex-wrap gap-1.5">
        {ATTRACTION_CHOICES.map((choice) => {
          const on = value.genders.includes(choice.gender);
          return (
            <button
              key={choice.gender}
              type="button"
              aria-pressed={on}
              onClick={() =>
                onChange({
                  ...value,
                  genders: on
                    ? value.genders.filter((gender) => gender !== choice.gender)
                    : ATTRACTION_CHOICES.map((entry) => entry.gender).filter(
                        (gender) => gender === choice.gender || value.genders.includes(gender),
                      ),
                })
              }
              className={CHIP}
            >
              {locale === "fr" ? (CHOICE_LABELS_FR[choice.label] ?? choice.label) : choice.label}
            </button>
          );
        })}
      </span>
      <input
        value={value.note}
        maxLength={ATTRACTION_NOTE_MAX}
        onChange={(event) => onChange({ ...value, note: event.target.value })}
        placeholder={t("A note, if it needs one (optional)")}
        aria-label={t("Drawn to: a note")}
        className={cn(ui.input, "mt-1.5 h-10")}
      />
      {offersOpen ? (
        <span className="mt-1.5 flex items-center gap-1">
          <button
            type="button"
            aria-pressed={open}
            onClick={() => onChange({ genders: value.genders, note: value.note, ...(open ? {} : { open: true }) })}
            className={CHIP}
            data-open-relationship
          >
            {t("Open to more than one partner", { context: "attraction.openToggle" })}
          </button>
          <InfoButton label={t("Open to more than one partner", { context: "attraction.openToggle" })} text={t(OPEN_RELATIONSHIP_HINT)} />
        </span>
      ) : null}
    </div>
  );
}

// The ⓘ texts, as the message keys the picker reads in the reader's
// language (the strings themselves live in the dictionaries).
export const CHARACTER_ATTRACTION_HINT = "Who your character could fall for. Leave it blank and nothing changes; it only matters at a table with romance on, where an NPC who courts your character is one this fits.";

export const OPEN_RELATIONSHIP_HINT = "Off, the usual, they keep to one partner: while they are with someone, nobody new courts them and they court nobody new. On, they may have more than one, as long as everyone in it is open too. A partner who is not open still minds a flirt in front of them. Where a whole culture lives this way, say so in the campaign's world notes.";

export const NPC_ATTRACTION_HINT = "Who they could fall for. Blank means not decided yet: the GM settles it the first time it matters, and it then stays.";
