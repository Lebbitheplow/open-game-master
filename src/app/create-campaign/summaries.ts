import { TABLE_LANGUAGE_LABELS } from "@/lib/schemas/game-settings-options";
import type { CampaignDraft, WizardGates } from "@/app/create-campaign/draft";
import { bringsSomething } from "@/app/workshop/ContentImportPicker";
import { pluralOf } from "@/lib/messages-logic";

// The one line under each group's name, and the review's read-back of what
// is inside the groups. Worked out from the draft only, so a closed group
// still says truthfully what it holds. The words live in the dictionaries
// under creator.summary.*; each function takes the translator from the
// component that draws it (home/types.ts's agoLabel is the same pattern),
// with the English line as the source of every wording. Pure otherwise: no
// database, no model, and no React.

// The translator a component hands over (`const t = useT()`).
type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function worldSummary(t: Translate, draft: CampaignDraft, gates: WizardGates, packName: string | null): string {
  return [
    packName ?? t("No world pack"),
    TABLE_LANGUAGE_LABELS[draft.tableLanguage],
    gates.aiNarrates ? ({ "short": t("short length"), "standard": t("standard length"), "epic": t("epic length") } as Record<string, string>)[draft.campaignLength] ?? String(draft.campaignLength) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function characterSummary(t: Translate, draft: CampaignDraft): string {
  return [
    ({ "average": t("average hit points"), "rolled": t("rolled hit points"), "max": t("maximum hit points") } as Record<string, string>)[draft.hpMethod] ?? String(draft.hpMethod),
    draft.startingWealth === "equipment" ? t("starting kit") : t("rolled gold"),
    draft.dicePolicy === "digital_only" ? t("digital dice") : t("real dice allowed"),
    draft.multiclassingEnabled ? t("multiclassing on") : t("multiclassing off"),
  ].join(" · ");
}

export function prepSummary(t: Translate, draft: CampaignDraft, sourceTitle: string | null): string {
  const tp = pluralOf(t);
  const lore = draft.loreDrafts.filter((entry) => entry.title.trim()).length;
  const importing = bringsSomething(draft.contentImport);
  return [
    draft.houseRules.trim() ? t("house rules written") : t("no house rules"),
    lore ? tp("{count} lore entry", "{count} lore entries", { count: lore }) : t("no lore yet"),
    importing ? t("prep from {title}", { title: sourceTitle ?? t("a workshop") }) : t("no prep brought in"),
  ].join(" · ");
}

export function narrationSummary(t: Translate, draft: CampaignDraft, gates: WizardGates, voiceName: string): string {
  if (!gates.ttsAvailable) {
    return t("Not read aloud: this server has no speech service");
  }
  if (!draft.ttsEnabled) {
    return t("Off: nothing is read aloud");
  }
  return t("{voice} at {speed}× · {casting}", {
    voice: voiceName,
    speed: draft.ttsSpeed.toFixed(2),
    casting: draft.ttsAutoCast ? t("each speaker gets a voice") : t("the narrator reads the characters"),
  });
}

export function safetySummary(t: Translate, draft: Pick<CampaignDraft, "safety" | "gm">): string {
  const tp = pluralOf(t);
  const { safety, gm } = draft;
  const lists = [
    safety.lines.length ? tp("{count} line", "{count} lines", { count: safety.lines.length }) : null,
    safety.veils.length ? tp("{count} veil", "{count} veils", { count: safety.veils.length }) : null,
  ].filter(Boolean);
  return [
    ({ "family": t("All ages"), "standard": t("Standard"), "mature": t("Mature") } as Record<string, string>)[safety.boundaries] ?? String(safety.boundaries),
    safety.xCard ? t("X-card on") : t("X-card off"),
    lists.length ? lists.join(", ") : t("no lines or veils"),
    ({ "lenient": t("lenient"), "standard": t("by the book"), "harsh": t("harsh") } as Record<string, string>)[gm.strictness] ?? String(gm.strictness),
    gm.tone.length ? gm.tone.map((tone) => t(tone)).join(", ") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function aiSummary(t: Translate, draft: CampaignDraft): string {
  return [
    draft.aiStorySetup ? t("story setup on") : t("story setup off"),
    draft.narrationGuard ? t("outcome check on") : t("outcome check off"),
    draft.worldSimulation ? t("living world on") : t("living world off"),
    t("allies: {allies}", { allies: ({ "auto": t("automatic"), "full": t("party members and guests"), "guests": t("guests only"), "off": t("off") } as Record<string, string>)[draft.companions] ?? String(draft.companions) }),
  ].join(" · ");
}

export function bondsSummary(t: Translate, draft: Pick<CampaignDraft, "relationships" | "romance">): string {
  if (draft.relationships === "off") {
    return t("Bonds off");
  }
  return draft.romance === "off" ? t("Bonds on, romance off") : t("Bonds and romance on");
}

export function playersSummary(t: Translate, draft: CampaignDraft, gates: WizardGates): string {
  return [
    draft.multiCharacter === "off"
      ? t("one character each")
      : draft.multiCharacter === "one_active"
        ? t("several characters, one at a time")
        : t("several characters, all fielded"),
    gates.solo ? null : draft.midGameJoinOpen ? t("joining mid-game open") : t("joining mid-game closed"),
    gates.solo ? null : draft.holdSubmissions ? t("held responses") : null,
    draft.inventoryApprovals || draft.vitalsApprovals ? t("players confirm changes") : t("changes apply at once"),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function boardSummary(t: Translate, draft: Pick<CampaignDraft, "boardDrawing" | "enemyIntent">): string {
  return [
    draft.boardDrawing ? t("Drawing on") : t("Drawing off"),
    draft.enemyIntent ? t("enemy intent shown") : t("enemy intent hidden"),
  ].join(" · ");
}

export function variantSummary(t: Translate, draft: Pick<CampaignDraft, "variantRules">): string {
  const { restVariant, ...toggles } = draft.variantRules;
  const on = Object.values(toggles).filter(Boolean).length;
  return `${on ? t("{count} on", { count: on }) : t("None on")} · ${({ "standard": t("standard rests"), "gritty": t("gritty rests"), "heroic": t("heroic rests") } as Record<string, string>)[restVariant] ?? String(restVariant)}`;
}

export function voiceChatSummary(t: Translate, draft: Pick<CampaignDraft, "voiceChat">): string {
  return voiceSummary(t, draft.voiceChat);
}

// The live table's settings call it `voice`; the creator's draft `voiceChat`.
export function voiceSummary(t: Translate, voice: CampaignDraft["voiceChat"]): string {
  if (!voice.enabled) {
    return t("Off", { context: "creator.summary.voiceOff" });
  }
  return [
    t("On", { context: "creator.summary.voiceOn" }),
    ({ "off": t("turns ignored"), "soft": t("turns shown"), "strict": t("turns enforced") } as Record<string, string>)[voice.turnEnforcement] ?? String(voice.turnEnforcement),
    voice.rules.proximity ? t("proximity, {feet} ft", { feet: voice.rules.hearingRangeFeet }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// Whether the table has rules beyond the book: any variant rule, a rest
// variant, or house rules typed here.
export function customRules(t: Translate, draft: CampaignDraft): string | null {
  const tp = pluralOf(t);
  const { restVariant, ...toggles } = draft.variantRules;
  const on = Object.values(toggles).filter(Boolean).length;
  const parts = [
    on ? tp("{count} variant rule", "{count} variant rules", { count: on }) : null,
    restVariant !== "standard" ? ({ "standard": t("standard rests"), "gritty": t("gritty rests"), "heroic": t("heroic rests") } as Record<string, string>)[restVariant] ?? String(restVariant) : null,
    draft.houseRules.trim() ? t("house rules") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
