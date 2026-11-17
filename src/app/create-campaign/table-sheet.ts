import type { CampaignDraft, WizardGates } from "@/app/create-campaign/draft";
// Pure still: the translate is only the English fallback for a caller that
// passes no translator (the suites).
import { translate } from "@/lib/messages-logic";

// The table sheet's pure half: which table switches the creator shows, in which
// group, which of them the "features on" total counts, and what a press
// does to the draft. SheetRows draws the rows wherever the essentials and
// experience steps group them; scripts/test-world-portals.mjs
// holds the count to thirteen.

// Which of the table features are switched on, counting only the ones the
// wizard actually showed: a hidden toggle is not a choice the table made.
// The review step reads this so its "n on" agrees with the grid.
export function featuresOn(draft: CampaignDraft, gates: WizardGates): number {
  const { aiNarrates, solo } = gates;
  const bonds = draft.relationships !== "off";
  return [
    aiNarrates && draft.aiStorySetup,
    draft.ttsEnabled,
    draft.mapsEnabled,
    draft.ambienceEnabled,
    draft.ambienceEnabled && draft.ambienceAuto,
    draft.multiclassingEnabled,
    aiNarrates && draft.worldSimulation,
    draft.inventoryApprovals,
    draft.vitalsApprovals,
    bonds,
    bonds && draft.romance !== "off",
    aiNarrates && draft.narrationGuard,
    !solo && draft.midGameJoinOpen,
    !solo && draft.holdSubmissions,
  ].filter(Boolean).length;
}

// The translator a caller hands over (`const t = useT()`).
type Translate = (key: string, vars?: Record<string, string | number>) => string;

export type SheetGroupId = "narration" | "senses" | "people" | "rules";

export type SheetRowKey =
  | "aiStorySetup"
  | "narrationGuard"
  | "worldSimulation"
  | "ttsEnabled"
  | "mapsEnabled"
  | "ambienceEnabled"
  | "ambienceAuto"
  | "presentation"
  | "relationships"
  | "romance"
  | "multiCharacter"
  | "midGameJoinOpen"
  | "holdSubmissions"
  | "multiclassingEnabled"
  | "inventoryApprovals"
  | "vitalsApprovals"
  | "boardDrawing"
  | "enemyIntent";

// Which explainer a row carries; SheetRows maps these to the lobby's texts.
export type SheetInfo = "livingWorld" | "bonds" | "romance" | "narrationGuard";

export type SheetRow = {
  key: SheetRowKey;
  label: string;
  hint: string;
  on: boolean;
  // Where the knob rests: 0 off, 1 on, 0.5 for the middle of the tri-state.
  knob: 0 | 0.5 | 1;
  // True for the thirteen rows featuresOn() adds up.
  counted: boolean;
  disabled: boolean;
  // A row that exists because its parent is on arrives rather than blinks in.
  dependent: boolean;
  info: SheetInfo | null;
};

export type SheetGroup = { id: SheetGroupId; label: string; note: string; rows: SheetRow[] };

type RowSpec = {
  key: SheetRowKey;
  group: SheetGroupId;
  counted: boolean;
  aiOnly?: boolean;
  tableOnly?: boolean;
  needs?: "ambienceEnabled" | "relationships";
  info?: SheetInfo;
};

