"use client";

import { ArrowRight, Check, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Select } from "@/components/ui/Select";
import { KitButton } from "@/app/campaigns/[campaignId]/PanelKit";
import { LINK_LABELS, VERACITIES, veracityLabel, newId, type Veracity, type WorldDoc, type WorldLink } from "@/lib/worldforge/model";
import type { WorldEntity } from "@/lib/db/world-forge";
import { EntityAvatar, EntityPicker, typeOf } from "./world-ui";
import { playFieldOf } from "@/lib/worldforge/play-fields";
import { useT } from "@/lib/locale";

// One link, made or edited. The other end is picked from the world's
// entries, the words from WorldForge's own set (the family and chain words
// build the family tree and the chart) or the DM's own, and the link can be
// a hidden truth or a false belief, one way, and carry a rank.

const VERACITY_KEYS: Record<Veracity, string> = { known: "Known", hidden: "Hidden truth", believed: "False belief" };
const CUSTOM = "__custom";

export function LinkEditor({
  doc,
  entities,
  from,
  link,
  onSave,
  onCancel,
}: {
  doc: WorldDoc;
  entities: WorldEntity[];
  from: WorldEntity;
  link: WorldLink | null;
  onSave: (link: WorldLink) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [to, setTo] = useState(link?.to ?? "");
  const known = (LINK_LABELS as readonly string[]).includes(link?.label ?? "member of");
  const [label, setLabel] = useState(link?.label ?? "allied with");
  const [custom, setCustom] = useState(!known);
  const [veracity, setVeracity] = useState<Veracity>(link?.veracity ?? "known");
  const [oneway, setOneway] = useState(link?.oneway ?? false);
  const [rank, setRank] = useState(link?.rank ?? "");
  const target = entities.find((entity) => entity.ref === to) ?? null;
  const ready = Boolean(target && label.trim());

  return (
    <div className="panel motion-pop rounded-lg p-3" data-tour="world-link-editor">
      <div className="mb-2 flex items-center gap-2 text-sm text-stone-300">
        <span className="truncate font-medium text-amber-100">{from.name}</span>
        <ArrowRight className="size-3.5 shrink-0 text-stone-500" />
        {target ? (
          <button type="button" onClick={() => setTo("")} className="flex min-w-0 items-center gap-1.5 rounded-md px-1 hover:bg-stone-800/70 motion-press" title={t("Pick someone else")}>
            <EntityAvatar entity={target} type={typeOf(doc, target)} size="size-5" />
            <span className="truncate text-amber-100">{target.name}</span>
          </button>
        ) : (
          <span className="text-stone-500">{t("who or what?")}</span>
        )}
      </div>
      {!target ? (
        // eslint-disable-next-line jsx-a11y/no-autofocus -- choosing the other end is the first step of the link the author just started
        <EntityPicker doc={doc} entities={entities} exclude={[from.ref]} label={t("the other end")} autoFocus onPick={(entity) => setTo(entity.ref)} />
      ) : (
        <div className="grid gap-2 @lg:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="eyebrow text-[10px] text-stone-500">{t("Words")}</span>
            <Select
              label={t("The link's words")}
              size="sm"
              value={custom ? CUSTOM : label}
              onChange={(value) => {
                if (value === CUSTOM) {
                  setCustom(true);
                  setLabel("");
                } else {
                  setCustom(false);
                  setLabel(value);
                }
              }}
              options={[
                ...LINK_LABELS.map((words) => ({ value: words as string, label: words })),
                { value: CUSTOM, label: t("Other words..."), hint: t("Write your own") },
              ]}
            />
            {custom ? (
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the box appears because the author just chose to write their own words
              <input className={cn(ui.input, "text-xs motion-pop")} maxLength={60} placeholder={t("sworn to")} aria-label={t("Your own words")} value={label} onChange={(event) => setLabel(event.target.value)} autoFocus />
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <span className="eyebrow text-[10px] text-stone-500">{t("Who knows it")}</span>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("Who knows it")}>
              {VERACITIES.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={veracity === value}
                  title={veracityLabel(t, value)}
                  onClick={() => setVeracity(value)}
                  className={cn(ui.btnSmall, "px-2 py-1 text-xs", veracity === value && "border-amber-500/60 bg-amber-400/10 text-amber-100")}
                >
                  {t(VERACITY_KEYS[value])}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-stone-500">{veracityLabel(t, veracity)}</p>
          </div>
          {label === "member of" ? (
            <label className="flex flex-col gap-1 motion-pop">
              <span className="eyebrow text-[10px] text-stone-500">{t("Rank or title")}</span>
              <input className={cn(ui.input, "text-xs")} maxLength={60} placeholder={t("Second Warden")} value={rank} onChange={(event) => setRank(event.target.value)} />
            </label>
          ) : null}
          {from.shelf === "npc" && playFieldOf(label, target.shelf) ? (
            <p className="text-[11px] text-stone-500 @lg:col-span-2" data-testid="world-link-play-note">
              {t("Play keeps its own {field} for {name}. This link changes it only when you choose it under In play on this entry.", { field: playFieldOf(label, target.shelf) ?? "", name: from.name })}
            </p>
          ) : null}
          <label className="flex items-center gap-2 text-xs text-stone-400">
            <input type="checkbox" checked={oneway} onChange={(event) => setOneway(event.target.checked)} className="accent-amber-400" />
            {t("One way: how {name} sees it, not returned", { name: from.name })}
          </label>
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <KitButton tone="small" onClick={onCancel}>
          <X className="size-3.5" /> {t("Cancel")}
        </KitButton>
        <KitButton
          tone="primary"
          disabled={!ready}
          onClick={() => ready && onSave({ id: link?.id ?? newId("l"), from: from.ref, to, label: label.trim(), veracity, oneway, rank: label === "member of" ? rank.trim() : "" })}
        >
          <Check className="size-3.5" /> {link ? t("Save link") : t("Add link")}
        </KitButton>
      </div>
    </div>
  );
}
