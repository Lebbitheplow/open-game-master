"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { ThemeIcon } from "@/components/ThemeIcon";
import { APPEARANCE_THEMES, genreShortlist, themeArt, themeArtStyle, type AppearanceTheme, type CampaignAppearance } from "@/lib/appearance-themes";
import { useThemePanel, useThemePrefs, writeAppearanceChoice, writeThemeChoice, type ThemeChoice } from "@/lib/theme-mode";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";

// "Match device" was "System": a reader took that for the campaign's genre.
const BRIGHTNESS: Array<{ id: ThemeChoice; label: string }> = [
  { id: "auto", label: "Match device" }, { id: "light", label: "Light" }, { id: "dark", label: "Dark" },
];
const GENRE_WORDS: Record<string, string> = { post_apocalyptic: "post-apocalyptic" };
const genreWords = (genre: string) => GENRE_WORDS[genre] ?? genre.replace(/_/g, " ");

// One picker for both theme choices: the reader's own screen, and (for whoever
// runs the table) the theme every seat follows. "panel" lays the cards out for
// the side panel and the phone sheet; "grid" is the Settings page's own block.
export function AppearancePicker({ layout = "grid" }: { layout?: "grid" | "panel" }) {
  const { choice, mode, appearanceChoice, appearance } = useThemePrefs();
  const { table, control, tableTheme } = useThemePanel();
  const capabilities = useCapabilities();
  const maySetTable = Boolean(table && control?.canSet && hostOffers(capabilities, "appearanceThemes"));
  const [wantsTable, setWantsTable] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState("");
  const forTable = maySetTable && wantsTable;
  const tableSetting: CampaignAppearance = table?.setting ?? "genre";
  const selected: AppearanceTheme | null = forTable ? (tableSetting === "genre" ? null : tableSetting) : appearanceChoice === "campaign" ? null : appearanceChoice;
  const following = selected === null;

  // The one in use always shows, whatever the genre would leave out. No theme
  // suits "custom", so a custom table gets the whole catalog.
  const genre = table?.genre;
  const shortlist = genreShortlist(genre, APPEARANCE_THEMES, [appearance, tableTheme]);
  const shown = shortlist && !showAll ? APPEARANCE_THEMES.filter((entry) => shortlist.includes(entry.id)) : APPEARANCE_THEMES;

  async function setTable(appearanceTheme: CampaignAppearance) {
    if (!control) return;
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${control.campaignId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appearanceTheme }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "That change was not saved.");
      }
    } catch {
      setError("Could not reach the server.");
    }
  }
  const pick = (value: AppearanceTheme | null) => (forTable ? void setTable(value ?? "genre") : writeAppearanceChoice(value ?? "campaign"));
  // A personal theme hides what the table's choice does to this screen.
  const ownHidesTable = forTable && appearanceChoice !== "campaign";

  return (
    <div className="appearance-picker" data-layout={layout} data-scope={forTable ? "table" : "me"}>
      <div className="appearance-controls">
        {maySetTable ? (
          <div className="appearance-brightness appearance-scope" role="group" aria-label="Who the theme is for">
            <button type="button" aria-pressed={!forTable} onClick={() => setWantsTable(false)}>My screen</button>
            <button type="button" aria-pressed={forTable} onClick={() => setWantsTable(true)}>Whole table</button>
          </div>
        ) : null}
        <div className="appearance-brightness" role="group" aria-label="Brightness">
          {BRIGHTNESS.map((entry) => (
            <button type="button" key={entry.id} aria-pressed={choice === entry.id} onClick={() => writeThemeChoice(entry.id)}>{entry.label}</button>
          ))}
        </div>
      </div>
      <button type="button" className="appearance-follow" aria-pressed={following} onClick={() => pick(null)}>
        <span className="appearance-check" aria-hidden="true">{following ? <Check size={14} /> : null}</span>
        {forTable ? "Match the genre" : table ? "Same as the table" : "Follow campaign"}
      </button>
      {shortlist && genre ? <p className="appearance-note">{showAll ? "Every theme." : `Themes that suit ${genreWords(genre)}.`}</p> : null}
      <div className="appearance-grid" role="group" aria-label="Visual theme">
        {shown.map((entry) => {
          const pressed = selected === entry.id;
          const art = themeArt(entry.id, mode);
          return (
            <button type="button" key={entry.id} aria-pressed={pressed} onClick={() => pick(entry.id)} className="appearance-option">
              <span className="appearance-preview" data-appearance={entry.id} data-theme={mode} data-theme-ornaments={Boolean(art?.frame || art?.corner)} style={themeArtStyle(entry.id, mode)} aria-hidden="true">
                <span className="appearance-preview-frame"><ThemeIcon icon={entry.icon} size={28} strokeWidth={1.2} /><span className="appearance-preview-title">The adventure awaits</span><span className="appearance-preview-line" /><span className="appearance-preview-line appearance-preview-line-short" /></span>
              </span>
              <span className="appearance-option-copy"><span className="appearance-option-title">{entry.name}{pressed ? <Check size={16} aria-hidden="true" /> : null}</span><span className="appearance-option-description">{entry.description}</span></span>
            </button>
          );
        })}
      </div>
      {shortlist ? (
        <button type="button" className="appearance-more" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
          {showAll ? `Show only themes that suit ${genreWords(genre ?? "")}` : `Show all ${APPEARANCE_THEMES.length} themes`}
        </button>
      ) : null}
      {error ? <p className="appearance-note text-red-300" role="alert">{error}</p> : null}
      {ownHidesTable ? (
        <p className="appearance-note">
          Your own screen is set to {APPEARANCE_THEMES.find((entry) => entry.id === appearance)?.name}, so it does not show the table’s theme.{" "}
          <button type="button" className="appearance-link" onClick={() => writeAppearanceChoice("campaign")}>Show the table’s theme here</button>
        </p>
      ) : null}
      <p className="appearance-note" aria-live="polite">
        {forTable
          ? `The table uses ${APPEARANCE_THEMES.find((entry) => entry.id === tableTheme)?.name}${tableSetting === "genre" ? ", from its genre" : ""}. Every player sees it unless they pick their own.`
          : `Using ${APPEARANCE_THEMES.find((entry) => entry.id === appearance)?.name}${appearanceChoice === "campaign" ? (table ? " · same as the table" : " · following campaign") : " · personal choice"}.`}
      </p>
      {forTable ? null : <p className="appearance-note">{table ? "Same as the table uses the theme this table chose." : "Follow campaign uses the table’s chosen theme, with Arcane elsewhere."} Pick a theme to use it everywhere on this device. Brightness always stays your choice.</p>}
    </div>
  );
}
