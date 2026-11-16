"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { GameIcon } from "@/components/ui/GameIcon";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ui } from "@/lib/ui";
import { cn } from "@/lib/cn";
import type { DefaultsState } from "@/app/create-campaign/useCampaignDefaults";
import { useT } from "@/lib/locale";

// The creator's half of personal campaign defaults
// (src/lib/campaign-defaults.ts): the bar on the first step that says what
// this campaign started from, the panel on the review step that saves it, and
// the manager both open. Saving is always a press of its own: creating a
// campaign never changes the defaults, and saving them never creates one.

export type StartFrom = "mine" | "app";

export type DefaultsActions = {
  state: DefaultsState;
  startFrom: StartFrom;
  // The saved defaults arrived after the person had begun, so none of them
  // were laid over what they typed.
  late: boolean;
  // What applying them left alone, and why.
  kept: string[];
  busy: boolean;
  message: { tone: "ok" | "error"; text: string } | null;
  onUseMine: () => void;
  onUseApp: () => void;
  onSave: () => void;
  onRemove: () => void;
  onManage: () => void;
};

// What the manager lists as saved alongside the defaults, as dictionary keys
// (the words live in en.ts and fr.ts).
const SAVED_GROUP_KEYS = [
  "Who runs the game, party size, starting level and difficulty",
  "The setting, a custom world's description and the table language",
  "Campaign length, AI story setup, the outcome check and the living world",
  "Character creation: hit points, starting wealth, rolled stats, dice and multiclassing",
  "Narration, the narrator's voice and pace, and how characters are voiced",
  "Maps, ambience, theatre inserts, drawing on the board and enemy intent",
  "AI allies and their limits, bonds and romance",
  "Characters per player, mid-game joining, held responses and approvals",
  "Safety: boundaries, the X-card, lines and veils, strictness and tone",
  "Variant rules and your house rules",
  "Live voice chat and its rules",
] as const;

const savedOn = (iso: string) => {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "";
};

export function DefaultsBar({ actions }: { actions: DefaultsActions }) {
  const t = useT();
  const { state, startFrom, late, kept } = actions;
  // Nothing saved yet: one quiet line, since there is nothing to choose
  // between before the person has made a table worth keeping. Saving it
  // waits on the review step, and Manage stays a tap away.
  if (state.status === "none" && !kept.length) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-stone-500" role="status">
        <GameIcon icon={{ kind: "glyph", key: "ui-pin" }} size="size-4" className="shrink-0" />
        <span className="min-w-0 flex-1">{t("Starting from the app's defaults. Like this table? Save it as your usual one on the last step.")}</span>
        <button type="button" onClick={actions.onManage} className="cc-link">
          {t("About defaults")}
        </button>
      </p>
    );
  }
  const line =
    state.status === "loading"
      ? t("Looking for your saved defaults...")
      : state.status === "unavailable"
        ? t("Your saved defaults could not be read ({error}). This campaign starts from the app's defaults.", { error: state.error })
        : state.status === "none"
          ? t("Starting from the app's defaults. Set this table up the way you like it, then save it as your defaults on the review step.")
          : late && startFrom === "app"
            ? t("Your saved defaults arrived after you began, so nothing you set was changed. Choose My defaults to use them.")
            : startFrom === "mine"
              ? savedOn(state.defaults.savedAt)
                ? t("Starting from your saved defaults (saved {date}). The name, premise, theme, world pack, lore and prep stay this campaign's own.", { date: savedOn(state.defaults.savedAt) })
                : t("Starting from your saved defaults. The name, premise, theme, world pack, lore and prep stay this campaign's own.")
              : t("Starting from the app's defaults. Your saved defaults are one press away.");
  return (
    <div className="cc-defaults" role="group" aria-label={t("Starting point")}>
      <GameIcon icon={{ kind: "glyph", key: "ui-pin" }} size="size-5" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="cc-eyebrow block">{t("Starting point")}</span>
        <p className="mt-0.5 text-xs leading-relaxed text-stone-400" role="status">
          {line}
          {kept.length ? t(" Kept: {list}.", { list: kept.join("; ") }) : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {state.status === "saved" ? (
          <SegmentedControl<StartFrom>
            size="sm"
            label={t("Start from")}
            value={startFrom}
            onChange={(value) => (value === "mine" ? actions.onUseMine() : actions.onUseApp())}
            options={[
              { value: "mine", label: t("My defaults") },
              { value: "app", label: t("App defaults") },
            ]}
          />
        ) : null}
        <button type="button" onClick={actions.onManage} className="cc-link">
          {t("Manage")}
        </button>
      </div>
    </div>
  );
}

