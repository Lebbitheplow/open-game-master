"use client";

import { STAGES, isStageEnabled } from "@/lib/dm/stages";
import { DELEGATIONS } from "@/lib/dm/delegation";
import { Select } from "@/components/ui/Select";
import { LanguageSelect } from "@/components/LanguageSelect";
import { Tooltip } from "@/components/ui/Tooltip";
import { InfoButton } from "@/components/ui/InfoDialog";
import { SettingToggle, panelField } from "./PanelKit";
import { cn } from "@/lib/cn";
import { GENRE_PRESETS } from "@/lib/genres";
import type { WorldPackSummary } from "@/lib/worlds/types";
import { WorldPackGallery } from "@/components/WorldPackGallery";
import { NarratorLanguageNote, VoicePicker } from "@/components/VoicePicker";
import { EmbeddingLanguageLine } from "@/components/EmbeddingLanguageLine";
import { NarrationNote } from "@/app/campaigns/[campaignId]/NarrationNote";
import { CharacterVoices } from "@/app/campaigns/[campaignId]/CharacterVoices";
import { VoicePreviewButton } from "@/components/VoicePreviewButton";
import { SafetyToneFields } from "@/components/SafetyToneFields";
import type { GameSettings } from "@/lib/schemas/game-settings";
import { APPEARANCE_THEMES, type CampaignAppearance } from "@/lib/appearance-themes";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";
import { REROLL_LOW_DEFAULT, rerollBelowFor, rerollChoiceOf, type RerollChoice } from "@/lib/srd/ability-rerolls";
import {
  CAMPAIGN_LENGTHS,
  COMPANION_LABELS,
  CONSCIENCE_SETTINGS,
  HP_METHODS,
  STARTING_WEALTH,
  type CampaignLengthSetting,
  type ConscienceSetting,
  type DicePolicy,
  type Genre,
} from "@/lib/schemas/game-settings-options";
import { alliesShown, conscienceShown } from "@/app/campaigns/[campaignId]/table-settings-groups";
import { NarrationStyleRows } from "@/app/campaigns/[campaignId]/NarrationStyleRows";
import { useT, useTp } from "@/lib/locale";

// The bodies of the table settings' named groups (table-settings-groups.ts
// names them and says what each holds on its closed face). Every control is
// the one the single long panel drew, with the same tooltip and the same
// immediate PATCH; only the grouping changed. The words are the dictionaries'
// (table.settings.*), so each group reads in the interface's language.

type Patch = (update: Partial<GameSettings>) => void;
type Base = { settings: GameSettings; patch: Patch };

// Short forms of the character-rule settings for a settings row, as message
// keys; the long forms live in game-settings-options.ts.
export const HP_METHOD_SHORT: Record<GameSettings["hpMethod"], string> = {
  average: "HP: average each level",
  rolled: "HP: rolled each level",
  max: "HP: maximum each level",
};
export const WEALTH_SHORT: Record<GameSettings["startingWealth"], string> = {
  equipment: "Start: class kit and coin",
  rolled: "Start: rolled gold, buy gear",
};

// A select is as wide as its longest option, and a flex item will not
// shrink below that on its own, so a world pack with a long name used to
// push the whole panel sideways on a phone. Capped at the row's width and
// ellipsised instead.
const selectClass = "min-w-0 max-w-full";

