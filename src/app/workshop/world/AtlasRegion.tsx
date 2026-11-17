"use client";

import { Check, Globe2, Link2, Undo2, Unlink, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { KitButton } from "@/app/campaigns/[campaignId]/PanelKit";
import type { BackdropPlan, PlacePlan, Placement, RegionBridge } from "@/lib/db/atlas-region";
import type { Cell } from "@/lib/worldforge/atlas-frame";
import { isUploadedImagePath } from "@/lib/uploads";
import { parseRef, type AtlasMap, type Pin } from "@/lib/worldforge/model";
import type { WorldApi, WorldState } from "./useWorld";
import { useT, useTp } from "@/lib/locale";

// The Atlas's side of the bridge to the playable Region map (audit finding
// WF-09; the server half is src/lib/db/atlas-region.ts). Three explicit
// steps, each reviewed before anything changes:
//
//   - "Use as Region backdrop": the Region shows this map's own picture,
//     and the map stands over the Region.
//   - "Place in Region": a pin naming a place moves the place's Region
//     marker to the square under it, and from then on the two move together.
//   - "Stop using as the Region" and "Release from the Region": the
//     binding ends and nothing moves.
//
// A move that took the other side with it says so, with an Undo, and a
// bound pin whose place was moved elsewhere (a Region reroll, another
// picture) is listed as out of step until someone puts it back.

export type RegionStep =
  | { kind: "backdrop"; plan: BackdropPlan }
  | { kind: "places"; plan: PlacePlan; pinIds: string[] | null }
  | { kind: "unlink"; map: AtlasMap; clearable: boolean };

export type RegionNotice = { text: string; undo?: () => Promise<unknown> };

export const cellText = (cell: Cell | null, t?: (key: string, vars?: Record<string, string | number>) => string) =>
  cell ? `column ${cell.x + 1}, row ${cell.y + 1}` : (t?.("not on the Region yet") ?? "not on the Region yet");

// A pin can be placed when it names a place and stands on the map over the
// Region.
export const namesPlace = (pin: Pick<Pin, "ref">) => parseRef(pin.ref)?.shelf === "location";
export const isBound = (pin: Pin, atlas: AtlasMap | null) => Boolean(atlas?.role === "region" && pin.mapId === atlas.id && pin.regionLink && pin.regionLink === pin.ref);

export function useAtlasRegion(api: WorldApi, world: WorldState) {
  const t = useT();
  const tp = useTp();
  const [bridge, setBridge] = useState<RegionBridge | null>(null);
  const [step, setStep] = useState<RegionStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<RegionNotice | null>(null);
  const { readRegion, region } = api;
  const { maps, pins } = world.doc;

  // Read again whenever the maps or pins change, here or from the Region's
  // side (a marker dragged there moves its pin, and the world is read again).
  useEffect(() => {
    let cancelled = false;
    void readRegion().then((answer) => {
      if (!cancelled) setBridge(answer);
    });
    return () => {
      cancelled = true;
    };
  }, [readRegion, maps, pins]);

  const run = useCallback(async <T,>(work: () => Promise<T>) => {
    setBusy(true);
    try {
      return await work();
    } finally {
      setBusy(false);
    }
  }, []);

  const reviewBackdrop = (mapId: string) =>
    run(async () => {
      setNotice(null);
      const plan = (await region("POST", "backdrop", { mapId })) as BackdropPlan | null;
      if (plan) setStep({ kind: "backdrop", plan });
    });

  const reviewPlaces = (pinIds: string[] | null) =>
    run(async () => {
      setNotice(null);
      const plan = (await region("POST", "places", pinIds ? { pinIds } : {})) as PlacePlan | null;
      if (plan) setStep({ kind: "places", plan, pinIds });
    });

  const askUnlink = (map: AtlasMap) => {
    setNotice(null);
    setStep({ kind: "unlink", map, clearable: Boolean(bridge?.backdropIsMap) });
  };

  const apply = (choice?: { clear?: boolean }) =>
    run(async () => {
      if (!step) return;
      if (step.kind === "backdrop") {
        const done = (await region("POST", "backdrop", { mapId: step.plan.map.id, apply: true })) as BackdropPlan | null;
        if (!done) return;
        setNotice({ text: t("{name} is now the Region's picture.", { name: done.map.name }) + (done.placements.length ? ` ${movedText(done.placements, t)}` : "") });
      } else if (step.kind === "places") {
        // Undo is for pins this step bound: they are released, then their
        // places go back. A pin that was bound already stays bound.
        const fresh = new Set(pins.filter((pin) => !pin.regionLink).map((pin) => pin.id));
        const done = (await region("POST", "places", { ...(step.pinIds ? { pinIds: step.pinIds } : {}), apply: true })) as PlacePlan | null;
        if (!done) return;
        const undone = done.placements.filter((placement) => fresh.has(placement.pinId));
        setNotice({
          text: tp("{name} is placed in the Region and moves with its pin.", "{count} places are placed in the Region and move with their pins.", { count: done.placements.length, name: done.placements[0]?.name ?? "" }),
          undo: undone.length && undone.length === done.placements.length ? () => unplace(undone) : undefined,
        });
      } else {
        const done = await region("DELETE", "backdrop", undefined, choice?.clear ? "?clear=1" : "");
        if (!done) return;
        setNotice({ text: t("{name} no longer stands over the Region. Every place stayed where it is.", { name: step.map.name }) });
      }
      setStep(null);
    });

  // "Place in Region" taken back: the pins are released first, so their
  // places go back without taking the pins along, then each place returns
  // to where it stood through the Region's own route. A place that had no
  // Region spot before keeps the new one.
  const unplace = async (placements: Placement[]) => {
    await region("DELETE", "places", { pinIds: placements.map((placement) => placement.pinId) });
    for (const placement of placements) {
      if (placement.before && !sameCell(placement.before, placement.after)) await moveAnchor(api.campaignId, placement.locationId, placement.before);
    }
    api.refresh();
  };

  const release = (pinIds: string[]) =>
    run(async () => {
      const done = (await region("DELETE", "places", { pinIds })) as { released?: unknown[] } | null;
      if (done?.released?.length) setNotice({ text: t("Released from the Region. The place stays where it is, and the pin no longer moves it.") });
    });

  // An out-of-step pin: the review of its place going back under it.
  const putInStep = (pinId: string) => reviewPlaces([pinId]);

  return { bridge, step, busy, notice, setNotice, reviewBackdrop, reviewPlaces, askUnlink, apply, cancel: () => setStep(null), release, putInStep };
}

export type AtlasRegion = ReturnType<typeof useAtlasRegion>;

const sameCell = (a: Cell | null, b: Cell | null) => Boolean(a && b && a.x === b.x && a.y === b.y);

// A place's Region marker moved through the Region's own route, as a drag
// on the Region map does. A pin still bound to the place follows it.
export async function moveAnchor(campaignId: string, locationId: string, at: Cell) {
  const response = await fetch(`/api/campaigns/${campaignId}/overworld`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ anchor: { locationId, x: at.x, y: at.y } }),
  }).catch(() => null);
  return Boolean(response?.ok);
}

