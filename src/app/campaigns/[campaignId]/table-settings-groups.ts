import { STAGES, isStageEnabled } from "@/lib/dm/stages";
import type { GameSettings } from "@/lib/schemas/game-settings";
import { DELEGATIONS } from "@/lib/dm/delegation";
import { TABLE_LANGUAGE_LABELS } from "@/lib/schemas/game-settings-options";
import { bondsSummary, boardSummary, safetySummary, voiceSummary } from "@/app/create-campaign/summaries";
import { textKey } from "@/lib/language/text-logic";

// The live table's settings, in the named groups the campaign creator taught
// (src/app/create-campaign/groups.ts): a lead who met "Bonds and romance"
// while making the table finds it under the same name in the lobby and in
// play. Which groups a table shows, what each says on its closed face, and
// which group holds a row another panel links to. The words are the
// dictionaries': every function takes the translator from the surface that
// draws it (agoLabel's pattern), and the group titles reuse the creator's own
// keys so the two surfaces never disagree about a group's name. Pure, for
// scripts/test-table-settings-groups.mjs.

// The translator a component hands over (`const t = useT()`).
type Translate = (key: string, vars?: Record<string, string | number>) => string;

export type TableGroupId =
  | "world"
  | "character"
  | "narration"
  | "atmosphere"
  | "safety"
  | "ai"
  | "memory"
  | "bonds"
  | "players"
  | "console"
  | "board"
  | "voiceChat";

export type TableGroup = { id: TableGroupId; title: string; glyph: string };

// What the panel needs to know besides the settings themselves.
export type TableGroupContext = {
  // The name of the world pack, when the table has one installed here.
  packName: string | null;
  // The genre preset's name, for a table without a pack.
  genreName: string;
  // The narration voice's display name.
  voiceName: string;
  // Narration is off for the whole server (Admin > Speech).
  narrationOff: boolean;
  // The server's own rule for rolled stats, in words.
  statsRule: string;
  // A lasting AI companion can travel with this party (src/lib/schemas/
  // game-settings.ts resolveCompanionMode is full, or one already does).
  lastingCompanions?: boolean;
};

const ORDER: TableGroupId[] = [
  "world",
  "character",
  "narration",
  "atmosphere",
  "safety",
  "ai",
  "memory",
  "bonds",
  "players",
  "console",
  "board",
  "voiceChat",
];

const GLYPHS: Record<TableGroupId, string> = {
  world: "system-world",
  character: "tab-characters",
  narration: "cue-bell",
  atmosphere: "tab-ambience",
  safety: "ui-lock",
  ai: "ui-ai",
  memory: "tab-facts",
  bonds: "tab-bonds",
  players: "tab-party",
  console: "tab-dm",
  board: "tab-battle",
  voiceChat: "ui-voice",
};

const onOff = (on: boolean) => (on ? "on" : "off");

// The allies row lives in this group at a table a person runs too, where
// it shows only once an Off or guests-only setting shuts companions out.
export function alliesShown(settings: GameSettings): boolean {
  return settings.dmMode !== "human" || settings.companions === "off" || settings.companions === "guests";
}

// Companion conscience (issue 503) shows only where it can matter: bonds on
// and a lasting companion possible at this table (settings rule 4).
export function conscienceShown(settings: GameSettings, lastingCompanions: boolean): boolean {
  return settings.relationships !== "off" && lastingCompanions;
}

function titleKey(id: TableGroupId, settings: GameSettings): string {
  const aiNarrates = settings.dmMode !== "human";
  switch (id) {
    // The creator's own names for the groups it taught (creator.group.*):
    // the same words in both dictionaries.
    case "world":
      return "World and story";
    case "character":
      return "Character creation";
    case "narration":
      return "Narration and character voices";
    case "atmosphere":
      return "Atmosphere";
    case "safety":
      return "Safety and boundaries";
    case "ai":
      return aiNarrates ? "AI storytelling and allies" : "Allies";
    case "memory":
      return "Narrator memory";
    case "bonds":
      return "Bonds and romance";
    case "players":
      return "Players and permissions";
    case "console":
      return "GM reminders";
    case "board":
      return "The battle board";
    case "voiceChat":
      return "Live voice chat";
  }
}

