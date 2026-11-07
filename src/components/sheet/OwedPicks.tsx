"use client";

import { Check, Loader2 } from "lucide-react";
import { useId, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { replayAnimation } from "@/lib/motion/replay";
import { STANDARD_LANGUAGES } from "@/lib/content/mechanics";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { fightingStyleFeatureName } from "@/lib/srd/feature-effects";
import { optionCost, optionFeatureName, remainingWords, slotTakes, type OptionSlot } from "@/lib/srd/options";
import { owedChoiceGroups, owedChoicesSentences } from "@/lib/srd/owed-choices";
import { owedPickSlots } from "@/lib/srd/owed-picks-logic";
import { subclassChoicePickName, subclassChoiceSummary } from "@/lib/content/subclass-choices";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";
import { textKey } from "@/lib/language/text-logic";

// The picks a character's levels earned and no level-up offered, made right
// on the sheet (issue #833): a sorcerer saved before Dragon Ancestor was a
// pick, a level 20 hero, or one whose next level goes to another class was
// never asked for it, and the engines that read it read nothing. The pick is
// the player's: a pill per option, the chosen one's rules under the row, and
// "Keep" to save it through POST /sheet/owed, which holds it to the slots
// the classes give (src/lib/srd/owed-picks-logic.ts). An older host has no
// such route: the sheet then only lists what is owed.
// The block's words come first, each true for what it lists: the next
// level-up takes the class's own choices, and a class feature's picks are
// made here, on the player's own sheet, or at a level-up that offers them
// on a host without the route (owed-choices.ts owedChoicesSentences).
export function OwedPicks({ sheet, mine }: { sheet: CharacterSheet; mine: boolean }) {
  const offered = hostOffers(useCapabilities(), "owedPicks");
  const owed = owedPickSlots(sheet);
  const where = !mine ? "owner" : offered ? "here" : "level-up";
  const sentences = owedChoicesSentences(owedChoiceGroups(sheet), where);
  const pickers = where === "here" && (owed.options.length > 0 || owed.choices.length > 0 || owed.styles.count > 0 || owed.training.length > 0);
  return (
    <>
      {sentences.map((line) => (
        <p key={line} className="text-sm text-amber-200/90">
          {line}
        </p>
      ))}
      {pickers ? <OwedPickers sheet={sheet} owed={owed} /> : null}
    </>
  );
}

function OwedPickers({ sheet, owed }: { sheet: CharacterSheet; owed: ReturnType<typeof owedPickSlots> }) {
  return (
    <div className="reveal mt-3 space-y-3">
      {owed.options.map((slot) => (
        <SlotPicker key={slot.kind} sheet={sheet} slot={slot} />
      ))}
      {/* A workshop subclass's own choice (issue #833), saved as "Bloodline
          (Storm)" and judged by the route against the table's subclasses. */}
      {owed.choices.map((choice) => (
        <SlotPicker
          key={`${choice.classId}|${choice.label}`}
          sheet={sheet}
          slot={{
            kind: "invocation",
            label: `${choice.label} (${choice.subclass})`,
            total: 1,
            chosen: [],
            remaining: 1,
            options: choice.options.map((option) => ({
              k: "invocation",
              n: option.name,
              d: [option.description, subclassChoiceSummary(option)].filter(Boolean).join(" "),
            })),
          }}
          featureOf={(name) => subclassChoicePickName(choice.label, { name })}
        />
      ))}
      {owed.styles.count > 0 ? (
        <SlotPicker
          sheet={sheet}
          slot={{
            kind: "invocation",
            label: "Fighting style",
            total: owed.styles.count,
            chosen: [],
            remaining: owed.styles.count,
            options: owed.styles.choices.map((style) => ({ k: "invocation", n: style.name, d: style.description })),
          }}
          featureOf={(name) => {
            const style = owed.styles.choices.find((entry) => entry.name === name);
            return style ? fightingStyleFeatureName(style.id) : name;
          }}
        />
      ) : null}
      {owed.training.map((grant) => (
        <LanguagePicker key={grant.name} sheet={sheet} grant={grant.name} />
      ))}
    </div>
  );
}

async function sendOwed(sheet: CharacterSheet, body: Record<string, unknown>): Promise<string | null> {
  try {
    const response = await fetch(`/api/campaigns/${sheet.campaignId}/sheet/owed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId: sheet.id, ...body }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      return data.error || "The pick was refused.";
    }
    return null;
  } catch {
    return "Could not reach the server.";
  }
}

function SlotPicker({
  sheet,
  slot,
  featureOf = (name) => optionFeatureName(slot.kind, name),
}: {
  sheet: CharacterSheet;
  slot: OptionSlot;
  featureOf?: (name: string) => string;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const refusalRef = useRef<HTMLParagraphElement>(null);
  const labelId = useId();
  const chosen = new Set(slot.chosen.map(textKey));
  const options = slot.options.filter((option) => !chosen.has(textKey(option.n)));
  const spent = picked.reduce((sum, name) => sum + optionCost(options.find((option) => option.n === name) ?? {}), 0);
  const left = { remaining: slot.remaining - spent };
  const last = options.find((option) => option.n === picked[picked.length - 1]);

  function toggle(name: string) {
    setRefusal(null);
    setPicked((current) => {
      if (current.includes(name)) {
        return current.filter((entry) => entry !== name);
      }
      const option = options.find((entry) => entry.n === name);
      if (option && slotTakes(left, option)) {
        return [...current, name];
      }
      // One pick left to make: the new one takes the place of the last.
      return slot.remaining <= 1 && option && slotTakes(slot, option) ? [name] : current;
    });
  }

  async function keep() {
    setBusy(true);
    const error = await sendOwed(sheet, { features: picked.map(featureOf) });
    setBusy(false);
    if (error) {
      setRefusal(error);
      replayAnimation(refusalRef.current, "shake-x var(--dur-beat) var(--ease-snap) both");
      return;
    }
    setPicked([]);
  }

  return (
    <div className="space-y-1.5 text-xs" role="group" aria-labelledby={labelId}>
      <p id={labelId} className="text-stone-300">
        <span className="font-medium text-amber-100">{slot.label}</span>{" "}
        <span className="text-stone-400">({remainingWords(slot)})</span>
      </p>
      <div className="flex flex-wrap gap-1.5" data-pill-group>
        {options.map((option, index) => {
          const on = picked.includes(option.n);
          const fits = on || slotTakes(left, option) || (slot.remaining <= 1 && slotTakes(slot, option));
          return (
            <button
              key={option.n}
              type="button"
              aria-pressed={on}
              data-on={on ? "" : undefined}
              disabled={busy || !fits}
              style={{ "--i": index } as CSSProperties}
              onClick={() => toggle(option.n)}
              title={option.d}
              className={cn(
                "hand-option motion-press inline-flex min-h-[40px] items-center gap-1 rounded-full border px-3 sm:min-h-[32px]",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400",
                on ? "border-amber-400/70 bg-amber-500/20 text-amber-100" : "border-stone-600 text-stone-300 hover:border-amber-500/60",
                "disabled:cursor-default disabled:opacity-50",
              )}
            >
              {on ? <Check className="size-3" aria-hidden /> : null}
              {option.n}
            </button>
          );
        })}
      </div>
      {last ? (
        <p key={last.n} className="animate-fade-up text-[11px] text-stone-400">
          <span className="text-stone-200">{last.n}:</span> {last.d}
        </p>
      ) : null}
      {picked.length ? (
        <button
          type="button"
          onClick={() => void keep()}
          disabled={busy}
          className="motion-press inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-amber-500/60 bg-amber-500/15 px-3 text-amber-100 hover:bg-amber-500/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 sm:min-h-[32px]"
        >
          {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Check className="size-3" aria-hidden />}
          Keep {picked.join(" and ")}
        </button>
      ) : null}
      {refusal ? (
        <p ref={refusalRef} role="alert" className="animate-fade-up text-[11px] text-amber-300">
          {refusal}
        </p>
      ) : null}
    </div>
  );
}

// A language a class feature teaches and the sheet never recorded (a
// ranger's Favored Enemy: one spoken by the favored enemy).
function LanguagePicker({ sheet, grant }: { sheet: CharacterSheet; grant: string }) {
  const [language, setLanguage] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const selectId = useId();
  const spoken = new Set(sheet.proficiencies.languages.map(textKey));
  const options = STANDARD_LANGUAGES.filter((entry) => !spoken.has(textKey(entry)));

  async function keep() {
    setBusy(true);
    const error = await sendOwed(sheet, { featChoices: { [grant]: { languages: [language] } } });
    setBusy(false);
    setRefusal(error);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label htmlFor={selectId} className="text-stone-300">
        {grant}: a language they speak
      </label>
      <select
        id={selectId}
        value={language}
        onChange={(event) => setLanguage(event.target.value)}
        disabled={busy}
        className="min-h-[40px] rounded-lg border border-stone-600 bg-stone-950 px-2 text-stone-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 sm:min-h-[32px]"
      >
        <option value="">Choose a language</option>
        {options.map((entry) => (
          <option key={entry} value={entry}>
            {entry}
          </option>
        ))}
      </select>
      {language ? (
        <button
          type="button"
          onClick={() => void keep()}
          disabled={busy}
          className="motion-press inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-amber-500/60 bg-amber-500/15 px-3 text-amber-100 hover:bg-amber-500/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 sm:min-h-[32px]"
        >
          {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Check className="size-3" aria-hidden />}
          Keep {language}
        </button>
      ) : null}
      {refusal ? (
        <p role="alert" className="w-full animate-fade-up text-[11px] text-amber-300">
          {refusal}
        </p>
      ) : null}
    </div>
  );
}