// Order inside a group is the order on screen. A dependent row sits right
// after its parent so it appears beside the switch that summoned it.
const ROWS: RowSpec[] = [
  { key: "aiStorySetup", group: "narration", counted: true, aiOnly: true },
  { key: "narrationGuard", group: "narration", counted: true, aiOnly: true, info: "narrationGuard" },
  { key: "worldSimulation", group: "narration", counted: true, aiOnly: true, info: "livingWorld" },
  { key: "ttsEnabled", group: "senses", counted: true },
  { key: "mapsEnabled", group: "senses", counted: true },
  { key: "ambienceEnabled", group: "senses", counted: true },
  { key: "ambienceAuto", group: "senses", counted: true, needs: "ambienceEnabled" },
  { key: "presentation", group: "senses", counted: false },
  { key: "relationships", group: "people", counted: true, info: "bonds" },
  { key: "romance", group: "people", counted: true, needs: "relationships", info: "romance" },
  { key: "multiCharacter", group: "people", counted: false },
  { key: "midGameJoinOpen", group: "people", counted: true, tableOnly: true },
  { key: "holdSubmissions", group: "people", counted: true, tableOnly: true },
  { key: "multiclassingEnabled", group: "rules", counted: true },
  { key: "inventoryApprovals", group: "rules", counted: true },
  { key: "vitalsApprovals", group: "rules", counted: true },
  { key: "boardDrawing", group: "rules", counted: false },
  { key: "enemyIntent", group: "rules", counted: false },
];

// The groups' words by key; the keys live with the table sheet group.
const GROUP_KEYS: Record<SheetGroupId, string> = {
  narration: "The narrator",
  senses: "Sight and sound",
  people: "People and the floor",
  rules: "Rules at the table",
};
const GROUP_NOTE_KEYS: Partial<Record<SheetGroupId, string>> = {
  narration: "only with an AI narrator",
};

const GROUPS: SheetGroupId[] = ["narration", "senses", "people", "rules"];

function parentOn(draft: CampaignDraft, needs: RowSpec["needs"]): boolean {
  if (needs === "ambienceEnabled") return draft.ambienceEnabled;
  if (needs === "relationships") return draft.relationships !== "off";
  return true;
}

function gated(spec: RowSpec, gates: WizardGates): boolean {
  return Boolean((spec.aiOnly && !gates.aiNarrates) || (spec.tableOnly && gates.solo));
}

function copy(
  t: Translate,
  spec: RowSpec,
  draft: CampaignDraft,
  gates: WizardGates,
): { label: string; hint: string } {
  switch (spec.key) {
    case "aiStorySetup":
      return { label: t("AI story setup", { context: "tsheet.row.aiStorySetup" }), hint: t("The GM invents the plot") };
    case "narrationGuard":
      return { label: t("Outcome check"), hint: t("Narration that contradicts the dice is rewritten") };
    case "worldSimulation":
      return { label: t("Living world"), hint: t("Off-screen schemes and rumors advance on their own") };
    case "ttsEnabled":
      return {
        label: t("Voice narration"),
        hint: gates.ttsAvailable ? t("Spoken GM narration") : t("No speech service on this server"),
      };
    case "mapsEnabled":
      return {
        label: t("Maps"),
        hint: gates.mapsAvailable ? t("AI-drawn area maps") : t("Drawn once this server can paint pictures"),
      };
    case "ambienceEnabled":
      return { label: t("Ambience"), hint: t("Room tone, music and stings") };
    case "ambienceAuto":
      return { label: t("Sound follows the scene"), hint: t("Off leaves it to the GM") };
    case "presentation":
      return {
        label: t("Theatre inserts"),
        hint: t("A speaking NPC's face over the scene art while their lines play"),
      };
    case "relationships":
      return { label: t("Bonds"), hint: t("NPCs remember how each character treated them") };
    case "romance":
      return { label: t("Romance"), hint: t("Bonds can grow into a relationship") };
    case "multiCharacter":
      return {
        label:
          draft.multiCharacter === "all_active"
            ? t("Several characters each, all fielded")
            : draft.multiCharacter === "one_active"
              ? t("Several characters each, one at a time")
              : t("One character each"),
        hint: t("A player may build more than one; press again to field them all at once (solo tables)"),
      };
    case "midGameJoinOpen":
      return { label: t("Mid-game joining"), hint: t("New players can use the invite code after the start") };
    case "holdSubmissions":
      return { label: t("Held responses"), hint: t("Nobody acts until the party lead opens the floor") };
    case "multiclassingEnabled":
      return { label: t("Multiclassing"), hint: t("Second classes at level-up") };
    case "inventoryApprovals":
      return { label: t("Item offers"), hint: t("Players confirm GM loot and gold changes") };
    case "vitalsApprovals":
      return { label: t("Vitals confirmed"), hint: t("Players confirm GM damage, healing and conditions") };
    case "boardDrawing":
      return {
        label: t("Players draw on the board"),
        hint: t("Plans and circles on the battle map; the GM always may"),
      };
    case "enemyIntent":
      return { label: t("Enemy intent"), hint: t("Show what enemies look likely to do next", { context: "tsheet.row.enemyIntent.hint" }) };
  }
}