export function WorldGroup({
  settings,
  patch,
  packs,
  selectedPack,
}: Base & { packs: WorldPackSummary[]; selectedPack: WorldPackSummary | null }) {
  const t = useT();
  const aiNarrates = settings.dmMode !== "human";
  return (
    <>
      {packs.length ? (
        <div className="reveal flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">{t("World")}</span>
          <Select
            size="sm"
            label={t("World pack")}
            value={settings.worldPack}
            placeholder={t("No pack (plain setting)")}
            onChange={(value) => {
              const next = packs.find((entry) => entry.id === value);
              // Genre moves with the pack, so a campaign never ends up in a
              // world whose base genre contradicts it.
              patch(next ? { worldPack: next.id, genre: next.baseGenre } : { worldPack: "" });
            }}
            options={[{ value: "", label: t("No pack (plain setting)") }, ...packs.map((entry) => ({ value: entry.id, label: entry.name, hint: entry.inspiredBy }))]}
            className={selectClass}
          />
          <span className="text-stone-500">
            {selectedPack ? selectedPack.inspiredBy : t("Pick a pre-built universe to rename races, classes, spells and monsters to fit it.")}
          </span>
        </div>
      ) : null}
      {selectedPack?.cover ? (
        <div className="reveal flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={selectedPack.cover}
            alt=""
            className="h-20 w-36 rounded-md border border-amber-500/30 object-cover shadow-[0_2px_8px_rgba(4,2,12,0.5)]"
          />
        </div>
      ) : null}
      {selectedPack ? <WorldPackGallery packId={selectedPack.id} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">{t("Setting")}</span>
        <Select<Genre>
          size="sm"
          label={t("Setting")}
          value={settings.genre}
          onChange={(genre) =>
            // Changing the genre by hand drops the pack, for the same reason
            // the creation dialog does: a pack IS its baseGenre plus
            // overrides, so the two must never disagree.
            patch({ genre, ...(settings.worldPack ? { worldPack: "" } : {}) })
          }
          options={GENRE_PRESETS.map((entry) => ({ value: entry.id as Genre, label: ({ "high_fantasy": t("High fantasy"), "dark_fantasy": t("Dark fantasy"), "mystery": t("Mystery"), "horror": t("Horror"), "cyberpunk": t("Cyberpunk"), "steampunk": t("Steampunk"), "post_apocalyptic": t("Post-apocalyptic"), "custom": t("Custom", { context: "creator.genre.custom" }), "coverAria": t("{name} cover plate"), "humansOnly": t("all-human world") } as Record<string, string>)[entry.id] ?? String(entry.id) }))}
          className={selectClass}
        />
        <span className="text-stone-500">{({ "high_fantasy": t("Classic swords, sorcery, and shining kingdoms."), "dark_fantasy": t("Grim lands where hope is scarce and victories cost."), "mystery": t("Clues, suspects, and secrets behind every door."), "horror": t("Dread, isolation, and things best left unseen."), "cyberpunk": t("Neon streets, chrome bodies, corporate gods. 5e reskinned."), "steampunk": t("Brass, steam, airships, and impossible machines."), "post_apocalyptic": t("Scavenge, survive, and rebuild among the ruins."), "custom": t("Describe your own world and tone.") } as Record<string, string>)[settings.genre] ?? String(settings.genre)}</span>
      </div>
      {settings.genre === "custom" ? (
        <div className="reveal flex items-start gap-2">
          <span className="pk-rowlabel pt-1">{t("World")}</span>
          <textarea
            defaultValue={settings.customGenreText}
            rows={2}
            maxLength={500}
            onBlur={(event) => patch({ customGenreText: event.target.value })}
            placeholder={t("Describe the world and tone in your own words...")}
            aria-label={t("Describe the world and tone")}
            className={cn(panelField, "w-auto flex-1")}
          />
        </div>
      ) : null}
      <div data-settings-row="table-language" className="flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">{t("Language")}</span>
        <LanguageSelect
          size="sm"
          label={t("Table language")}
          value={settings.tableLanguage}
          onChange={(tableLanguage) => patch({ tableLanguage })}
          className={selectClass}
        />
        <span className="text-stone-500">{t("The Game Master writes the story in this language, and the server reads the story and your messages in it. The app, the rules reference and the rulebook read French. Any language but English needs a multilingual embedding model on the server (EMBEDDING_MODEL in the README).")}</span>
      </div>
      <EmbeddingLanguageLine languages={[settings.tableLanguage]} />
      {aiNarrates ? (
        <div className="reveal flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">{t("Length", { context: "table.settings.row.length" })}</span>
          <Tooltip content={t("How far the GM plans the story ahead (acts, bosses, side quests). Changing it mid-campaign applies when the next saga is planned; any length continues with a sequel saga if you play past the finale.")}>
            <span className="inline-flex min-w-0 max-w-full">
              <Select<CampaignLengthSetting>
                size="sm"
                label={t("Campaign length")}
                value={settings.campaignLength}
                onChange={(campaignLength) => patch({ campaignLength })}
                options={CAMPAIGN_LENGTHS.map((value) => ({ value, label: ({ "short": t("Short (3 acts, a focused adventure)"), "standard": t("Standard (4-5 acts)"), "epic": t("Epic (6-8 acts, a sprawling saga)") } as Record<string, string>)[value] ?? String(value) }))}
                className={selectClass}
              />
            </span>
          </Tooltip>
        </div>
      ) : null}
    </>
  );
}

export function CharacterGroup({ settings, patch, serverRerollLabel }: Base & { serverRerollLabel: string }) {
  const t = useT();
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">{t("Dice")}</span>
        <Tooltip content={t("Real dice lets each player opt in to rolling at their table: the game parks until they type the result, read it from a paired Pixels Bluetooth die, or let the server roll per die (Dice sources, in the Party tab). They roll their attacks and damage, initiative, and the checks and saves the GM asks for; the table rolls the rest, such as death saves and concentration.")}>
          <span className="inline-flex min-w-0 max-w-full">
            <Select<DicePolicy>
              size="sm"
              label={t("Dice policy")}
              value={settings.dicePolicy}
              onChange={(dicePolicy) => patch({ dicePolicy })}
              options={[
                { value: "digital_only", label: t("Digital only"), icon: { kind: "glyph", key: "tab-dice" } },
                { value: "real_allowed", label: t("Real dice allowed"), icon: { kind: "glyph", key: "die-d20" } },
              ]}
              className={selectClass}
            />
          </span>
        </Tooltip>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">{t("Heroes")}</span>
        <Tooltip content={t("How hit points grow after 1st level (1st is always the hit die's highest face plus Constitution). Rolled dice are thrown by the server.")}>
          <span className="inline-flex min-w-0 max-w-full">
            <Select
              size="sm"
              label={t("Hit points per level")}
              value={settings.hpMethod ?? "average"}
              onChange={(value) => patch({ hpMethod: value as GameSettings["hpMethod"] })}
              options={HP_METHODS.map((method) => ({ value: method, label: t(HP_METHOD_SHORT[method]) }))}
              className={selectClass}
            />
          </span>
        </Tooltip>
        <Tooltip content={t("What a new character starts with: the class and background kit plus the background's coin, or gold the server rolls by class to buy gear with.")}>
          <span className="inline-flex min-w-0 max-w-full">
            <Select
              size="sm"
              label={t("Starting wealth")}
              value={settings.startingWealth ?? "equipment"}
              onChange={(value) => patch({ startingWealth: value as GameSettings["startingWealth"] })}
              options={STARTING_WEALTH.map((method) => ({ value: method, label: t(WEALTH_SHORT[method]) }))}
              className={selectClass}
            />
          </span>
        </Tooltip>
        <Tooltip content={t("For 4d6 ability scores rolled at this table: whether a player may throw the six again, and when. The server rolls the dice either way. Following the server's rule, a player's six here are the ones they rolled in their library; with a rule of its own the table keeps a separate six for each player. A character made here still joins its player's library like any other, and characters brought from the library keep the scores they were made with.")}>
          <span className="inline-flex min-w-0 max-w-full">
            <Select
              size="sm"
              label={t("Rolled stats")}
              value={settings.abilityRerollBelow == null ? "server" : rerollChoiceOf(settings.abilityRerollBelow)}
              onChange={(value) =>
                patch({
                  abilityRerollBelow:
                    value === "server"
                      ? null
                      : rerollBelowFor(value as RerollChoice, settings.abilityRerollBelow ?? REROLL_LOW_DEFAULT),
                })
              }
              options={[
                { value: "server", label: t("Stats: {rule}", { rule: serverRerollLabel }) },
                { value: "keep", label: t("Stats: the first roll stands") },
                { value: "low", label: t("Stats: reroll under {total}", { total: rerollBelowFor("low", settings.abilityRerollBelow ?? REROLL_LOW_DEFAULT) }) },
                { value: "free", label: t("Stats: reroll freely") },
              ]}
              className={selectClass}
            />
          </span>
        </Tooltip>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">{t("Classes")}</span>
        <Tooltip content={t("Let characters take levels in a second or third class at level-up (5e multiclassing, prerequisites enforced)")}>
          <SettingToggle on={settings.multiclassingEnabled} onToggle={() => patch({ multiclassingEnabled: !settings.multiclassingEnabled })}>
            {settings.multiclassingEnabled ? t("Multiclassing on") : t("Multiclassing off")}
          </SettingToggle>
        </Tooltip>
      </div>
    </>
  );
}

