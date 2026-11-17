"use client";

import { Check, Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { PanelError } from "./PanelKit";
import type { WorldPackSummary } from "@/lib/worlds/types";
import { useTtsVoices, voiceLabel } from "@/components/VoicePicker";
import { CharacterVoices } from "@/app/campaigns/[campaignId]/CharacterVoices";
import { DetailGroup } from "@/app/create-campaign/fields";
import type { GameSettings } from "@/lib/schemas/game-settings";
import { rerollChoiceOf } from "@/lib/srd/ability-rerolls";
import { useServerRerollBelow } from "@/app/characters/builder/useTableRules";
import { transcribesVoice, useCapabilities } from "@/lib/use-capabilities";
import { useT } from "@/lib/locale";
import {
  AiGroup,
  AtmosphereGroup,
  BoardGroup,
  BondsGroup,
  CharacterGroup,
  ConsoleGroup,
  HP_METHOD_SHORT,
  MemoryGroup,
  NarrationGroup,
  PlayersGroup,
  SafetyGroup,
  VoiceChatGroup,
  WEALTH_SHORT,
  WorldGroup,
} from "@/app/campaigns/[campaignId]/GameSettingsGroups";
import {
  conscienceShown,
  groupMatches,
  tableGroupSummary,
  tableGroups,
  type TableGroupId,
} from "@/app/campaigns/[campaignId]/table-settings-groups";

export { LIVING_WORLD_INFO } from "@/app/campaigns/[campaignId]/GameSettingsGroups";

// The same explainers as this panel's tooltips, shared with the campaign
// creator's info buttons so the two surfaces never drift apart. The
// constants carry message keys; the strings live in the dictionaries and
// read in the interface's language at each ⓘ. The bonds text is the table
// settings' own line (table.settings.info.bonds, word for word); the
// romance and guard texts are the creator's longer versions of their keyed
// twins (table.settings.info.*), which the merge kept a little shorter.
// Display-only: the GM prompt carries its own rules text (the safety
// rules, src/lib/dm/relationship-tools.ts), not these words.
export const BONDS_INFO = "How each NPC and AI companion feels about each character, tracked by the server on one meter from hostile through neutral to devoted.\n\nDeeds move it, and the same deed lands differently on different people: mercy wins over a kind healer and irritates a hard-bitten mercenary.\n\nStanding shows in the Bonds tab and colors how the GM plays them. Off: the GM tracks no personal standing and NPCs react to the party as a whole.";

export const ROMANCE_INFO = "The romance ladder on top of the bond meter: interested, courting, together, betrothed, married.\n\nNobody can be romanced who does not already like the character, nobody is courted who did not ask to be, partners keep to each other unless everyone involved is open to more than one partner, and intimate scenes always fade to black.\n\nEach step needs a little story time after the last, the other side starts scenes of their own, and every step is told to the table.\n\nRequires Bonds to be on.";

export const NARRATION_GUARD_INFO = "After each turn the server compares the GM's narration against what the dice and tools actually resolved: a hit written on a miss, a death the hit points deny, a damage number no die rolled.\n\nA contradiction is sent back to the GM once for a rewrite. It also does what the GM left undone: a spell a player asked for that the story cast is cast for real, and a kindness or flirt a player declared is recorded on their bonds.\n\nOff costs nothing but the check, and the narration is persisted exactly as written.";

type SaveState = "idle" | "saving" | "saved" | "error";

// Which groups were left open, per campaign, for this browser tab: the
// Settings tab unmounts when another tab is picked, and coming back to a
// group you were in should not mean finding it again.
function openKey(campaignId: string) {
  return `odm.tableSettingsOpen.${campaignId}`;
}

function useOpenGroups(campaignId: string) {
  const [open, setOpen] = useState<TableGroupId[]>([]);
  useEffect(() => {
    let stored: TableGroupId[] = [];
    try {
      const raw = window.sessionStorage.getItem(openKey(campaignId));
      stored = raw ? (JSON.parse(raw) as TableGroupId[]) : [];
    } catch {
      // Storage refused: every group starts closed.
    }
    const timer = window.setTimeout(() => setOpen(Array.isArray(stored) ? stored : []), 0);
    return () => window.clearTimeout(timer);
  }, [campaignId]);
  const toggle = (id: TableGroupId, next: boolean) =>
    setOpen((current) => {
      const updated = next ? [...current.filter((entry) => entry !== id), id] : current.filter((entry) => entry !== id);
      try {
        window.sessionStorage.setItem(openKey(campaignId), JSON.stringify(updated));
      } catch {
        // Kept for this visit only.
      }
      return updated;
    });
  return { isOpen: (id: TableGroupId) => open.includes(id), toggle };
}

// The table's settings, in the lobby and in the Settings tab: whoever steers
// the story edits them live (PATCHes propagate to everyone over SSE), in the
// campaign creator's named groups; other players see a read-only summary.
export function GameSettingsPanel({
  campaignId,
  settings,
  steersStory,
  heading = true,
  solo = false,
  lastingCompanions = false,
}: {
  campaignId: string;
  settings: GameSettings;
  steersStory: boolean;
  // A table of one: the controls that wait on other players are left out.
  solo?: boolean;
  // A lasting AI companion can travel with this party, so its conscience
  // setting can matter (issue 503).
  lastingCompanions?: boolean;
  // The lobby names the section itself, so the panel's own title would say
  // "Table settings" twice.
  heading?: boolean;
}) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const t = useT();
  const voices = useTtsVoices();
  // Narration switched off server-wide (Admin > Speech, or setup's text
  // only): the row reads Off and its switch is held, whatever the table's
  // own switch says, since nothing would be read aloud. A fresh install's
  // first table said "Narration on" with a voice picked, over a note that
  // the server had no narration (issue 275). The stored value is kept, so
  // a server that gains a speech engine later brings the table's choice
  // back. A speech server that is named but not answering is one switch
  // away, and the note under the row says so; only off holds the switch.
  const capabilities = useCapabilities();
  const narrationOff = capabilities?.tts?.provider === "off";
  const narrating = settings.ttsEnabled && !narrationOff;
  // Every control here renders the server's settings, so a refused PATCH
  // changes nothing on screen; without this line it changes nothing silently.
  const [error, setError] = useState("");
  const [packs, setPacks] = useState<WorldPackSummary[]>([]);
  const [find, setFind] = useState("");
  const groups = useOpenGroups(campaignId);
  // Whether any ambience audio is actually on disk. The library ships empty
  // (public/ambience is gitignored and filled by npm run fetch-ambience), so
  // a lead can switch ambience on and hear nothing with no clue why; this
  // powers the hint on the Ambience row. Defaults to true so the hint never
  // flashes on installs that are fine while the answer is in flight.
  const [ambienceInstalled, setAmbienceInstalled] = useState(true);
  const [ambienceCounts, setAmbienceCounts] = useState<Record<"bed" | "music" | "sting", { installed: number; total: number }> | null>(null);
  // What "the server's rule" for rolled stats is, so neither the lead's
  // choice nor a player's summary leaves it unnamed.
  const serverRerollBelow = useServerRerollBelow();
  // A server that cannot transcribe holds the Transcription switch off; the
  // table's stored choice is kept, so transcription added later brings it
  // back.
  const transcribes = transcribesVoice(capabilities);
  // The reroll rule in the reader's words, from the keyed pieces: the lib's
  // describeTableReroll stays English for the campaign creator's data.
  const rerollWords = (below: number): string => {
    const choice = rerollChoiceOf(below);
    if (choice === "keep") return t("The first roll stands", { context: "creator.reroll.keep" });
    if (choice === "free") return t("Reroll as often as you like");
    return t("Reroll a roll totalling under {total}", { total: below });
  };
  const tableRerollWords = (tableSetting: number | null | undefined): string =>
    typeof tableSetting === "number"
      ? rerollWords(tableSetting)
      : serverRerollBelow === null
        ? t("the server's reroll rule")
        : t("the server's rule ({rule})", { rule: rerollWords(serverRerollBelow) });
  const serverRerollLabel = tableRerollWords(null);

  // Installed world packs, so the lead can switch worlds after creation. An
  // empty list simply hides the row.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/worlds")
      .then((response) => (response.ok ? response.json() : { packs: [] }))
      .then((data) => {
        if (!cancelled) {
          setPacks(Array.isArray(data.packs) ? data.packs : []);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Asked lazily like the world packs above, and only when the answer could
  // matter: the hint renders for the lead with ambience switched on, so
  // nobody else pays for the request.
  useEffect(() => {
    if (!steersStory || !settings.ambienceEnabled) {
      return;
    }
    let cancelled = false;
    void fetch("/api/ambience")
      .then((response) => (response.ok ? response.json() : { tracks: {} }))
      .then((data) => {
        if (!cancelled) {
          setAmbienceInstalled(Object.keys(data.tracks ?? {}).length > 0);
          setAmbienceCounts(data.counts ?? null);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [steersStory, settings.ambienceEnabled]);

  // "Saved" stays a moment, then the line goes back to saying how saving works.
  useEffect(() => {
    if (saveState !== "saved") return;
    const timer = window.setTimeout(() => setSaveState("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  async function patch(update: Partial<GameSettings>) {
    setSaveState("saving");
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? t("That change was not saved."));
        setSaveState("error");
        return;
      }
      setSaveState("saved");
    } catch {
      setError(t("Could not reach the server.", { context: "table.errors.unreachable" }));
      setSaveState("error");
    }
  }

  const selectedPack = packs.find((entry) => entry.id === settings.worldPack) ?? null;

  if (!steersStory) {
    return (
      <section className="panel mb-6 rounded-xl p-4" data-table-settings="read">
        {heading ? <SectionHead title={t("Table settings")} glyph="tab-settings" level="h2" /> : null}
        <p className="mb-2 text-xs text-stone-500">
          {settings.dmMode === "ai" ? t("The party lead sets these for everyone at this table.") : t("The GM sets these for everyone at this table.")}
        </p>
        <div className="stagger flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-stone-300">
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "system-region" }} size="size-5" />
            {selectedPack?.name ?? ({ "high_fantasy": t("High fantasy"), "dark_fantasy": t("Dark fantasy"), "mystery": t("Mystery"), "horror": t("Horror"), "cyberpunk": t("Cyberpunk"), "steampunk": t("Steampunk"), "post_apocalyptic": t("Post-apocalyptic"), "custom": t("Custom", { context: "creator.genre.custom" }), "coverAria": t("{name} cover plate"), "humansOnly": t("all-human world") } as Record<string, string>)[settings.genre] ?? String(settings.genre)}
            {settings.dmMode === "human" ? ` · ${t("human GM")}` : settings.dmMode === "steered" ? ` · ${t("AI narrates, a person steers")}` : ""}
            {settings.dmMode !== "human" && settings.aiStorySetup ? ` · ${t("AI story setup", { context: "table.settings.read.storySetup" })}` : ""}
            {settings.dmMode !== "human"
              ? ` · ${t("{length} campaign", { length: ({ "tip": t("How far the GM plans the story ahead (acts, bosses, side quests). Changing it mid-campaign applies when the next saga is planned; any length continues with a sequel saga if you play past the finale."), "short": t("Short", { context: "table.settings.length.short" }), "standard": t("Standard"), "epic": t("Epic") } as Record<string, string>)[settings.campaignLength] ?? String(settings.campaignLength) })}`
              : ""}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "tab-dice" }} size="size-5" />
            {settings.dicePolicy === "real_allowed" ? t("Real dice allowed") : t("Digital only")}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "cue-bell" }} size="size-5" />
            {narrating
              ? t("Narration on ({voice})", { voice: voiceLabel(voices, settings.ttsVoice) })
              : narrationOff
                ? t("Narration off on this server")
                : t("Narration off")}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "tab-ambience" }} size="size-5" />
            {settings.ambienceEnabled
              ? settings.ambienceAuto
                ? t("Ambience on (follows the scene)")
                : t("Ambience on")
              : t("Ambience off")}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "tab-map" }} size="size-5" />
            {settings.mapsEnabled ? t("Maps on") : t("Maps off")}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "rest-level-up" }} size="size-5" />
            {settings.multiclassingEnabled ? t("Multiclassing allowed") : t("Multiclassing off")}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "rest-hp" }} size="size-5" />
            {t(HP_METHOD_SHORT[settings.hpMethod ?? "average"])}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "coin-gp" }} size="size-5" />
            {t(WEALTH_SHORT[settings.startingWealth ?? "equipment"])}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "die-d6" }} size="size-5" />
            {t("Stats: {rule}", { rule: tableRerollWords(settings.abilityRerollBelow).toLowerCase() })}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "tab-friends" }} size="size-5" />
            {settings.midGameJoinOpen ? t("Mid-game joining open") : t("Mid-game joining closed")}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "rest-initiative" }} size="size-5" />
            {settings.holdSubmissions ? t("Lead opens responses each turn") : t("Responses always open")}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "system-storyboard" }} size="size-5" />
            {settings.worldSimulation ? t("Living world on") : t("Living world off")}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "tab-loot" }} size="size-5" />
            {settings.inventoryApprovals && settings.vitalsApprovals
              ? t("Item and vitals changes need approval")
              : settings.inventoryApprovals
                ? t("Item offers need approval")
                : settings.vitalsApprovals
                  ? t("Vitals changes need approval")
                  : t("Item changes auto-apply")}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "tab-bonds" }} size="size-5" />
            {settings.relationships === "off"
              ? t("Bonds off")
              : settings.romance !== "off"
                ? t("Bonds and romance tracked")
                : t("Bonds tracked, romance off")}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "system-party" }} size="size-5" />
            {t("AI companions: {allies}", { allies: ({ "auto": t("Auto (solo: full; multiplayer: guests only)"), "full": t("Party members and guests"), "guests": t("Temporary guests only"), "off": t("Off", { context: "table.settings.companions.off" }) } as Record<string, string>)[settings.companions] ?? String(settings.companions) })}
          </span>
          {conscienceShown(settings, lastingCompanions) ? (
            <span className="flex items-center gap-1.5" data-conscience-setting>
              <GameIcon icon={{ kind: "glyph", key: "tab-bonds" }} size="size-5" />
              {t("Companion conscience: {mode}", {
                mode: ({ "off": t("Off"), "talk": t("Talk"), "leave": t("Leave"), "turn": t("Turn") } as Record<string, string>)[settings.companionConscience ?? "leave"] ?? String(settings.companionConscience ?? "leave"),
              })}
            </span>
          ) : null}
        </div>
        {narrating ? <CharacterVoices campaignId={campaignId} settings={settings} steersStory={false} /> : null}
      </section>
    );
  }

  const context = {
    packName: selectedPack?.name ?? null,
    genreName: ({ "high_fantasy": t("High fantasy"), "dark_fantasy": t("Dark fantasy"), "mystery": t("Mystery"), "horror": t("Horror"), "cyberpunk": t("Cyberpunk"), "steampunk": t("Steampunk"), "post_apocalyptic": t("Post-apocalyptic"), "custom": t("Custom", { context: "creator.genre.custom" }), "coverAria": t("{name} cover plate"), "humansOnly": t("all-human world") } as Record<string, string>)[settings.genre] ?? String(settings.genre),
    voiceName: voiceLabel(voices, settings.ttsVoice),
    narrationOff,
    statsRule: tableRerollWords(settings.abilityRerollBelow).toLowerCase(),
    lastingCompanions,
  };
  const searching = find.trim().length > 0;
  const visible = tableGroups(t, settings)
    .map((group) => ({ ...group, summary: tableGroupSummary(t, group.id, settings, context) }))
    .filter((group) => groupMatches(group, group.summary, find));
  const base = { settings, patch: (update: Partial<GameSettings>) => void patch(update) };

  function body(id: TableGroupId) {
    switch (id) {
      case "world":
        return <WorldGroup {...base} packs={packs} selectedPack={selectedPack} />;
      case "character":
        return <CharacterGroup {...base} serverRerollLabel={serverRerollLabel} />;
      case "narration":
        return <NarrationGroup {...base} campaignId={campaignId} narrating={narrating} narrationOff={narrationOff} />;
      case "atmosphere":
        return <AtmosphereGroup {...base} steersAudio ambienceInstalled={ambienceInstalled} ambienceCounts={ambienceCounts} />;
      case "safety":
        return <SafetyGroup {...base} />;
      case "ai":
        return <AiGroup {...base} />;
      case "memory":
        return <MemoryGroup {...base} />;
      case "bonds":
        return <BondsGroup {...base} lastingCompanions={lastingCompanions} />;
      case "players":
        return <PlayersGroup {...base} solo={solo} />;
      case "console":
        return <ConsoleGroup {...base} />;
      case "board":
        return <BoardGroup {...base} />;
      case "voiceChat":
        return <VoiceChatGroup {...base} transcribes={transcribes} />;
    }
  }

  return (
    <section className="panel mb-6 rounded-xl p-4" data-table-settings="edit">
      {heading ? <SectionHead title={t("Table settings")} glyph="tab-settings" level="h2" /> : null}
      <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500" aria-live="polite">
        <span>{t("Applies to everyone at this table. Each change saves as you make it.")}</span>
        {saveState === "saving" ? (
          <span key="saving" className="live-in inline-flex items-center gap-1 text-stone-400">
            <Loader2 className="size-3 animate-spin" /> {t("Saving")}
          </span>
        ) : saveState === "saved" ? (
          <span key="saved" className="live-in inline-flex items-center gap-1 text-emerald-400">
            <Check className="tick-in size-3" /> {t("Saved", { context: "table.settings.saved" })}
          </span>
        ) : null}
      </p>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-amber-300/70" />
        <input
          value={find}
          onChange={(event) => setFind(event.target.value)}
          placeholder={t("Find a setting")}
          aria-label={t("Find a table setting")}
          className={cn(ui.input, "h-9 pl-9 text-xs")}
        />
      </div>
      {error ? <PanelError className="mb-2">{error}</PanelError> : null}
      <div className="space-y-2 text-xs">
        {visible.map((group) => (
          <DetailGroup
            key={group.id}
            id={group.id}
            title={group.title}
            glyph={group.glyph}
            summary={group.summary}
            // A search opens every group it finds, so the setting is in view.
            open={searching || groups.isOpen(group.id)}
            onToggle={(next) => groups.toggle(group.id, next)}
          >
            {body(group.id)}
          </DetailGroup>
        ))}
        {!visible.length ? <p className="text-stone-500">{t("No setting by that name.")}</p> : null}
      </div>
    </section>
  );
}
