"use client";

import { PageSection } from "@/components/PageShell";
import { GameIcon } from "@/components/ui/GameIcon";
import { Slider } from "@/components/ui/Slider";
import { ui } from "@/lib/ui";
import { useUiLanguageChoice, writeUiLanguageChoice } from "@/lib/ui-language";
import type { UiLanguageChoice } from "@/lib/language/ui-translate-logic";
import { UI_SCALE_MAX, UI_SCALE_MIN, useThemePrefs, writeThemeChoice, writeUiScale, type ThemeChoice } from "@/lib/theme-mode";

// Appearance (docs/vtt-parity-implementation-plan.md section 14): the night
// or the day theme, the OS's choice by default, and how large the interface
// reads. Both are kept on this device, not on the account.
const CHOICES: Array<{ id: ThemeChoice; label: string; glyph: string }> = [
  { id: "auto", label: "Follow the system", glyph: "daypart-dusk" },
  { id: "dark", label: "Arcane night", glyph: "daypart-night" },
  { id: "light", label: "Parchment day", glyph: "daypart-day" },
];

// The interface's language (docs/specs/ogm-italian-ui.md). A language's own
// name is never translated, so it reads the same in either.
const LANGUAGES: Array<{ id: UiLanguageChoice; label: string; own?: true }> = [
  { id: "auto", label: "Follow the browser" },
  { id: "english", label: "English", own: true },
  { id: "italian", label: "Italiano", own: true },
];

export function AppearanceSection() {
  const { choice, scale } = useThemePrefs();
  const language = useUiLanguageChoice();
  return (
    <PageSection
      heading="Appearance"
      glyph="sense-darkvision"
      intro="Kept on this device. The board and its canvases draw at their own size whatever the scale."
    >
      <div data-pill-group="" role="group" aria-label="Theme" className="flex flex-wrap gap-2">
        {CHOICES.map((entry) => (
          <button
            data-on={choice === entry.id ? "" : undefined}
            key={entry.id}
            type="button"
            aria-pressed={choice === entry.id}
            onClick={() => writeThemeChoice(entry.id)}
            className="theme-card motion-press"
          >
            <GameIcon icon={{ kind: "glyph", key: entry.glyph }} size="size-8" /> {entry.label}
          </button>
        ))}
      </div>
      <div className="mt-4 text-xs text-stone-400">
        <p className="mb-1">Interface language</p>
        <div data-pill-group="" role="group" aria-label="Interface language" className="flex flex-wrap gap-2">
          {LANGUAGES.map((entry) => (
            <button
              data-on={language === entry.id ? "" : undefined}
              key={entry.id}
              type="button"
              aria-pressed={language === entry.id}
              onClick={() => writeUiLanguageChoice(entry.id)}
              translate={entry.own ? "no" : undefined}
              className="theme-card motion-press"
            >
              {entry.label}
            </button>
          ))}
        </div>
        <p className="mt-1">The story, names and what players write stay as they are.</p>
      </div>
      <div className="mt-4 text-xs text-stone-400">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span>Interface scale</span>
          <span className="flex items-center gap-2">
            <span className="tabular-nums text-stone-300">{Math.round(scale * 100)}%</span>
            {scale !== 1 ? (
              <button type="button" onClick={() => writeUiScale(1)} className={`${ui.btnSmall} reveal-pop px-2 py-1 text-[11px]`}>
                Reset
              </button>
            ) : null}
          </span>
        </div>
        <Slider
          label="Interface scale"
          min={UI_SCALE_MIN}
          max={UI_SCALE_MAX}
          step={0.05}
          value={scale}
          onChange={writeUiScale}
          bubble={(value) => `${Math.round(value * 100)}%`}
        />
      </div>
    </PageSection>
  );
}