export function NarrationGroup({
  settings,
  patch,
  campaignId,
  narrating,
  narrationOff,
}: Base & { campaignId: string; narrating: boolean; narrationOff: boolean }) {
  const t = useT();
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">{t("Narration", { context: "table.settings.row.narration" })}</span>
        <SettingToggle label={t("Narration", { context: "table.settings.row.narration" })} on={narrating} disabled={narrationOff} onToggle={() => patch({ ttsEnabled: !settings.ttsEnabled })}>
          {narrating ? t("On", { context: "table.settings.narration.on" }) : narrationOff ? t("Off on this server") : t("Off", { context: "table.settings.narration.off" })}
        </SettingToggle>
        {narrating ? (
          <>
            <VoicePicker size="sm" label={t("Narration voice")} value={settings.ttsVoice} onChange={(ttsVoice) => patch({ ttsVoice })} language={settings.tableLanguage} />
            <VoicePreviewButton voice={settings.ttsVoice} />
          </>
        ) : null}
      </div>
      {narrating ? <NarratorLanguageNote language={settings.tableLanguage} /> : null}
      {narrating ? <CharacterVoices campaignId={campaignId} settings={settings} steersStory patch={patch} /> : null}
      {narrating || narrationOff ? <NarrationNote /> : null}
      <p className="text-stone-500">{t("Whether the story is read aloud is the whole table's setting. How loud it plays, or muting it, is each person's own, from the speaker button at the table.")}</p>
    </>
  );
}