export function DefaultsPanel({ actions }: { actions: DefaultsActions }) {
  const t = useT();
  const saved = actions.state.status === "saved";
  return (
    <div className="cc-field">
      <div className="cc-field-head">
        <span className="cc-eyebrow">{t("Your usual table")}</span>
        <span className="cc-note">{saved ? t("you have saved defaults") : t("nothing saved yet")}</span>
      </div>
      <p className="text-xs leading-relaxed text-stone-400">{t("Save these choices as your defaults and every campaign you make after this one starts from them. Saving never creates a campaign, and creating one never changes your defaults.")}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button type="button" onClick={actions.onSave} disabled={actions.busy || actions.state.status === "loading"} className={ui.btnSmall}>
          {actions.busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {saved ? t("Update my defaults") : t("Save as my defaults")}
        </button>
        <button type="button" onClick={actions.onManage} className="cc-link">
          {t("Manage defaults")}
        </button>
      </div>
      <DefaultsMessage actions={actions} />
    </div>
  );
}

function DefaultsMessage({ actions }: { actions: DefaultsActions }) {
  if (!actions.message) {
    return null;
  }
  return (
    <p role="status" className={cn("mt-2 text-xs", actions.message.tone === "error" ? "text-red-400" : "text-emerald-300")}>
      {actions.message.text}
    </p>
  );
}

export function DefaultsDialog({
  open,
  onOpenChange,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: DefaultsActions;
}) {
  const [confirming, setConfirming] = useState(false);
  const t = useT();
  const { state } = actions;
  const saved = state.status === "saved";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setConfirming(false);
        onOpenChange(next);
      }}
      title={t("Your campaign defaults")}
      width="w-[min(92vw,36rem)]"
    >
      <div className="space-y-3 text-sm">
        <p className="text-stone-400">{t("Save the table you usually run, and every new campaign you make starts from it. They belong to your account on this server. Campaigns you already made keep their own settings; changing your defaults never changes them.")}</p>
        <div className="cc-field">
          <span className="cc-eyebrow mb-1.5 block">{t("Saved with your defaults")}</span>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-stone-300">
            {SAVED_GROUP_KEYS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-stone-500">{t("Never saved: the title, premise, theme, world pack, starting lore and imported prep. Those belong to one campaign.")}</p>
        <p className="text-xs text-stone-400" role="status">
          {state.status === "loading"
            ? t("Looking for your saved defaults...")
            : state.status === "unavailable"
              ? t("Your saved defaults could not be read: {error}", { error: state.error })
              : saved
                ? `${savedOn(state.defaults.savedAt) ? t("You saved defaults on {date}.", { date: savedOn(state.defaults.savedAt) }) : t("You saved defaults.")} ${actions.startFrom === "mine" ? t("This campaign is starting from them.") : t("This campaign is starting from the app's defaults.")}`
                : t("You have not saved any defaults yet.")}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={actions.onSave} disabled={actions.busy || state.status === "loading"} className={ui.btnPrimary}>
            {actions.busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {saved ? t("Update with this campaign's choices") : t("Save this campaign's choices")}
          </button>
          {saved ? (
            <button type="button" onClick={actions.onUseMine} className={ui.btnSmall}>
              {t("Start this campaign from my defaults")}
            </button>
          ) : null}
          <button type="button" onClick={actions.onUseApp} className={ui.btnSmall}>
            {t("Start from the app's defaults")}
          </button>
        </div>
        {saved ? (
          confirming ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-900/50 bg-red-950/20 p-2.5 text-xs text-stone-300">
              <span className="min-w-0 flex-1">{t("Remove your saved defaults? No campaign changes, and this one keeps what it has.")}</span>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  actions.onRemove();
                }}
                className={cn(ui.btnSmall, "border-red-800/60 text-red-300 hover:text-red-200")}
              >
                {t("Remove", { context: "creator.defaults.remove" })}
              </button>
              <button type="button" onClick={() => setConfirming(false)} className={ui.btnSmall}>
                {t("Keep them")}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="cc-link text-red-300/80 hover:text-red-200">
              {t("Remove my saved defaults")}
            </button>
          )
        ) : null}
        <DefaultsMessage actions={actions} />
      </div>
    </Dialog>
  );
}