function knobOf(key: SheetRowKey, draft: CampaignDraft): 0 | 0.5 | 1 {
  switch (key) {
    case "presentation":
      return draft.presentation === "theatre" ? 1 : 0;
    case "relationships":
      return draft.relationships !== "off" ? 1 : 0;
    case "romance":
      return draft.romance !== "off" ? 1 : 0;
    case "multiCharacter":
      return draft.multiCharacter === "all_active" ? 1 : draft.multiCharacter === "one_active" ? 0.5 : 0;
    default:
      return draft[key] ? 1 : 0;
  }
}

// The groups as the step draws them. A group with nothing to show is left
// out, which is how the narrator block disappears when a person narrates.
export function tableSheet(
  tOrDraft: Translate | CampaignDraft,
  draftArg?: CampaignDraft,
  gatesArg?: WizardGates,
): SheetGroup[] {
  // Both call shapes: the step passes the translator first (t-first, the
  // agoLabel pattern), the suites pass the draft alone — the reading falls
  // back to the dictionary's English.
  const withT = typeof tOrDraft === "function";
  const t = (withT ? tOrDraft : (key: string, vars?: Record<string, string | number>) => translate("en", key, vars)) as Translate;
  const draft = (withT ? draftArg : tOrDraft) as CampaignDraft;
  const gates = (withT ? gatesArg : draftArg) as WizardGates;
  return GROUPS.map((groupId) => ({
    id: groupId,
    label: t(GROUP_KEYS[groupId]),
    note: GROUP_NOTE_KEYS[groupId] ? t(GROUP_NOTE_KEYS[groupId]!) : "",
    rows: ROWS.filter(
      (spec) => spec.group === groupId && !gated(spec, gates) && parentOn(draft, spec.needs),
    ).map((spec) => {
      const knob = knobOf(spec.key, draft);
      return {
        key: spec.key,
        ...copy(t, spec, draft, gates),
        on: knob > 0,
        knob,
        counted: spec.counted,
        // One server switch away rather than a feature this install can
        // never have, so the row stays visible and says why it is off.
        disabled: spec.key === "ttsEnabled" && !gates.ttsAvailable,
        dependent: Boolean(spec.needs),
        info: spec.info ?? null,
      };
    }),
  })).filter((group) => group.rows.length > 0);
}

// How many switches the total could reach in this mode. A dependent row
// counts even while its parent hides it: it is still a choice on offer.
export function countableRows(gates: WizardGates): number {
  return ROWS.filter((spec) => spec.counted && !gated(spec, gates)).length;
}

// What one press does. The tri-state walks off, one at a time, all at once;
// everything else flips.
export function flipRow(draft: CampaignDraft, key: SheetRowKey): Partial<CampaignDraft> {
  switch (key) {
    case "presentation":
      return { presentation: draft.presentation === "theatre" ? "plain" : "theatre" };
    case "relationships":
      return { relationships: draft.relationships !== "off" ? "off" : "on" };
    case "romance":
      return { romance: draft.romance === "off" ? "on" : "off" };
    case "multiCharacter":
      return {
        multiCharacter:
          draft.multiCharacter === "off"
            ? "one_active"
            : draft.multiCharacter === "one_active"
              ? "all_active"
              : "off",
      };
    default:
      return { [key]: !draft[key] };
  }
}
