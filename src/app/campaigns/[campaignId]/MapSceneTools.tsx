"use client";

import { useId, useRef, useState } from "react";
import { Image as ImageIcon, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { encodeImageForUpload } from "@/lib/image-encode";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { cueOptions } from "@/lib/ambience/catalog";
import { LIGHT_LIMITS, LIGHT_PRESETS, describeLight, lightPresetLabel } from "@/lib/battlemap/lights";
import type { ObjectEntry } from "@/lib/battlemap/render/painted";
import { SCENE_LIMITS, type SceneAmbience, type ZoneKind } from "@/lib/battlemap/scene";
import { TILE_FEET, type AmbientLight } from "@/lib/battlemap/types";
import { StampPicker } from "@/app/campaigns/[campaignId]/StampPicker";
import { Chip, FinePrint, RangeRow, mapButton, mapDanger, mapInput } from "@/app/campaigns/[campaignId]/mapUi";
import { useT } from "@/lib/locale";

// The dials for the scene tools (docs/workshop-parity-audit.md phase 13):
// how far the next light reaches, what the next label says, what the next
// prop is called and drawn as, which light a zone casts, the sound a map
// makes, and the DM's overlay picture. None of them touch a map; the toolbox
// holds the values and the canvas reports the tap that uses them.

export function LightDial({
  value,
  onChange,
  count,
  onClear,
}: {
  value: { brightRadius: number; dimRadius: number };
  onChange: (next: { brightRadius: number; dimRadius: number }) => void;
  count: number;
  onClear?: () => void;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1">
        {LIGHT_PRESETS.map((preset) => (
          <Chip
            key={preset.id}
            title={describeLight(t, preset)}
            active={preset.brightRadius === value.brightRadius && preset.dimRadius === value.dimRadius}
            onClick={() => onChange({ brightRadius: preset.brightRadius, dimRadius: preset.dimRadius })}
          >
            {lightPresetLabel(t, preset.id)}
          </Chip>
        ))}
      </div>
      {(["brightRadius", "dimRadius"] as const).map((side) => (
        <RangeRow
          key={side}
          label={side === "brightRadius" ? t("Bright", { context: "scene.light.bright" }) : t("Dim", { context: "scene.light.dim" })}
          min={LIGHT_LIMITS.minRadius}
          max={LIGHT_LIMITS.maxRadius}
          value={value[side]}
          readout={`${value[side] * TILE_FEET}ft`}
          onChange={(radius) => {
            const light = { ...value, [side]: radius };
            // The dim ring can never sit inside the bright one.
            if (light.dimRadius < light.brightRadius) {
              light.dimRadius = light.brightRadius;
            }
            onChange(light);
          }}
        />
      ))}
      {count && onClear ? (
        <button type="button" onClick={onClear} className={mapDanger}>
          {t("Put out all {count}", { count })}
        </button>
      ) : null}
      <FinePrint>
        {t("Tap a tile to light it; tap a lit tile to put it out. Up to {max} on a map.", { max: LIGHT_LIMITS.max })}
      </FinePrint>
    </div>
  );
}

export function LabelDial({
  value,
  onChange,
  count,
  onClear,
}: {
  value: { text: string; dmOnly: boolean };
  onChange: (next: { text: string; dmOnly: boolean }) => void;
  count: number;
  onClear?: () => void;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <input
        value={value.text}
        maxLength={SCENE_LIMITS.labelText}
        placeholder={t("1. Entry hall")}
        aria-label={t("Label text")}
        onChange={(event) => onChange({ ...value, text: event.target.value })}
        className={mapInput}
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-8 items-center gap-1.5 text-[11px] text-stone-300">
          <Switch on={value.dmOnly} onChange={(dmOnly) => onChange({ ...value, dmOnly })} label={t("Only I see it")} />
          {t("Only I see it")}
        </label>
        {count && onClear ? (
          <button type="button" onClick={onClear} className={cn(mapDanger, "ml-auto")}>
            {t("Clear all {count}", { count })}
          </button>
        ) : null}
      </div>
      <FinePrint>
        {t("Tap a tile to put the label there; tap a labelled tile to take it away. Players see the ones not marked for you, and only where they have been.")}
      </FinePrint>
    </div>
  );
}

export function PropDial({
  value,
  onChange,
  count,
  npcNames = [],
  objects,
  ownSets = [],
}: {
  value: { name: string; kind: "prop" | "npc"; stamp?: string };
  onChange: (next: { name: string; kind: "prop" | "npc"; stamp?: string }) => void;
  count: number;
  // The cast, offered as a dropdown when the token is a bystander.
  npcNames?: readonly string[];
  // The painted object set, when this host has one: the stamp picker.
  objects?: readonly ObjectEntry[];
  ownSets?: readonly string[];
}) {
  const t = useT();
  const listId = useId();
  const suggest = value.kind === "npc" && npcNames.length > 0;
  return (
    <div className="space-y-2">
      <input
        value={value.name}
        maxLength={SCENE_LIMITS.propName}
        placeholder={value.kind === "npc" ? "Innkeeper" : "Barrel"}
        aria-label={t("Prop name")}
        list={suggest ? listId : undefined}
        onChange={(event) => onChange({ ...value, name: event.target.value })}
        className={mapInput}
      />
      {suggest ? (
        <datalist id={listId}>
          {npcNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      ) : null}
      <div className="grid grid-cols-2 gap-1">
        {(["prop", "npc"] as const).map((kind) => (
          <Chip key={kind} active={value.kind === kind} onClick={() => onChange({ ...value, kind })}>
            {kind === "prop" ? t("A thing") : t("A bystander")}
          </Chip>
        ))}
      </div>
      {objects?.length ? (
        <StampPicker
          objects={objects}
          ownSets={ownSets}
          value={value.stamp}
          onPick={(object) =>
            onChange(
              object
                ? { ...value, stamp: object.id, name: (object.label ?? object.id).slice(0, SCENE_LIMITS.propName) }
                : { name: value.name, kind: value.kind },
            )
          }
        />
      ) : null}
      <FinePrint>
        {t("Furniture and bystanders go on the table with the map as the GM's own tokens; nothing in the rules can target them. {placed} Up to {max}.", { placed: count ? t("{count} placed.", { count }) : "", max: SCENE_LIMITS.props })}
      </FinePrint>
    </div>
  );
}

export function ZoneDial({
  value,
  kind = "light",
  onChange,
  onKind,
  count,
  onClear,
}: {
  value: AmbientLight;
  kind?: ZoneKind;
  onChange: (next: AmbientLight) => void;
  onKind?: (next: ZoneKind) => void;
  count: number;
  onClear?: () => void;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      {onKind ? (
        <div className="grid grid-cols-1 gap-1">
          {(
            [
              ["light", "Light"],
              ["darkness", "Darkness"],
              ["magical_darkness", "Magical darkness"],
            ] as const
          ).map(([option, key]) => (
            <Chip key={option} active={kind === option} onClick={() => onKind(option)}>
              {t(key)}
            </Chip>
          ))}
        </div>
      ) : null}
      <div className={cn("grid grid-cols-3 gap-1", kind !== "light" && "opacity-40")}>
        {(
          [
            ["bright", "Lit"],
            ["dim", "Dim"],
            ["dark", "Dark"],
          ] as const
        ).map(([ambient, key]) => (
          <Chip key={ambient} active={value === ambient} onClick={() => onChange(ambient)}>
            {t(key)}
          </Chip>
        ))}
      </div>
      {count && onClear ? (
        <button type="button" onClick={onClear} className={mapDanger}>
          {t("Clear all {count}", { count })}
        </button>
      ) : null}
      <FinePrint>
        {t("Drag a box. The light inside it overrides the map's: a lit shrine in a dark crypt, a dark alcove in a bright hall. Darkness is dark whatever the map says; magical darkness defeats darkvision too, and only truesight or Devil's Sight see into it. Later boxes win where they overlap. Up to {max}.", { max: SCENE_LIMITS.zones })}
      </FinePrint>
    </div>
  );
}

export function DoorHint() {
  const t = useT();
  return (
    <FinePrint>
      {t("Tap a door to lock it, again to make it secret, again to open it. A locked or secret door is a wall to everything that walks or looks until you open it; only you see which is which.")}
    </FinePrint>
  );
}

export function AmbienceControls({
  value,
  onChange,
}: {
  value: SceneAmbience;
  onChange: (next: SceneAmbience) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <p className="font-display text-[9px] uppercase tracking-[0.14em] text-stone-500">{t("What it sounds like")}</p>
      <Select
        value={value.bed}
        label={t("Ambient bed")}
        size="sm"
        onChange={(bed) => onChange({ ...value, bed })}
        options={[{ value: "", label: t("Leave the place sound alone") }, ...cueOptions("bed").map((option) => ({ value: option.value as string, label: option.label }))]}
        className="w-full"
      />
      <Select
        value={value.music}
        label={t("Music", { context: "scene.ambience.music" })}
        size="sm"
        onChange={(music) => onChange({ ...value, music })}
        options={[{ value: "", label: t("Leave the music alone") }, ...cueOptions("music").map((option) => ({ value: option.value as string, label: option.label }))]}
        className="w-full"
      />
      <FinePrint>{t("Played when this map goes on the table.")}</FinePrint>
    </div>
  );
}

// The DM's overlay: the annotated version of the same picture, drawn in the
// same register as the backdrop and never sent to a player.
export function OverlayControls({
  overlayPath,
  busy,
  onChange,
}: {
  overlayPath: string;
  busy?: boolean;
  onChange: (path: string) => void;
}) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

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
        setError(payload.error || t("That image would not upload.", { context: "scene.overlay.error" }));
        return;
      }
      onChange(payload.url);
    } catch {
      setError(t("That image would not upload.", { context: "scene.overlay.error" }));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 font-display text-[9px] uppercase tracking-[0.14em] text-stone-500">
        <ImageIcon className="size-3.5" /> {t("Your own overlay")}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          ref={fileRef}
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
        <button type="button" disabled={uploading || busy} onClick={() => fileRef.current?.click()} className={mapButton}>
          {uploading ? <Loader2 className="size-3 animate-spin" /> : <ImageIcon className="size-3" />}
          {overlayPath ? t("Replace it", { context: "scene.overlay.replace" }) : t("Add the annotated picture")}
        </button>
        {overlayPath ? (
          <button type="button" disabled={busy} onClick={() => onChange("")} className={mapDanger}>
            <Trash2 className="size-3" /> {t("Take it away", { context: "scene.overlay.remove" })}
          </button>
        ) : null}
      </div>
      <FinePrint>
        {t("Drawn over the map in the same register as the picture under it, for your eyes only: the version with the trap markings and the room numbers.")}
      </FinePrint>
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
    </div>
  );
}
