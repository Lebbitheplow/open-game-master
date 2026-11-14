"use client";

import { Check, Leaf, Sparkles, Church } from "lucide-react";
import { APPEARANCE_THEMES, themeArtStyle, type AppearanceChoice } from "@/lib/appearance-themes";
import { useThemePrefs, writeAppearanceChoice, writeThemeChoice, type ThemeChoice } from "@/lib/theme-mode";

const ICONS = { sparkles: Sparkles, leaf: Leaf, church: Church };
const BRIGHTNESS: Array<{ id: ThemeChoice; label: string }> = [
  { id: "auto", label: "System" }, { id: "light", label: "Light" }, { id: "dark", label: "Dark" },
];

export function AppearancePicker() {
  const { choice, mode, appearanceChoice, appearance } = useThemePrefs();
  const pick = (value: AppearanceChoice) => writeAppearanceChoice(value);
  return (
    <div className="appearance-picker">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="appearance-follow" aria-pressed={appearanceChoice === "campaign"} onClick={() => pick("campaign")}>
          <span className="appearance-check" aria-hidden="true">{appearanceChoice === "campaign" ? <Check size={14} /> : null}</span>
          Follow campaign
        </button>
        <div className="appearance-brightness" role="group" aria-label="Brightness">
          {BRIGHTNESS.map((entry) => (
            <button type="button" key={entry.id} aria-pressed={choice === entry.id} onClick={() => writeThemeChoice(entry.id)}>{entry.label}</button>
          ))}
        </div>
      </div>
      <div className="appearance-grid" role="group" aria-label="Visual theme">
        {APPEARANCE_THEMES.map((entry) => {
          const Icon = ICONS[entry.icon];
          const selected = appearanceChoice === entry.id;
          return (
            <button type="button" key={entry.id} aria-pressed={selected} onClick={() => pick(entry.id)} className="appearance-option">
              <span className="appearance-preview" data-appearance={entry.id} data-theme={mode} style={themeArtStyle(entry.id)} aria-hidden="true">
                <span className="appearance-preview-frame"><Icon size={28} strokeWidth={1.2} /><span className="appearance-preview-title">The adventure awaits</span><span className="appearance-preview-line" /><span className="appearance-preview-line appearance-preview-line-short" /></span>
              </span>
              <span className="appearance-option-copy"><span className="appearance-option-title">{entry.name}{selected ? <Check size={16} aria-hidden="true" /> : null}</span><span className="appearance-option-description">{entry.description}</span></span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-stone-400" aria-live="polite">Using {APPEARANCE_THEMES.find((entry) => entry.id === appearance)?.name}{appearanceChoice === "campaign" ? " · following campaign" : " · personal choice"}.</p>
      <p className="mt-1 text-xs leading-relaxed text-stone-400">Follow campaign uses the table’s chosen theme, with Arcane elsewhere. Pick a theme to use it everywhere on this device. Brightness always stays your choice.</p>
    </div>
  );
}