function title(t: Translate, id: TableGroupId, settings: GameSettings): string {
  return t(titleKey(id, settings));
}

function shown(id: TableGroupId, settings: GameSettings): boolean {
  const aiNarrates = settings.dmMode !== "human";
  if (id === "ai") return aiNarrates || alliesShown(settings);
  // The narrator's pipeline only exists where the AI narrates.
  if (id === "memory") return aiNarrates;
  // Only the DM seat is ever nudged to write the story down.
  if (id === "console") return settings.dmMode !== "ai";
  return true;
}

// The groups this table shows, in the creator's order.
export function tableGroups(t: Translate, settings: GameSettings): TableGroup[] {
  return ORDER.filter((id) => shown(id, settings)).map((id) => ({ id, title: title(t, id, settings), glyph: GLYPHS[id] }));
}

function assistWords(t: Translate, settings: GameSettings): string {
  const helps = DELEGATIONS.filter((which) => settings.dmAssist[which]).map((which) => ({ "monsters": t("the monsters"), "narration": t("reading beats aloud"), "cover": t("covering for you") } as Record<string, string>)[which] ?? String(which));
  return helps.length ? t("AI helps with {helps}", { helps: helps.join(", ") }) : t("AI helps with nothing");
}

// The line on a closed group's face: what is set inside, never a count to
// fill up.
export function tableGroupSummary(t: Translate, id: TableGroupId, settings: GameSettings, context: TableGroupContext): string {
  const aiNarrates = settings.dmMode !== "human";
  switch (id) {
    case "world":
      return [
        context.packName ?? context.genreName,
        TABLE_LANGUAGE_LABELS[settings.tableLanguage],
        aiNarrates ? ({ "short": t("short length"), "standard": t("standard length"), "epic": t("epic length") } as Record<string, string>)[settings.campaignLength] ?? String(settings.campaignLength) : null,
      ]
        .filter(Boolean)
        .join(" · ");
    case "character":
      return [
        ({ "average": t("average hit points"), "rolled": t("rolled hit points"), "max": t("maximum hit points") } as Record<string, string>)[settings.hpMethod ?? "average"] ?? String(settings.hpMethod ?? "average"),
        settings.startingWealth === "rolled" ? t("rolled gold") : t("starting kit"),
        settings.dicePolicy === "real_allowed" ? t("real dice allowed") : t("digital dice"),
        t("stats: {rule}", { rule: context.statsRule }),
        ({ "on": t("multiclassing on"), "off": t("multiclassing off") } as Record<string, string>)[onOff(settings.multiclassingEnabled)] ?? String(onOff(settings.multiclassingEnabled)),
      ].join(" · ");
    case "narration":
      if (context.narrationOff) return t("Off on this server: nothing is read aloud");
      return settings.ttsEnabled
        ? t("Read aloud · {voice}", { voice: context.voiceName })
        : t("Off: nothing is read aloud");
    case "atmosphere":
      return [
        settings.mapsEnabled ? t("maps on") : t("maps off"),
        settings.ambienceEnabled
          ? settings.ambienceAuto
            ? t("ambience on, follows the scene")
            : t("ambience on")
          : t("ambience off"),
        settings.presentation === "theatre"
          ? t("theatre inserts on")
          : t("theatre inserts off"),
      ].join(" · ");
    case "safety":
      return safetySummary(t, settings);
    case "ai":
      return [
        settings.dmMode === "assisted" ? assistWords(t, settings) : null,
        aiNarrates ? ({ "on": t("story setup on"), "off": t("story setup off") } as Record<string, string>)[onOff(settings.aiStorySetup)] ?? String(onOff(settings.aiStorySetup)) : null,
        aiNarrates ? ({ "on": t("outcome check on"), "off": t("outcome check off") } as Record<string, string>)[onOff(settings.narrationGuard)] ?? String(onOff(settings.narrationGuard)) : null,
        aiNarrates && settings.narrationLength !== "standard"
          ? ({ "short": t("short narration"), "standard": t("standard narration"), "rich": t("rich narration") } as Record<string, string>)[settings.narrationLength] ?? String(settings.narrationLength)
          : null,
        aiNarrates && settings.styleNotes ? t("style notes set") : null,
        aiNarrates && (settings.combatPace ?? "balanced") !== "balanced"
          ? settings.combatPace === "rare"
            ? t("fewer fights")
            : t("more fights")
          : null,
        aiNarrates ? ({ "on": t("living world on"), "off": t("living world off") } as Record<string, string>)[onOff(settings.worldSimulation)] ?? String(onOff(settings.worldSimulation)) : null,
        alliesShown(settings) ? t("allies: {allies}", { allies: ({ "auto": t("automatic"), "full": t("party members and guests"), "guests": t("guests only"), "off": t("off") } as Record<string, string>)[settings.companions] ?? String(settings.companions) }) : null,
      ]
        .filter(Boolean)
        .join(" · ");
    case "memory": {
      const off = STAGES.filter((stage) => !isStageEnabled(settings.stages, stage.id));
      return off.length
        ? t("Off: {stages}", { stages: off.map((stage) => t(stage.label).toLowerCase()).join(", ") })
        : t("Everything on, as most tables keep it");
    }
    case "bonds": {
      const summary = bondsSummary(t, settings);
      return conscienceShown(settings, context.lastingCompanions ?? false)
        ? `${summary} · ${({ "off": t("companions off"), "talk": t("companions talk only"), "leave": t("companions may leave"), "turn": t("companions may turn") } as Record<string, string>)[settings.companionConscience ?? "leave"] ?? String(settings.companionConscience ?? "leave")}`
        : summary;
    }
    case "players":
      return [
        ({ "open": t("joining mid-game open"), "closed": t("joining mid-game closed") } as Record<string, string>)[settings.midGameJoinOpen ? "open" : "closed"] ?? String(settings.midGameJoinOpen ? "open" : "closed"),
        settings.holdSubmissions ? t("held responses") : null,
        settings.waitForTable ? t("GM waits for the table") : null,
        settings.inventoryApprovals || settings.vitalsApprovals
          ? t("players confirm changes")
          : t("changes apply at once"),
      ]
        .filter(Boolean)
        .join(" · ");
    case "console": {
      const { messages, rolls } = settings.beatReminder;
      if (!messages && !rolls) return t("Never reminded");
      return [
        messages ? t("after {count} actions", { count: messages }) : null,
        rolls ? t("after {count} rolls", { count: rolls }) : null,
      ]
        .filter(Boolean)
        .join(t(" or "));
    }
    case "board":
      return boardSummary(t, settings);
    case "voiceChat":
      return voiceSummary(t, settings.voice);
  }
}