export function AtmosphereGroup({
  settings,
  patch,
  steersAudio,
  ambienceInstalled,
  ambienceCounts,
}: Base & {
  steersAudio: boolean;
  ambienceInstalled: boolean;
  ambienceCounts: Record<"bed" | "music" | "sting", { installed: number; total: number }> | null;
}) {
  const capabilities = useCapabilities();
  const t = useT();
  return (
    <>
      {hostOffers(capabilities, "appearanceThemes") ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">Visual theme</span>
          <Select<CampaignAppearance>
            value={settings.appearanceTheme ?? "genre"}
            onChange={(appearanceTheme) => patch({ appearanceTheme })}
            options={[{ value: "genre", label: "Follow genre" }, ...APPEARANCE_THEMES.map((theme) => ({ value: theme.id, label: theme.name }))]}
            label="Campaign visual theme"
          />
          <span className="text-stone-500">Sets the table’s appearance. Each player keeps their own brightness and can choose a personal theme.</span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">{t("Maps")}</span>
        <SettingToggle on={settings.mapsEnabled} onToggle={() => patch({ mapsEnabled: !settings.mapsEnabled })}>
          {settings.mapsEnabled ? t("Maps on") : t("Maps off")}
        </SettingToggle>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">{t("Faces")}</span>
        <Tooltip content={t("Theatre inserts: when a passage has someone speaking, their portrait comes up over the scene art while their lines play.")}>
          <SettingToggle on={settings.presentation === "theatre"} onToggle={() => patch({ presentation: settings.presentation === "theatre" ? "plain" : "theatre" })}>
            {settings.presentation === "theatre" ? t("Theatre inserts on") : t("Theatre inserts off")}
          </SettingToggle>
        </Tooltip>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">{t("Ambience")}</span>
        <SettingToggle label={t("Ambience")} on={settings.ambienceEnabled} onToggle={() => patch({ ambienceEnabled: !settings.ambienceEnabled })}>
          {settings.ambienceEnabled ? t("On", { context: "table.settings.ambience.on" }) : t("Off", { context: "table.settings.ambience.off" })}
        </SettingToggle>
        {settings.ambienceEnabled ? (
          <Tooltip content={t("Pick a bed from each new place and switch to combat music when a fight starts. Off leaves every change to the GM.")}>
            <SettingToggle on={settings.ambienceAuto} onToggle={() => patch({ ambienceAuto: !settings.ambienceAuto })}>
              {settings.ambienceAuto ? t("Follows the scene") : t("GM sets it")}
            </SettingToggle>
          </Tooltip>
        ) : null}
        {steersAudio && settings.ambienceEnabled && !ambienceInstalled ? (
          // The catalog knows the cues but no audio is on disk, so the
          // toggle above is currently a promise of silence. Say so where
          // it is being switched on rather than letting the table wonder.
          <span className="text-stone-500">{t("This server has no sound library on disk, so this plays silence. The library ships with the game; the server admin can restore it from the admin panel (Sound library).")}</span>
        ) : steersAudio && settings.ambienceEnabled && ambienceCounts ? (
          <span className="text-stone-500">
            {t("Audio for {beds} of {bedTotal} rooms, {music} of {musicTotal} moods and {stings} of {stingTotal} sounds. The speaker in the table header opens the sound panel.", {
              beds: ambienceCounts.bed.installed,
              bedTotal: ambienceCounts.bed.total,
              music: ambienceCounts.music.installed,
              musicTotal: ambienceCounts.music.total,
              stings: ambienceCounts.sting.installed,
              stingTotal: ambienceCounts.sting.total,
            })}
          </span>
        ) : null}
      </div>
    </>
  );
}

export function SafetyGroup({ settings, patch }: Base) {
  return (
    <SafetyToneFields
      safety={settings.safety}
      gm={settings.gm}
      ttsVoice={settings.ttsVoice}
      onSafety={(safety) => patch({ safety })}
      onGm={(gm) => patch({ gm })}
      onVoice={(ttsVoice) => patch({ ttsVoice })}
      tableLanguage={settings.tableLanguage}
    />
  );
}

// The Living World explainer, shared with the campaign creator's info
// button so the two never drift.
export const LIVING_WORLD_INFO = [
  "On: the world moves without you. Off-screen storylines advance on background dice each turn, so rival factions, threats, and distant events keep developing while you play.",
  "NPCs pursue their own goals between chapters and during rests and travel. Schemes progress, pressure builds, and rivals can collide with each other.",
  "The GM quietly records what happened off-screen and weaves it into future scenes, ambushes, and rumors. These simulation notes are GM-only until the party discovers them in play.",
  "Off: all of that pauses. The world changes only when your party acts or the story arc calls for it. Your main story arc, chapters, quests, and XP work exactly the same either way.",
  "You can switch this at any time. Turning it back on resumes from the world as it currently stands.",
].join("\n\n");

export function AiGroup({ settings, patch }: Base) {
  const t = useT();
  const tp = useTp();
  const aiNarrates = settings.dmMode !== "human";
  return (
    <>
      {settings.dmMode === "assisted" ? (
        // Only in the middle setting. A table the AI runs has nothing to
        // delegate and a table running itself has chosen not to, so showing
        // three switched-off switches in either would be noise.
        <div className="flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">{t("AI helps")}</span>
          {DELEGATIONS.map((which) => (
            <Tooltip key={which} content={({ "monsters": t("When the initiative pointer passes an enemy, the AI picks its action and the engine resolves it. You can still swing for them yourself."), "narration": t("A beat you write down gets said to the table in full prose. Your own line stays one click away as the first take."), "cover": t("You can hand the next few answers to the AI when you step away. It follows your outline and gives the table back to you when the count runs out.") } as Record<string, string>)[which] ?? String(which)}>
              <SettingToggle
                on={settings.dmAssist[which]}
                onToggle={() => patch({ dmAssist: { ...settings.dmAssist, [which]: !settings.dmAssist[which] } })}
              >
                {({ "monsters": t("AI runs the monsters"), "narration": t("AI reads your beats aloud"), "cover": t("AI can cover for you") } as Record<string, string>)[which] ?? String(which)}
              </SettingToggle>
            </Tooltip>
          ))}
        </div>
      ) : null}
      {aiNarrates ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">{t("Setup")}</span>
          <SettingToggle on={settings.aiStorySetup} onToggle={() => patch({ aiStorySetup: !settings.aiStorySetup })}>
            {settings.aiStorySetup ? t("AI story setup on") : t("AI story setup off")}
          </SettingToggle>
          <span className="text-stone-500">
            {settings.aiStorySetup ? t("The GM invents the plot before the first scene.") : t("The story starts from your premise and prep alone.")}
          </span>
        </div>
      ) : null}
      {aiNarrates ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">{t("Prose")}</span>
          <Tooltip content={t("After each turn the server compares the GM's narration against what the dice and tools actually resolved: a hit written on a miss, a death the hit points deny, a damage number no die rolled. A contradiction is sent back to the GM once for a rewrite. It also does what the GM left undone: a spell a player asked for that the story cast is cast for real, and a kindness or flirt a player declared is recorded on their bonds.")}>
            <SettingToggle on={settings.narrationGuard} onToggle={() => patch({ narrationGuard: !settings.narrationGuard })}>
              {settings.narrationGuard ? t("Outcome check on") : t("Outcome check off")}
            </SettingToggle>
          </Tooltip>
          <span className="text-stone-500">
            {settings.narrationGuard ? t("Narration that contradicts the dice goes back for one rewrite.") : t("The GM's narration is persisted exactly as written.")}
          </span>
        </div>
      ) : null}
      {aiNarrates ? <NarrationStyleRows settings={settings} patch={patch} /> : null}
      {aiNarrates ? (
        <div className="reveal flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">{t("World")}</span>
          <Tooltip content={t("The world moves on its own: off-screen storylines advance on background dice, surprises and encounters build up over quiet stretches, and NPC schemes progress between chapters and during rests and travel. The story arc itself is unaffected either way.")}>
            <SettingToggle on={settings.worldSimulation} onToggle={() => patch({ worldSimulation: !settings.worldSimulation })}>
              {settings.worldSimulation ? t("Living world on") : t("Living world off")}
            </SettingToggle>
          </Tooltip>
          <InfoButton label={t("What does Living World do?")} text={t("On: the world moves without you. Off-screen storylines advance on background dice each turn, so rival factions, threats, and distant events keep developing while you play.\n\nNPCs pursue their own goals between chapters and during rests and travel. Schemes progress, pressure builds, and rivals can collide with each other.\n\nThe GM quietly records what happened off-screen and weaves it into future scenes, ambushes, and rumors. These simulation notes are GM-only until the party discovers them in play.\n\nOff: all of that pauses. The world changes only when your party acts or the story arc calls for it. Your main story arc, chapters, quests, and XP work exactly the same either way.\n\nYou can switch this at any time. Turning it back on resumes from the world as it currently stands.")} />
          <span className="text-stone-500">
            {settings.worldSimulation
              ? t("Rumors, surprises, and off-screen schemes advance between turns.")
              : t("Nothing happens unless the party or the story arc makes it happen.")}
          </span>
        </div>
      ) : null}
      {/* At a table a person runs, Auto already allows the lasting allies
          the DM plays by hand, so the row stays out of the way; it shows
          when an Off or guests-only setting carried over from an AI table
          shuts them out, which is where the Party panel's handoff points
          (issue 209). */}
      {alliesShown(settings) ? (
        <div data-settings-row="allies" className="reveal flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">{t("Allies")}</span>
          <Tooltip content={t("AI companions the GM plays: 'party members' travel with the party until dismissed; 'guests' are temporary allies for one scene or battle (a town soldier helping defend) and leave automatically when the fight ends. Auto picks full for solo play, guests only for multiplayer.")}>
            <span className="inline-flex min-w-0 max-w-full">
              <Select<GameSettings["companions"]>
                size="sm"
                label={t("AI companions")}
                value={settings.companions}
                onChange={(companions) => patch({ companions })}
                options={(Object.keys(COMPANION_LABELS) as Array<GameSettings["companions"]>).map((mode) => ({ value: mode, label: ({ "auto": t("Auto (solo: full; multiplayer: guests only)"), "full": t("Party members and guests"), "guests": t("Temporary guests only"), "off": t("Off", { context: "table.settings.companions.off" }) } as Record<string, string>)[mode] ?? String(mode) }))}
                className={selectClass}
              />
            </span>
          </Tooltip>
          {settings.companions !== "off" ? (
            <>
              {settings.companions !== "guests" ? (
                <span className="inline-flex min-w-0 max-w-full" title={t("Most lasting party companions allowed at once")}>
                  <Select
                    size="sm"
                    label={t("Most lasting party companions allowed at once")}
                    value={String(settings.maxCompanions)}
                    onChange={(value) => patch({ maxCompanions: Number(value) })}
                    options={[1, 2, 3, 4].map((count) => ({ value: String(count), label: t("max {count} party", { count }) }))}
                    className={selectClass}
                  />
                </span>
              ) : null}
              <span className="inline-flex min-w-0 max-w-full" title={t("Most temporary guest allies allowed at once")}>
                <Select
                  size="sm"
                  label={t("Most temporary guest allies allowed at once")}
                  value={String(settings.maxGuests)}
                  onChange={(value) => patch({ maxGuests: Number(value) })}
                  options={[1, 2, 3, 4].map((count) => ({ value: String(count), label: tp("max {count} guest", "max {count} guests", { count }) }))}
                  className={selectClass}
                />
              </span>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

// The narrator's pipeline. Optional tuning: every table starts with all of
// it on, and the line under the switches says so.
export function MemoryGroup({ settings, patch }: Base) {
  const t = useT();
  return (
    <>
      <p className="text-stone-500">{t("How the AI narrator remembers a long campaign. Every table starts with all of these on; switch one off only to save model time on a slow server.")}</p>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {STAGES.map((stage) => {
          const on = isStageEnabled(settings.stages, stage.id);
          return (
            <Tooltip key={stage.id} content={`${t(stage.description)} ${t(stage.cost)}`}>
              <SettingToggle on={on} onToggle={() => patch({ stages: { ...settings.stages, [stage.id]: !on } })}>
                {t(stage.label)} {on ? t("on", { context: "table.settings.word.on" }) : t("off", { context: "table.settings.word.off" })}
                {/* Only a model-call stage buys back GPU time; saying so
                    stops an operator disabling recall expecting a speedup. */}
                <span className="ml-1 text-[11px] text-stone-500">
                  · {stage.callsModel ? t("model") : t("engine")}
                </span>
              </SettingToggle>
            </Tooltip>
          );
        })}
      </div>
    </>
  );
}

export function BondsGroup({ settings, patch, lastingCompanions = false }: Base & { lastingCompanions?: boolean }) {
  const t = useT();
  return (
    <>
    <div className="flex flex-wrap items-center gap-2">
      <span className="pk-rowlabel">{t("Bonds")}</span>
      <Tooltip content={t("How each NPC and AI companion feels about each character, tracked by the server on one meter from hostile through neutral to devoted. Deeds move it, and the same deed lands differently on different people: mercy wins over a kind healer and irritates a hard-bitten mercenary. Standing shows in the Bonds tab and colors how the GM plays them.")}>
        <SettingToggle on={settings.relationships !== "off"} onToggle={() => patch({ relationships: settings.relationships === "off" ? "on" : "off" })}>
          {settings.relationships !== "off" ? t("Bonds on") : t("Bonds off")}
        </SettingToggle>
      </Tooltip>
      {settings.relationships !== "off" ? (
        <Tooltip content={t("The romance ladder on top of the bond meter: interested, courting, together, betrothed, married. Nobody can be romanced who does not already like the character, nobody is courted who did not ask to be, partners keep to each other unless everyone involved is open to more than one partner, and intimate scenes always fade to black. Each step needs a little story time after the last, the other side starts scenes of their own, and every step is told to the table.")}>
          <SettingToggle on={settings.romance !== "off"} onToggle={() => patch({ romance: settings.romance === "off" ? "on" : "off" })}>
            {settings.romance !== "off" ? t("Romance on") : t("Romance off")}
          </SettingToggle>
        </Tooltip>
      ) : null}
      <span className="text-stone-500">
        {settings.relationships === "off"
          ? t("The GM tracks no personal standing; NPCs react to the party as a whole.")
          : settings.romance !== "off"
            ? t("Standing is tracked per character, and romance can grow from it.")
            : t("Standing is tracked per character; romance is off.")}
      </span>
    </div>
    {/* Only where it can matter: bonds on and a lasting companion possible
        at this table (AGENTS.md settings rule 4). */}
    {conscienceShown(settings, lastingCompanions) ? (
      <div data-settings-row="conscience" className="reveal flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">{t("Conscience")}</span>
        <Tooltip content={t("How far a lasting AI companion goes when the party's deeds break what it holds to.")}>
          <span className="inline-flex min-w-0 max-w-full">
            <Select<ConscienceSetting>
              size="sm"
              label={t("Companion conscience")}
              value={settings.companionConscience ?? "leave"}
              onChange={(companionConscience) => patch({ companionConscience })}
              options={CONSCIENCE_SETTINGS.map((setting) => ({ value: setting, label: ({ "off": t("Off"), "talk": t("Talk"), "leave": t("Leave"), "turn": t("Turn") } as Record<string, string>)[setting] ?? String(setting) }))}
              className={selectClass}
            />
          </span>
        </Tooltip>
        <InfoButton label={t("What does Companion conscience do?")} text={t("Each lasting AI companion holds a few values from its class and alignment, some of them red lines it will not see crossed.\n\nDeeds the party commits in front of them move a ladder the server keeps: content, uneasy, warning, ultimatum, breaking point. Their Bonds row shows where they stand and any ultimatum they set, with the time left on the campaign's clock. Making amends, or doing what they hold dear, climbs it back, a rung a day at most. A character who stands by while another does it bears a little of it; one who speaks against it bears none.\n\nOff: companions judge by standing alone. Talk: they object, warn and set ultimatums, and stay whatever happens. Leave (the default): past their breaking point they walk out, slip away or report the party. Turn: as Leave, and they may turn on the party in a fight, at their full strength whatever the table's difficulty; a player's command over a companion ends once it warns the party.")} />
        <span key={settings.companionConscience ?? "leave"} className="live-in text-stone-500">
          {({ "off": t("Companions judge by standing alone: no values, no warnings, nobody leaves over a deed."), "talk": t("Companions object, warn and set ultimatums, and stay whatever happens."), "leave": t("Pushed past their breaking point, a companion walks out, slips away or reports the party."), "turn": t("As Leave, and a companion past their breaking point may turn on the party in a fight.") } as Record<string, string>)[settings.companionConscience ?? "leave"] ?? String(settings.companionConscience ?? "leave")}
        </span>
      </div>
    ) : null}
    </>
  );
}

// Wait for the table (src/lib/dm/table-wait.ts) as one picker: the DM answers
// the first post, or waits for everyone with a choice of how long a quiet
// table holds it (15 to 900 seconds allowed). A stored length that is not
// one of the choices is offered as itself.
const WAIT_CHOICES = [30, 60, 120, 180, 300, 600, 900];
function waitLabel(t: (key: string, vars?: Record<string, string | number>) => string, seconds: number) {
  return t("Waits for everyone, up to {time}", { time: seconds % 60 ? `${seconds}s` : `${seconds / 60} min` });
}
function pacingOptions(t: (key: string, vars?: Record<string, string | number>) => string, seconds: number) {
  const lengths = WAIT_CHOICES.includes(seconds) ? WAIT_CHOICES : [...WAIT_CHOICES, seconds].sort((a, b) => a - b);
  // "0": no wait, the first post wakes the DM.
  return [{ value: "0", label: t("Answers the first post") }, ...lengths.map((length) => ({ value: String(length), label: waitLabel(t, length) }))];
}

// `solo`: a table of one, where nobody else could be waited for.
export function PlayersGroup({ settings, patch, solo = false }: Base & { solo?: boolean }) {
  const t = useT();
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">{t("Joining")}</span>
        <Tooltip content={t("Allow new players to join with the invite code after the adventure starts")}>
          <SettingToggle on={settings.midGameJoinOpen} onToggle={() => patch({ midGameJoinOpen: !settings.midGameJoinOpen })}>
            {settings.midGameJoinOpen ? t("Mid-game joining open") : t("Mid-game joining closed")}
          </SettingToggle>
        </Tooltip>
        <Tooltip content={t("After each GM narration, players cannot act until you allow responses. OOC stays open.")}>
          <SettingToggle on={settings.holdSubmissions} onToggle={() => patch({ holdSubmissions: !settings.holdSubmissions })}>
            {settings.holdSubmissions ? t("Held responses on") : t("Held responses off")}
          </SettingToggle>
        </Tooltip>
      </div>
      {/* Only where it can matter: an AI turn to hold, and someone else to
          wait for. */}
      {!solo && settings.dmMode !== "human" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">{t("Pacing")}</span>
          <Select
            size="sm"
            label={t("When the AI GM answers")}
            value={settings.waitForTable ? String(settings.waitForTableSeconds) : "0"}
            onChange={(value) => patch(Number(value) ? { waitForTable: true, waitForTableSeconds: Number(value) } : { waitForTable: false })}
            options={pacingOptions(t, settings.waitForTableSeconds)}
            className={selectClass}
          />
          <InfoButton label={t("What does waiting for everyone do?")} text={t("Answers the first post: the AI GM narrates as soon as anyone acts, so the quickest player sets the pace.\n\nWaits for everyone: after each narration the AI GM waits until every player who has the table open (or plays through a connected agent) has acted or pressed Pass, then answers them all in one turn. The clock starts with the first answer and restarts with every post or pass, so only a quiet table runs it out. The lead can say Go on now at any time. A spotlight, a fight's turn order and table talk never wait")} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">{t("Items")}</span>
        <Tooltip content={t("When on, GM-granted loot, item removals, and gold changes become offers the owning player accepts or declines before they land on the sheet. Damage, healing and conditions have their own switch.")}>
          <SettingToggle on={settings.inventoryApprovals} onToggle={() => patch({ inventoryApprovals: !settings.inventoryApprovals })}>
            {settings.inventoryApprovals ? t("Item offers on") : t("Item offers off")}
          </SettingToggle>
        </Tooltip>
        <span className="text-stone-500">
          {settings.inventoryApprovals
            ? t("Players confirm GM item and gold changes before they apply.")
            : t("GM item and gold changes apply immediately (lead can undo).")}
        </span>
      </div>
      <div className="pk-row">
        <span className="pk-rowlabel">{t("Vitals")}</span>
        <Tooltip content={t("When on, damage, healing and conditions the AI GM or a connected agent aims at a player character wait for that player (or the lead) to confirm before they land, so a wrong target, a doubled hit or a misread rule never sticks unseen. The engine's own dice, an enemy's attack or a fall, apply as always. A slower table; off by default.")}>
          <SettingToggle on={settings.vitalsApprovals} onToggle={() => patch({ vitalsApprovals: !settings.vitalsApprovals })}>
            {settings.vitalsApprovals ? t("Vitals changes need confirming") : t("Vitals changes auto-apply")}
          </SettingToggle>
        </Tooltip>
        <span className="text-stone-500">
          {settings.vitalsApprovals
            ? t("Players confirm GM damage, healing and conditions before they apply.")
            : t("GM damage, healing and conditions apply immediately (lead can undo).")}
        </span>
      </div>
    </>
  );
}

// Only the DM seat is ever nudged, so this group does not exist for a table
// the AI narrates: there, the story is typed by definition.
export function ConsoleGroup({ settings, patch }: Base) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="pk-rowlabel">{t("Remind")}</span>
      <Tooltip content={t("How much play may pass with nothing written down before the console nudges you to record what happened. Your own typed narration counts, so a GM who writes their scenes is never nudged.")}>
        <span className="inline-flex min-w-0 max-w-full">
          <Select
            size="sm"
            label={t("Remind after this many actions")}
            value={String(settings.beatReminder.messages)}
            onChange={(value) => patch({ beatReminder: { ...settings.beatReminder, messages: Number(value) } })}
            options={[0, 5, 10, 20, 40].map((count) => ({ value: String(count), label: count === 0 ? t("never by actions") : t("after {count} actions", { count }) }))}
            className={selectClass}
          />
        </span>
      </Tooltip>
      <span className="inline-flex min-w-0 max-w-full" title={t("The combat tempo: twelve rolls is roughly two rounds of a four-person fight.")}>
        <Select
          size="sm"
          label={t("Remind after this many rolls")}
          value={String(settings.beatReminder.rolls)}
          onChange={(value) => patch({ beatReminder: { ...settings.beatReminder, rolls: Number(value) } })}
          options={[0, 6, 12, 24, 48].map((count) => ({ value: String(count), label: count === 0 ? t("never by rolls") : t("after {count} rolls", { count }) }))}
          className={selectClass}
        />
      </span>
    </div>
  );
}

export function BoardGroup({ settings, patch }: Base) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="pk-rowlabel">{t("Board")}</span>
      <Tooltip content={t("Players may draw on the live board: a plan of attack, a circle round a door. The GM always may.")}>
        <SettingToggle on={settings.boardDrawing} onToggle={() => patch({ boardDrawing: !settings.boardDrawing })}>
          {settings.boardDrawing ? t("Players may draw") : t("Only the GM draws")}
        </SettingToggle>
      </Tooltip>
      <Tooltip content={t("Show what enemies look likely to do next", { context: "table.settings.intent.tip" })}>
        <SettingToggle on={settings.enemyIntent} onToggle={() => patch({ enemyIntent: !settings.enemyIntent })}>
          {settings.enemyIntent ? t("Enemy intent on") : t("Enemy intent off")}
        </SettingToggle>
      </Tooltip>
    </div>
  );
}

// Live voice chat. The rules below are a list rather than a single
// proximity checkbox on purpose: "players only hear people within 30 feet"
// is one table's house rule, and the next table will want a different one.
// They are all inputs to one function (src/lib/voice/audibility.ts).
export function VoiceChatGroup({ settings, patch, transcribes }: Base & { transcribes: boolean }) {
  const t = useT();
  const rules = settings.voice.rules;
  const setRule = (change: Partial<GameSettings["voice"]["rules"]>) => patch({ voice: { ...settings.voice, rules: { ...rules, ...change } } });
  return (
    <>
      <p className="text-stone-500">{t("People talking to each other, in the lobby and during play. Separate from narration, which reads the story aloud.")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">{t("Voice", { context: "table.settings.row.voice" })}</span>
        <Tooltip content={t("Live voice chat for this table, in the lobby and during play. The server also has its own switch, and needs a media port open; if voice is off server-wide this has no effect.")}>
          <SettingToggle on={settings.voice.enabled} onToggle={() => patch({ voice: { ...settings.voice, enabled: !settings.voice.enabled } })}>
            {settings.voice.enabled ? t("Voice chat on") : t("Voice chat off")}
          </SettingToggle>
        </Tooltip>
        {settings.voice.enabled ? (
          <>
            <Tooltip content={t("How hard the floor is enforced on microphones. Soft shows whose turn it is without muting anyone. Strict pauses a player's microphone on the server, so the mute is real rather than a greyed-out button. Off ignores the floor entirely. The GM is never muted by any of these.")}>
              <span className="inline-flex min-w-0 max-w-full">
                <Select<"off" | "soft" | "strict">
                  size="sm"
                  label={t("Turn enforcement on microphones")}
                  value={settings.voice.turnEnforcement}
                  onChange={(turnEnforcement) => patch({ voice: { ...settings.voice, turnEnforcement } })}
                  options={[
                    { value: "off", label: t("Turns: ignored") },
                    { value: "soft", label: t("Turns: shown") },
                    { value: "strict", label: t("Turns: enforced") },
                  ]}
                  className={selectClass}
                />
              </span>
            </Tooltip>
            <Tooltip content={transcribes ? t("Transcription: each speaker's microphone is written down with their name, for the beat drafter and the chapter summary. Never read by the GM prompt. The lobby says out loud that the table is being transcribed while this is on.") : t("This server has no transcription service, so nothing said on the call can be written down. An admin sets up a Whisper service (STT_URL, or Admin > Speech) to switch it on.")}>
              <SettingToggle
                on={settings.voice.transcribe && transcribes}
                disabled={!transcribes}
                onToggle={() => patch({ voice: { ...settings.voice, transcribe: !settings.voice.transcribe } })}
              >
                {!transcribes
                  ? t("Transcription off on this server")
                  : settings.voice.transcribe
                    ? t("Transcription on")
                    : t("Transcription off")}
              </SettingToggle>
            </Tooltip>
            <Tooltip content={t("Distance decides who hears whom, using the battle map. Outside combat, or with no map, everyone hears everyone as usual. The GM always hears everyone and is always heard.")}>
              <SettingToggle on={rules.proximity} onToggle={() => setRule({ proximity: !rules.proximity })}>
                {rules.proximity ? t("Proximity on") : t("Proximity off")}
              </SettingToggle>
            </Tooltip>
            {rules.proximity ? (
              <>
                <span className="inline-flex min-w-0 max-w-full" title={t("How far a normal speaking voice carries")}>
                  <Select
                    size="sm"
                    label={t("How far a normal speaking voice carries")}
                    value={String(rules.hearingRangeFeet)}
                    onChange={(value) => setRule({ hearingRangeFeet: Number(value) })}
                    options={[15, 30, 60, 120].map((feet) => ({ value: String(feet), label: t("{feet} ft", { feet }) }))}
                    className={selectClass}
                  />
                </span>
                <Tooltip content={t("Lets each player pick whisper (5 ft), normal, or shout (120 ft). The range is the speaker's, because shouting is something you do rather than something done to you.")}>
                  <SettingToggle on={rules.sayRange} onToggle={() => setRule({ sayRange: !rules.sayRange })}>
                    {rules.sayRange ? t("Whisper/shout on") : t("Whisper/shout off")}
                  </SettingToggle>
                </Tooltip>
                <Tooltip content={t("A wall between two characters muffles the voice rather than silencing it. Hearing through a door is a real thing, and audio that vanished at a doorway would read as a bug. Fog of war never gates audio: not seeing someone has nothing to do with hearing them.")}>
                  <SettingToggle on={rules.wallsAttenuate} onToggle={() => setRule({ wallsAttenuate: !rules.wallsAttenuate })}>
                    {rules.wallsAttenuate ? t("Walls muffle on") : t("Walls muffle off")}
                  </SettingToggle>
                </Tooltip>
              </>
            ) : null}
            <Tooltip content={t("A character at 0 hit points stops hearing the table. They still hear the GM, and they are still heard.")}>
              <SettingToggle on={rules.downedGoDeaf} onToggle={() => setRule({ downedGoDeaf: !rules.downedGoDeaf })}>
                {rules.downedGoDeaf ? t("Downed go deaf on") : t("Downed go deaf off")}
              </SettingToggle>
            </Tooltip>
          </>
        ) : null}
      </div>
    </>
  );
}
