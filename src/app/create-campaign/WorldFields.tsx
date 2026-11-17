"use client";

import { ImageIcon } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { InfoButton } from "@/components/ui/InfoDialog";
import { EmbeddingLanguageLine } from "@/components/EmbeddingLanguageLine";
import { LanguageSelect } from "@/components/LanguageSelect";
import { useTtsVoices } from "@/components/VoicePicker";
import { cn } from "@/lib/cn";
import { GENRE_PRESETS } from "@/lib/genres";
import { narratorVoiceFor } from "@/lib/tts-voices";
import {
  TABLE_LANGUAGE_HELP,
  TABLE_LANGUAGE_LABELS,
  TABLE_LANGUAGES,
  type Genre,
} from "@/lib/schemas/game-settings-options";
import type { WorldPackSummary } from "@/lib/worlds/types";
import { FieldLabel } from "@/app/create-campaign/fields";
import type { StepProps } from "@/app/create-campaign/draft";
import { useLocale, useT } from "@/lib/locale";
import {
  arrivalTypeIn,
  dmFlavorText,
  portalCards,
  typeInPlan,
  worldFacts,
  type TypeInPlan,
} from "@/app/create-campaign/portals";

// The setting dialog's middle block: one line per portal, from the data
// file's own names and blurbs (the worlds' words stay the data's).
const settingList = () => GENRE_PRESETS.map((preset) => `**${preset.name}**: ${preset.blurb}`).join("\n\n");

// The setting as eight painted portals, its custom description, the theme the
// preset writes (and the person may overwrite) and the premise. One component
// because the portals and the theme field share the type-in: picking a
// portal writes the preset's line into the theme while it plays.
export function WorldFields({
  draft,
  patch,
  gates,
  active,
  onPickGenre,
}: StepProps & {
  // True while this is the step on screen; entrances wait for it.
  active: boolean;
  // Picking a bare genre by hand leaves the pack and lets the preset write
  // the theme, so the dialog owns the handler that does all three.
  onPickGenre: (genre: Genre) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const showsAiFill = gates.aiNarrates && draft.aiStorySetup;
  // The type-in is a clip played over the input while its own text hides;
  // `run` re-keys it so a second pick replays it.
  const [typing, setTyping] = useState<(TypeInPlan & { run: number }) | null>(null);
  const [arrived, setArrived] = useState(false);
  if (active && !arrived) {
    setArrived(true);
    const plan = arrivalTypeIn(draft, locale);
    if (plan) {
      setTyping({ ...plan, run: 0 });
    }
  }

  const pick = (genre: Genre) => {
    const plan = typeInPlan(draft, genre, locale);
    onPickGenre(genre);
    setTyping((current) => (plan ? { ...plan, run: (current?.run ?? 0) + 1 } : null));
  };

  // Only while the line on screen is the line being typed: a pack, saved
  // defaults, or anything else that rewrote the theme, ends it.
  const typingNow = typing !== null && typing.text === draft.theme;
  const themeNote = draft.themeTouched
    ? t("yours; nothing will overwrite it")
    : draft.worldPack
      ? t("written by the world pack")
      : draft.theme
        ? t("written by the preset")
        : t("yours to write");

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel className="mb-0">
          <span className="flex items-center gap-1">
            {t("Setting")}
            <InfoButton label={t("Settings", { context: "creator.setting.infoLabel" })} text={t("The setting decides how the world sounds, what the maps and portraits look like, and which classes and backgrounds the character builder floats to the top. It changes no rule: every setting plays 5e.\n\n{list}", { list: settingList() })} />
          </span>
        </FieldLabel>
        <div className="cc-portal-grid">
          {portalCards(draft.genre, t).map((card) => (
            <div key={card.id} className="cc-portal-slot" style={{ "--cc-delay": `${card.delayMs}ms` } as CSSProperties}>
              <button type="button" onClick={() => pick(card.id)} aria-pressed={card.chosen} className="cc-portal motion-card">
                <span
                  role="img"
                  aria-label={t("{name} cover plate", { name: ({ "high_fantasy": t("High fantasy"), "dark_fantasy": t("Dark fantasy"), "mystery": t("Mystery"), "horror": t("Horror"), "cyberpunk": t("Cyberpunk"), "steampunk": t("Steampunk"), "post_apocalyptic": t("Post-apocalyptic"), "custom": t("Custom", { context: "creator.genre.custom" }), "coverAria": t("{name} cover plate"), "humansOnly": t("all-human world") } as Record<string, string>)[card.id] ?? String(card.id) })}
                  className="cc-plate"
                  style={{ backgroundImage: `url("${card.plate}")` }}
                >
                  <span className="cc-plate-name">{({ "high_fantasy": t("High fantasy"), "dark_fantasy": t("Dark fantasy"), "mystery": t("Mystery"), "horror": t("Horror"), "cyberpunk": t("Cyberpunk"), "steampunk": t("Steampunk"), "post_apocalyptic": t("Post-apocalyptic"), "custom": t("Custom", { context: "creator.genre.custom" }), "coverAria": t("{name} cover plate"), "humansOnly": t("all-human world") } as Record<string, string>)[card.id] ?? String(card.id)}</span>
                  {card.humansOnly ? <span className="cc-humans">{t("all-human world")}</span> : null}
                </span>
                <span className="cc-portal-body">
                  <span className="cc-portal-blurb">{card.blurb}</span>
                  <span className="cc-portal-foot">
                    <span className="cc-chip">{({ "temperate": t("temperate"), "boreal": t("boreal"), "blighted": t("blighted") } as Record<string, string>)[card.climate] ?? String(card.climate)}</span>
                    <span className="cc-cta">{card.chosen ? t("Chosen") : t("Tap to choose")}</span>
                  </span>
                </span>
              </button>
              {card.chosen ? (
                <span className="cc-chosen" aria-hidden="true">
                  ✓ {t("Chosen")}
                </span>
              ) : null}
            </div>
          ))}
        </div>
        {draft.genre === "custom" ? (
          <div className="cc-custom mt-2">
            <span className="cc-eyebrow mb-1 block">{t("Describe it yourself")}</span>
            <p className="cc-prose mb-2 text-[13px] leading-relaxed text-stone-300">{t("Custom writes nothing for you. The theme and premise boxes stay yours, and what you describe here goes to the GM in place of a preset tone.")}</p>
            <span className="cc-serif block">
              <textarea
                value={draft.customGenreText}
                onChange={(event) => patch({ customGenreText: event.target.value })}
                rows={2}
                maxLength={500}
                aria-label={t("Describe the world and tone")}
                placeholder={t("Describe the world and tone in your own words...")}
                className="cc-bare"
              />
            </span>
          </div>
        ) : null}
      </div>

      <label
        className={cn("cc-field block", typingNow && "cc-typing")}
        data-written={draft.theme ? "true" : "false"}
        style={
          typingNow
            ? ({
                "--cc-type-ms": `${typing.typeMs}ms`,
                "--cc-type-steps": typing.chars,
                "--cc-sweep-ms": `${typing.sweepMs}ms`,
              } as CSSProperties)
            : undefined
        }
      >
        <span key={typingNow ? typing.run : "rest"} className="cc-sweep" aria-hidden="true" />
        <span className="cc-field-head">
          <span className="cc-eyebrow">{t("World or theme notes")}</span>
          <span className="cc-note">{themeNote}</span>
        </span>
        <span className="cc-type-row cc-serif block">
          <input
            value={draft.theme}
            onChange={(event) => {
              setTyping(null);
              patch({ theme: event.target.value, themeTouched: true });
            }}
            maxLength={120}
            placeholder={t("Low-magic gritty, homebrew fey court, neon-drenched megacity...")}
            className="cc-bare"
          />
          {typingNow ? (
            <span key={typing.run} className="cc-typed" aria-hidden="true">
              <span
                onAnimationEnd={(event) => {
                  if (event.animationName === "cc-typeline") {
                    setTyping(null);
                  }
                }}
              >
                {typing.text}
              </span>
            </span>
          ) : null}
        </span>
      </label>

      <label className="cc-field block">
        <span className="cc-field-head">
          <span className="cc-eyebrow">{t("Premise", { context: "creator.field.premise" })}</span>
          <span className="cc-note">
            {t("optional")}
            {showsAiFill ? t("; the AI fills this in if left blank") : ""}
          </span>
        </span>
        <span className="cc-serif block">
          <textarea
            value={draft.description}
            onChange={(event) => patch({ description: event.target.value, descriptionTouched: true })}
            rows={2}
            maxLength={500}
            className="cc-bare"
          />
        </span>
      </label>
    </div>
  );
}