export function movedText(moves: Placement[], t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (moves.length === 1) {
    const [move] = moves;
    return t("{name}'s Region marker moved with it, from {before} to {after}.", { name: move.name, before: cellText(move.before, t), after: cellText(move.after, t) });
  }
  return t("{count} places' Region markers moved with their pins.", { count: moves.length });
}

// What the current map is to the Region, and the steps it offers.
export function RegionBar({ region, atlas, pins }: { region: AtlasRegion; atlas: AtlasMap; pins: Pin[] }) {
  const t = useT();
  const tp = useTp();
  const over = atlas.role === "region";
  const placeable = pins.filter(namesPlace);
  if (over) {
    return (
      <div className="flex flex-wrap items-center gap-1.5" data-testid="atlas-region-bar">
        <span className="pk-chip text-[11px] text-emerald-200" data-testid="atlas-over-region">
          <Globe2 className="size-3.5" /> {t("Over the Region")}
        </span>
        {region.bridge && !region.bridge.backdropIsMap ? (
          <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
            {t("The Region now shows another picture.")}
            {atlas.image && isUploadedImagePath(atlas.image) ? (
              // A replaced picture (map settings) or one chosen in the
              // Region's own tools: this map's can go back, reviewed.
              <KitButton tone="link" disabled={region.busy} onClick={() => void region.reviewBackdrop(atlas.id)} data-testid="atlas-region-reshow">
                {t("Show this map's picture there")}
              </KitButton>
            ) : null}
          </span>
        ) : null}
        {placeable.length ? (
          <KitButton tone="small" disabled={region.busy} onClick={() => void region.reviewPlaces(null)} data-testid="atlas-place-all">
            {t("Place every pinned place")}
          </KitButton>
        ) : null}
        <KitButton tone="link" disabled={region.busy} onClick={() => region.askUnlink(atlas)} data-testid="atlas-region-unlink">
          {t("Stop using as the Region")}
        </KitButton>
      </div>
    );
  }
  if (!atlas.image || !isUploadedImagePath(atlas.image)) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="atlas-region-bar">
      <KitButton tone="small" busy={region.busy} disabled={region.busy} onClick={() => void region.reviewBackdrop(atlas.id)} data-testid="atlas-use-as-region">
        {region.busy ? null : <Globe2 className="size-3.5" />} {t("Use as Region backdrop")}
      </KitButton>
    </div>
  );
}

