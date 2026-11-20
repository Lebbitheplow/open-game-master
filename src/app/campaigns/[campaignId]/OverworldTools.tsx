"use client";

import {
  Brush,
  Download,
  Eraser,
  FileUp,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Move,
  PenLine,
  RefreshCw,
  Trash2,
  Type,
  Users,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { encodeImageForUpload } from "@/lib/image-encode";
import { SectionHead } from "@/components/ui/SectionHead";
import { Select } from "@/components/ui/Select";
import { Slider } from "@/components/ui/Slider";
import { PanelError, kitButtonClass, panelField } from "./PanelKit";
import type { OverworldTile, TileSkin } from "@/lib/overworld/logic";
import { DEFAULT_SKIN } from "@/lib/overworld/logic";
import {
  brushLabelKey,
  MAX_BRUSH_RADIUS,
  OVERWORLD_BRUSHES,
  OVERWORLD_BRUSH_TILES,
  type OverworldBrush,
} from "@/lib/overworld/paint";
import {
  FEATURE_LIMITS,
  OVERWORLD_SIZES,
  PATH_KINDS,
  sizeLabelKey,
  type LabelSize,
  type OverworldSize,
  type PathKind,
} from "@/lib/overworld/features";
import { useT, useTp } from "@/lib/locale";

// The region map's toolbars (docs/workshop-parity-audit.md phase 15). Each
// is a small stateless strip; OverworldPanel holds the state and decides
// what a tap on the canvas means under the mode chosen here.

// What the panel's own dialog asks for, by what a tap meant.
export type OverworldAsk =
  | { kind: "pin"; at: { x: number; y: number } }
  | { kind: "rename"; locationId: string }
  | { kind: "label"; at: { x: number; y: number } };

export function askCopy(
  t: (key: string, vars?: Record<string, string | number>) => string,
  ask: OverworldAsk | null,
  labelSize: LabelSize,
  heldName: string,
): { title: string; label: string; defaultValue: string; maxLength: number; allowEmpty: boolean; submitLabel: string } {
  if (ask?.kind === "rename") {
    return {
      title: t("Rename this place"),
      label: t("What is this place called?"),
      defaultValue: heldName,
      maxLength: 80,
      allowEmpty: false,
      submitLabel: t("Rename"),
    };
  }
  if (ask?.kind === "label") {
    return {
      title: labelSize === "large" ? t("Name the region") : t("Name the place"),
      label: t("The words written on the map here."),
      defaultValue: "",
      maxLength: FEATURE_LIMITS.labelLength,
      allowEmpty: false,
      submitLabel: t("Write it"),
    };
  }
  return {
    title: t("Label the pin"),
    label: t("Leave it empty for a plain marker."),
    defaultValue: "",
    maxLength: 60,
    allowEmpty: true,
    submitLabel: t("Place the pin"),
  };
}

type ImportSummary = { cells: number; places: number; rivers: number; routes: number };

// Sends the GeoJSON texts to the import route and says what it read.
export async function importAzgaarFiles<Data extends { map: { width: number; height: number } }>(
  t: (key: string, vars?: Record<string, string | number>) => string,
  campaignId: string,
  files: string[],
  size: OverworldSize,
): Promise<{ data: Data; note: string } | { error: string }> {
  const response = await fetch(`/api/campaigns/${campaignId}/overworld/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files, ...size }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { error: (payload as { error?: string }).error ?? t("That map could not be read.") };
  }
  const { summary, ...data } = payload as Data & { summary: ImportSummary };
  return {
    data: data as unknown as Data,
    note: t("Read {cells} cells into a {width} by {height} map, with {places} places, {routes} roads and {rivers} rivers.", {
      cells: summary.cells,
      width: data.map.width,
      height: data.map.height,
      places: summary.places,
      routes: summary.routes,
      rivers: summary.rivers,
    }),
  };
}

export type OverworldMode =
  | "look"
  | "pin"
  | "party"
  | "place"
  | "paint"
  | "line"
  | "label"
  | "erase";

// Every button here is the kit's small button (ui.btnSmall through PanelKit);
// a chosen mode or brush wears the gold on-state over it.
const chip = kitButtonClass("small");
const idle = "";
const active = "border-amber-500/60 bg-amber-400/10 text-amber-100";

export function ModeBar({
  mode,
  onMode,
  partyTool = true,
  partyPlaced,
  onPartyTransit,
  pinsCount,
  onClearPins,
  regenBusy,
  onRegenerate,
}: {
  mode: OverworldMode;
  onMode: (mode: OverworldMode) => void;
  // Off in a workshop, which has no party to place (issue 553).
  partyTool?: boolean;
  partyPlaced: boolean;
  onPartyTransit: () => void;
  pinsCount: number;
  onClearPins: () => void;
  regenBusy: boolean;
  onRegenerate: () => void;
}) {
  const t = useT();
  const MODES = [
    ["pin", t("Add pin"), MapPin],
    ["party", t("Place the party"), Users],
    ["place", t("Move a place"), Move],
    ["paint", t("Paint terrain"), Brush],
    ["line", t("Draw a line"), PenLine],
    ["label", t("Write a label"), Type],
    ["erase", t("Erase"), Eraser],
  ] as const;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-tour="region-modes">
      {MODES.filter(([value]) => partyTool || value !== "party").map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => onMode(mode === value ? "look" : value)}
          className={cn(chip, mode === value ? active : idle)}
        >
          <Icon className="size-3.5" /> {mode === value ? t("Tap the map...") : label}
        </button>
      ))}
      {partyPlaced ? (
        <button type="button" onClick={onPartyTransit} className={cn(chip, idle)}>
          {t("Party is in transit")}
        </button>
      ) : null}
      {pinsCount ? (
        <button type="button" onClick={onClearPins} className={cn(chip, idle)}>
          <X className="size-3.5" /> {t("Clear pins")}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onRegenerate}
        disabled={regenBusy}
        title={t("Reroll the terrain. Locations keep their spots where the new ground allows.")}
        className={cn(chip, idle, "disabled:opacity-50")}
      >
        {regenBusy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        {t("Regenerate")}
      </button>
    </div>
  );
}

export function TileLegend({ skin }: { skin: Record<OverworldTile, TileSkin> }) {
  const t = useT();
  return (
    <div className="stagger-pop flex flex-wrap gap-x-3 gap-y-1">
      {(Object.keys(skin) as OverworldTile[]).map((tile) => (
        <span key={tile} className="flex items-center gap-1 text-[11px] text-stone-400">
          <span className="inline-block size-3 rounded-sm border border-black/30" style={{ backgroundColor: skin[tile].fill }} />
          {/* A genre's own skin names its tiles (Black water, Moors); the
              default skin's words are the interface's to translate. */}
          {skin[tile] === DEFAULT_SKIN[tile] ? ({ "w": t("Water"), "p": t("Plains"), "f": t("Forest"), "h": t("Hills"), "m": t("Mountains"), "s": t("Swamp") } as Record<string, string>)[tile] ?? String(tile) : skin[tile].label}
        </span>
      ))}
    </div>
  );
}

export function PaintTools({
  skin,
  brush,
  onBrush,
  radius,
  onRadius,
  stranded,
  undo,
}: {
  skin: Record<OverworldTile, TileSkin>;
  brush: OverworldBrush;
  onBrush: (brush: OverworldBrush) => void;
  radius: number;
  onRadius: (radius: number) => void;
  stranded: Array<{ id: string; name: string }>;
  undo?: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void };
}) {
  const t = useT();
  const tp = useTp();
  return (
    <div className="panel reveal space-y-2 rounded-lg p-2.5">
      <SectionHead title={t("Paint terrain")} glyph="climate-temperate" level="h4" />
      <div data-pill-group="" role="group" aria-label={t("Brush")} className="flex flex-wrap items-center gap-1">
        {OVERWORLD_BRUSHES.map((value) => (
          <button data-on={brush === value ? "" : undefined}
            key={value}
            type="button"
            aria-pressed={brush === value}
            onClick={() => onBrush(value)}
            className={cn(chip, brush === value ? active : idle)}
          >
            <span
              className="size-2.5 rounded-sm"
              style={{ backgroundColor: skin[OVERWORLD_BRUSH_TILES[value]].fill }}
            />
            {t(brushLabelKey(value))}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-400">
        {t("Brush size")}
        <Slider min={0} max={MAX_BRUSH_RADIUS} value={radius} onChange={onRadius} label={t("Brush size")} className="pk-w-28" />
        <span className="text-stone-500">{radius === 0 ? t("one tile") : t("{across} across", { across: radius * 2 + 1 })}</span>
        {undo ? (
          <span className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={undo.onUndo}
              disabled={!undo.canUndo}
              title={t("Undo (Ctrl+Z)")}
              className={cn(chip, undo.canUndo ? idle : "border-stone-800 text-stone-700")}
            >
              {t("Undo")}
            </button>
            <button
              type="button"
              onClick={undo.onRedo}
              disabled={!undo.canRedo}
              title={t("Redo (Ctrl+Shift+Z)")}
              className={cn(chip, undo.canRedo ? idle : "border-stone-800 text-stone-700")}
            >
              {t("Redo")}
            </button>
          </span>
        ) : null}
      </div>
      <p className="text-xs text-stone-500">{t("Press and drag to paint; the tiles land when you let go.")}</p>
      {stranded.length ? (
        <p role="status" className="live-in text-xs text-amber-300/90">
          {tp("{names} is now standing in sea or on a peak. The marker stays where you put it; move it with Move a place if that was not the idea.", "{names} are now standing in sea or on a peak. The marker stays where you put it; move it with Move a place if that was not the idea.", { count: stranded.length, names: stranded.map((place) => place.name).filter(Boolean).join(", ") })}
        </p>
      ) : null}
    </div>
  );
}

// A road, river or border is drawn one tap at a time and finished on
// purpose, so a mis-tap is an undo rather than a stray line on the map.
export function LineTools({
  kind,
  onKind,
  pendingCount,
  label,
  onLabel,
  onFinish,
  onUndo,
  onCancel,
}: {
  kind: PathKind;
  onKind: (kind: PathKind) => void;
  pendingCount: number;
  label: string;
  onLabel: (label: string) => void;
  onFinish: () => void;
  onUndo: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const tp = useTp();
  return (
    <div className="panel reveal space-y-2 rounded-lg p-2.5">
      <SectionHead title={t("Draw a line")} glyph="pace-normal" level="h4" />
      <div data-pill-group="" role="group" aria-label={t("Kind of line")} className="flex flex-wrap items-center gap-1">
        {PATH_KINDS.map((value) => (
          <button data-on={kind === value ? "" : undefined}
            key={value}
            type="button"
            aria-pressed={kind === value}
            disabled={pendingCount > 0 && value !== kind}
            onClick={() => onKind(value)}
            className={cn(chip, kind === value ? active : idle, "disabled:opacity-40")}
          >
            {({ "road": t("Road"), "river": t("River"), "border": t("Border") } as Record<string, string>)[value] ?? String(value)}
          </button>
        ))}
        <input
          value={label}
          maxLength={FEATURE_LIMITS.labelLength}
          onChange={(event) => onLabel(event.target.value)}
          placeholder={t("Name the {kind} (optional)", { kind: ({ "road": t("Road"), "river": t("River"), "border": t("Border") } as Record<string, string>)[kind] ?? String(kind) })}
          aria-label={t("Name the {kind} (optional)", { kind: ({ "road": t("Road"), "river": t("River"), "border": t("Border") } as Record<string, string>)[kind] ?? String(kind) })}
          className={cn(panelField, "w-auto min-w-32 flex-1")}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
        <span>
          {pendingCount === 0
            ? t("Tap where it starts, then along its course.")
            : tp("{n} point so far.", "{n} points so far.", { count: pendingCount, n: pendingCount })}
        </span>
        <button
          type="button"
          disabled={pendingCount < 2}
          onClick={onFinish}
          className={kitButtonClass("primary", "disabled:opacity-40")}
        >
          {t("Finish the {kind}", { kind: ({ "road": t("Road"), "river": t("River"), "border": t("Border") } as Record<string, string>)[kind] ?? String(kind) })}
        </button>
        <button type="button" disabled={pendingCount === 0} onClick={onUndo} className={cn(chip, idle, "disabled:opacity-40")}>
          {t("Undo a point")}
        </button>
        <button type="button" disabled={pendingCount === 0} onClick={onCancel} className={cn(chip, idle, "disabled:opacity-40")}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}

export function LabelTools({ size, onSize }: { size: LabelSize; onSize: (size: LabelSize) => void }) {
  const t = useT();
  return (
    <div data-pill-group="" className="panel reveal flex flex-wrap items-center gap-1.5 rounded-lg p-2.5 text-xs text-stone-500">
      <span>{t("Tap where the words go.")}</span>
      <button data-on={size === "small" ? "" : undefined} type="button" aria-pressed={size === "small"} onClick={() => onSize("small")} className={cn(chip, size === "small" ? active : idle)}>
        {t("Place name")}
      </button>
      <button data-on={size === "large" ? "" : undefined} type="button" aria-pressed={size === "large"} onClick={() => onSize("large")} className={cn(chip, size === "large" ? active : idle)}>
        {t("Region name")}
      </button>
    </div>
  );
}

// The map as a file, either way: a picture in place of the tiles, a map
// drawn in Fantasy Map Generator read into the grid, or the map saved out as
// a PNG to print or hand round.
export function FileTools({
  backdropPath,
  onBackdrop,
  onExport,
  exporting,
  onImport,
  importing,
  importNote,
  mapSize,
}: {
  backdropPath: string;
  onBackdrop: (path: string) => void;
  onExport: () => void;
  exporting: boolean;
  onImport: (files: string[], size: OverworldSize) => void;
  importing: boolean;
  importNote: string;
  mapSize: OverworldSize;
}) {
  const t = useT();
  const imageRef = useRef<HTMLInputElement>(null);
  const geoRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [sizeId, setSizeId] = useState("current");

  async function upload(file: File) {
    setUploading(true);
    setError("");
    try {
      const { dataUrl, type } = await encodeImageForUpload(file);
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, name: file.name, type }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || t("That image would not upload.", { context: "table.map.error.upload" }));
        return;
      }
      onBackdrop(payload.url);
    } catch {
      setError(t("That image would not upload.", { context: "table.map.error.upload" }));
    } finally {
      setUploading(false);
    }
  }

  async function pickGeo(files: FileList | null) {
    if (!files?.length) {
      return;
    }
    setError("");
    const texts = await Promise.all([...files].map((file) => file.text()));
    const preset = OVERWORLD_SIZES.find((entry) => entry.id === sizeId);
    onImport(texts, preset ? { width: preset.width, height: preset.height } : mapSize);
  }

  return (
    <div className="panel space-y-2 rounded-lg p-2.5">
      <SectionHead title={t("The map as a file")} glyph="tab-handout" level="h4" />
      <input
        ref={imageRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void upload(file);
          }
          event.target.value = "";
        }}
      />
      <input
        ref={geoRef}
        type="file"
        multiple
        accept=".geojson,.json,application/geo+json,application/json"
        className="hidden"
        onChange={(event) => {
          void pickGeo(event.target.files);
          event.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-1.5" data-tour="region-files">
        <button
          type="button"
          disabled={uploading}
          onClick={() => imageRef.current?.click()}
          className={cn(chip, idle, "disabled:opacity-50")}
        >
          {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImageIcon className="size-3.5" />}
          {backdropPath ? t("Replace the picture", { context: "overworld.file.replace" }) : t("Use a picture instead of tiles")}
        </button>
        {backdropPath ? (
          <button type="button" onClick={() => onBackdrop("")} className={cn(chip, idle)}>
            <Trash2 className="size-3.5" /> {t("Back to the tiles")}
          </button>
        ) : null}
        <button
          type="button"
          disabled={exporting}
          onClick={onExport}
          className={cn(chip, idle, "disabled:opacity-50")}
        >
          {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          {t("Save as PNG")}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={importing}
          onClick={() => geoRef.current?.click()}
          className={cn(chip, idle, "disabled:opacity-50")}
        >
          {importing ? <Loader2 className="size-3.5 animate-spin" /> : <FileUp className="size-3.5" />}
          {t("Read an Azgaar map")}
        </button>
        <Select
          size="sm"
          value={sizeId}
          onChange={setSizeId}
          label={t("Grid size for the imported map")}
          options={[
            { value: "current", label: t("At this size ({width} by {height})", { width: mapSize.width, height: mapSize.height }) },
            ...OVERWORLD_SIZES.map((entry) => ({
              value: entry.id as string,
              label: t("{label} ({width} by {height})", { label: t(sizeLabelKey(entry.id)), width: entry.width, height: entry.height }),
            })),
          ]}
          className="min-w-0 max-w-full"
        />
        <span className="text-[11px] leading-4 text-stone-500">
          {t("Fantasy Map Generator: export Cells as GeoJSON, plus Burgs, Rivers and Routes if you like.")}
        </span>
      </div>
      {importNote ? <p role="status" className="live-in text-xs text-emerald-300/90">{importNote}</p> : null}
      {error ? <PanelError>{error}</PanelError> : null}
    </div>
  );
}