// What the chosen setting tells the Dungeon Master (read-only), the language
// the story is written in, and where cover art comes from. Cover art is only
// pointed at: the upload and the AI painter live in the campaign's details
// dialog, because a cover needs a campaign row to hang off.
export function WorldDetailsFields({
  draft,
  patch,
  selectedPack,
}: Pick<StepProps, "draft" | "patch"> & { selectedPack: WorldPackSummary | null }) {
  const t = useT();
  // A new table language brings its narrator voice, as the server does on
  // create, so the narration step shows the voice that will be saved.
  const voices = useTtsVoices();
  return (
    <div className="space-y-4">
      <div className="cc-field">
        <div className="cc-field-head">
          <span className="cc-eyebrow">{t("How the GM will talk")}</span>
          <span className="cc-note">
            {selectedPack ? t("{name} adds its own voice on top", { name: selectedPack.name }) : t("read-only")}
          </span>
        </div>
        <p key={draft.genre} className="cc-flavor cc-prose text-[13px] leading-relaxed text-stone-300">
          {dmFlavorText(draft.genre, t)}
        </p>
        <div key={`facts-${draft.genre}`} className="cc-facts">
          {worldFacts(draft.genre, t).map((fact, index) => (
            <span key={fact.key} className="cc-fact" style={{ animationDelay: `${index * 70}ms` }}>
              <span className="cc-fact-key">{fact.key}</span>
              <span className="cc-fact-value">{fact.value}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="cc-field">
        <div className="cc-field-head">
          <span className="cc-eyebrow">{t("Table language")}</span>
          <span className="cc-note">{t("what the story is written in")}</span>
        </div>
        <LanguageSelect
          value={draft.tableLanguage}
          onChange={(tableLanguage) => patch({ tableLanguage, ttsVoice: narratorVoiceFor(tableLanguage, draft.ttsVoice, voices.provider === "openai") })}
          label={t("Table language")}
          className="w-full"
        />
        <p className="mt-1 text-xs text-stone-500">{t(TABLE_LANGUAGE_HELP)}</p>
        <EmbeddingLanguageLine languages={[draft.tableLanguage]} className="mt-1" />
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-stone-800 bg-stone-950/40 p-3">
        <ImageIcon className="mt-0.5 size-4 shrink-0 text-amber-300/70" aria-hidden="true" />
        <div>
          <span className="block text-stone-300">{t("Cover art")}</span>
          <p className="mt-0.5 text-xs text-stone-500">{t("You can add cover art from the campaign's details once it exists.")}</p>
        </div>
      </div>
    </div>
  );
}