export function PlacementList({ placements }: { placements: Placement[] }) {
  const t = useT();
  const tp = useTp();
  return (
    <ul className="flex flex-col gap-0.5" data-testid="atlas-region-placements">
      {placements.map((placement) => (
        <li key={placement.pinId}>
          <span className="text-stone-100">{placement.name}</span>:{" "}
          {sameCell(placement.before, placement.after) ? t("stays at {at}", { at: cellText(placement.after, t) }) : t("{before} to {after}", { before: cellText(placement.before, t), after: cellText(placement.after, t) })}
          {placement.onPicture ? null : <span className="text-amber-300"> {t("(its pin is off the picture, so the place goes to the picture's nearest edge)")}</span>}
        </li>
      ))}
    </ul>
  );
}

// The review a step answers with, and the choice to go ahead.
export function RegionReview({ region }: { region: AtlasRegion }) {
  const t = useT();
  const tp = useTp();
  const [clear, setClear] = useState(false);
  const { step } = region;
  if (!step) return null;
  const title =
    step.kind === "backdrop" ? t("Use {name} as the Region's picture?", { name: step.plan.map.name }) : step.kind === "places" ? t("Place in the Region?") : t("Stop using {name} as the Region?", { name: step.map.name });
  const nothing = step.kind === "places" && !step.plan.placements.length;
  return (
    <div className="panel motion-pop flex flex-col gap-2 rounded-lg p-3 text-xs text-stone-300" role="dialog" aria-label={title} data-testid="atlas-region-review">
      <div className="flex items-center gap-2">
        <span className="eyebrow text-[10px] text-amber-400/80">{t("Review", { context: "workshop.world.region.review" })}</span>
        <span className="text-sm text-amber-100">{title}</span>
        <KitButton tone="icon" always className="ml-auto" aria-label={t("Cancel")} onClick={region.cancel}>
          <X className="size-4" />
        </KitButton>
      </div>
      {step.kind === "backdrop" ? (
        <>
          <p>
            {t("The Region will show this map's own picture")}{step.plan.before.backdropPath ? t(", in place of the one it shows now") : ""} {t("No copy is made.")}
          </p>
          {step.plan.released.length ? (
            <p>
              {t("{count} pins on the map that stood over the Region until now will stop moving their places. The places stay where they are.", { count: step.plan.released.length })}
            </p>
          ) : null}
          {step.plan.placements.length ? <PlacementList placements={step.plan.placements} /> : null}
          {step.plan.notes.map((note) => (
            <p key={note} className="text-stone-400">{note}</p>
          ))}
        </>
      ) : step.kind === "places" ? (
        <>
          {nothing ? <p>{t("No pin on this map names a place that can go on the Region.")}</p> : <PlacementList placements={step.plan.placements} />}
          {step.plan.skipped.map((skip) => (
            <p key={skip.pinId} className="text-amber-300">{skip.reason}</p>
          ))}
          {nothing ? null : <p className="text-stone-400">{t("From then on, moving the pin moves the place on the Region, and dragging the place on the Region moves the pin.")}</p>}
        </>
      ) : (
        <>
          <p>{t("Every place stays where it is on the Region, and the pins stop moving them.")}</p>
          {step.clearable ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={clear} onChange={(event) => setClear(event.target.checked)} data-testid="atlas-region-clear" />
              {t("Also take the picture off the Region")}
            </label>
          ) : null}
        </>
      )}
      <div className="flex justify-end gap-1.5">
        <KitButton tone="small" onClick={region.cancel}>{t("Cancel")}</KitButton>
        {nothing ? null : (
          <KitButton tone="primary" busy={region.busy} disabled={region.busy} onClick={() => void region.apply({ clear })} data-testid="atlas-region-apply">
            {region.busy ? null : <Check className="size-3.5" />} {step.kind === "backdrop" ? t("Use it") : step.kind === "places" ? t("Place", { context: "workshop.world.region.place" }) : t("Stop using it")}
          </KitButton>
        )}
      </div>
    </div>
  );
}