// Rows other panels link to (data-settings-row), and the group holding each,
// so a link can open the group before it brings the row into view.
export const ROW_GROUP: Record<string, TableGroupId> = {
  allies: "ai",
  "table-language": "world",
};

// Words a person might search for that the group's title and summary do not
// say: the controls' own labels and the everyday names for them.
const KEYWORDS: Record<TableGroupId, string> = {
  world: "world pack setting genre universe language length saga custom",
  character: "dice real dice digital hit points hp level wealth gold kit gear stats ability scores reroll 4d6 multiclass multiclassing class",
  narration: "narration narrator voice voices read aloud speech tts speak pace character voices volume",
  atmosphere: "theme appearance woodland gothic arcane maps map ambience music sound audio scene theatre inserts faces portraits",
  safety: "safety x-card lines veils boundaries content tone strictness dc family mature",
  ai: "ai story setup plot outcome check prose narration length short rich verbose style notes voice pacing living world simulation allies companions guests party members assist monsters cover",
  memory: "memory history compaction recall retrieval rules lore chapter summaries stages model advanced",
  bonds: "bonds relationships standing romance conscience companions values deeds ultimatum leave turn",
  players: "players permissions mid-game joining invite held responses floor item offers loot gold vitals damage healing approvals confirm",
  console: "gm dm reminders remind nudge beats record",
  board: "battle board draw drawing enemy intent",
  voiceChat: "voice chat call microphone mic talk proximity hearing whisper shout walls downed deaf transcription transcribe turns",
};

// Whether a group answers what was typed into the panel's search: every word
// must appear in its title, its summary or its keywords.
export function groupMatches(group: TableGroup, summary: string, query: string): boolean {
  const words = textKey(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const haystack = textKey(`${group.title} ${summary} ${KEYWORDS[group.id]}`);
  return words.every((word) => haystack.includes(word));
}
