"use client";

import { PageSection } from "@/components/PageShell";
import { AppearancePicker } from "@/components/AppearancePicker";
import { Slider } from "@/components/ui/Slider";
import { ui } from "@/lib/ui";
import { useUiLanguageChoice, writeUiLanguageChoice } from "@/lib/ui-language";
import type { UiLanguageChoice } from "@/lib/language/ui-translate-logic";
import { UI_SCALE_MAX, UI_SCALE_MIN, useThemePrefs, writeUiScale } from "@/lib/theme-mode";

// The interface's language (docs/specs/ogm-italian-ui.md). A language's own
// name is never translated, so it reads the same in either.
const LANGUAGES: Array<{ id: UiLanguageChoice; label: string; own?: true }> = [
  { id: "auto", label: "Follow the browser" },
  { id: "english", label: "English", own: true },
  { id: "italian", label: "Italiano", own: true },
];

export function AppearanceSection() {
  const { scale } = useThemePrefs();
  const language = useUiLanguageChoice();
  return (
    <PageSection
      heading="Appearance"
      glyph="sense-darkvision"
      intro="Kept on this device. The board and its canvases draw at their own size whatever the scale."
    >
      <AppearancePicker />
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