// What a step or a move just did, with an Undo where one is possible.
export function RegionNoticeLine({ region }: { region: AtlasRegion }) {
  const t = useT();
  const tp = useTp();
  const [undoing, setUndoing] = useState(false);
  const { notice, setNotice } = region;
  if (!notice) return null;
  return (
    <div className="motion-pop flex flex-wrap items-center gap-2 rounded-lg border border-emerald-700/40 bg-emerald-900/15 px-3 py-1.5 text-xs text-stone-200" role="status" data-testid="atlas-region-notice">
      <span>{notice.text}</span>
      <span className="ml-auto flex gap-1">
        {notice.undo ? (
          <KitButton
            tone="small"
            busy={undoing}
            disabled={undoing}
            data-testid="atlas-region-undo"
            onClick={async () => {
              setUndoing(true);
              try {
                await notice.undo!();
              } finally {
                setUndoing(false);
              }
              setNotice({ text: t("Undone.") });
            }}
          >
            {undoing ? null : <Undo2 className="size-3.5" />} {t("Reset")}
          </KitButton>
        ) : null}
        <KitButton tone="icon" always aria-label={t("Dismiss")} onClick={() => setNotice(null)}>
          <X className="size-3.5" />
        </KitButton>
      </span>
    </div>
  );
}

// Bound pins on this map whose place stands somewhere else on the Region.
export function OutOfStep({ region, atlas }: { region: AtlasRegion; atlas: AtlasMap }) {
  const t = useT();
  const tp = useTp();
  const drifted = atlas.role === "region" ? (region.bridge?.pins ?? []).filter((pin) => !pin.inStep) : [];
  if (!drifted.length) return null;
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-100" data-testid="atlas-out-of-step">
      <span>{t("{count} places have moved on the Region since their pins placed them.", { count: drifted.length })}</span>
      <ul className="flex flex-col gap-1">
        {drifted.map((pin) => (
          <li key={pin.pinId} className="flex flex-wrap items-center gap-2">
            <span className="text-stone-200">
              {t("{name}: the pin points at {expected}, the place stands at {anchor}.", { name: pin.name, expected: cellText(pin.expected, t), anchor: cellText(pin.anchor, t) })}
            </span>
            <KitButton tone="small" disabled={region.busy} onClick={() => void region.putInStep(pin.pinId)}>
              {t("Put back in step")}
            </KitButton>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The pin card's part: place it, or release it.
export function PinRegionActions({ region, pin, atlas }: { region: AtlasRegion; pin: Pin; atlas: AtlasMap }) {
  const t = useT();
  const tp = useTp();
  if (!namesPlace(pin)) return null;
  if (isBound(pin, atlas)) {
    return (
      <div className="flex flex-wrap items-center gap-1.5" data-testid="pin-region">
        <span className="pk-chip text-[11px] text-emerald-200" data-testid="pin-bound">
          <Link2 className="size-3" /> {t("Moves with its place on the Region")}
        </span>
        <KitButton tone="link" disabled={region.busy} onClick={() => void region.release([pin.id])} data-testid="pin-release">
          <Unlink className="size-3.5" /> {t("Release from the Region")}
        </KitButton>
      </div>
    );
  }
  if (atlas.role !== "region") {
    return <p className="text-[11px] text-stone-500" data-testid="pin-region">{t("To put this place on the Region from here, use this map as the Region backdrop first.")}</p>;
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5")} data-testid="pin-region">
      <KitButton tone="small" disabled={region.busy} onClick={() => void region.reviewPlaces([pin.id])} data-testid="pin-place">
        <Globe2 className="size-3.5" /> {t("Place in Region")}
      </KitButton>
    </div>
  );
}
