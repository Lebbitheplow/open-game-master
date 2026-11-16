"use client";

import { Hammer, Loader2, Puzzle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AddonByline, addonByText } from "@/components/addons/AddonByline";
import { AddonFields, fieldDefaults, type FieldValues } from "@/components/addons/AddonFields";
import { SectionHead } from "@/components/ui/SectionHead";
import { Select } from "@/components/ui/Select";
import { ADDON_MAP_LIMITS } from "@/lib/addons/contracts";
import { cancelTask, followTask } from "@/lib/addons/follow-task";
import type { TaskView } from "@/lib/addons/tasks";
import { useAddons } from "@/lib/addons/use-addons";
import { MAP_THEMES } from "@/lib/battlemap/generate";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

// A map built by an addon, into this campaign's or workshop's library: the
// 3D map maker, a procedural generator, anything an admin switched on. The
// addon builds the ground (and, if it can, a picture and a model for its
// board view); the server checks the ground against the rules' alphabet and
// adds it as a prepared map, which the DM then edits, deploys or imports
// like any other.

const THEME_LABEL: Record<string, string> = {
  cave: "Cave",
  forest: "Forest",
  swamp: "Swamp",
  riverside: "Riverside",
  interior: "Indoors",
  field: "Open field",
};

export function AddonMapGenerator({
  campaignId,
  onCreated,
}: {
  campaignId: string;
  onCreated: (mapId: string, name: string) => void;
}) {
  const { mapGenerators } = useAddons();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState("");
  const [options, setOptions] = useState<FieldValues>({});
  const [name, setName] = useState("");
  const [width, setWidth] = useState(24);
  const [height, setHeight] = useState(18);
  const [theme, setTheme] = useState<string>("cave");
  const [ambient, setAmbient] = useState<"bright" | "dim" | "dark">("dim");
  const [summary, setSummary] = useState("");
  const [task, setTask] = useState<TaskView | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  if (!mapGenerators.length) return null;
  const key = (entry: { addonId: string; id: string }) => `${entry.addonId}:${entry.id}`;
  const generator = mapGenerators.find((entry) => key(entry) === chosen) ?? mapGenerators[0];
  const running = task?.status === "running";
  const clampSide = (value: number) => Math.min(ADDON_MAP_LIMITS.maxSide, Math.max(ADDON_MAP_LIMITS.minSide, Math.round(value) || 0));

  async function build() {
    if (!name.trim()) {
      setError("Name it first.");
      return;
    }
    setError("");
    setNotes([]);
    const response = await fetch("/api/addons/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "map",
        campaignId,
        addonId: generator.addonId,
        generatorId: generator.id,
        request: { name: name.trim(), width: clampSide(width), height: clampSide(height), theme, ambient, summary: summary.trim() },
        options: { ...fieldDefaults(generator.options), ...options },
      }),
    }).catch(() => null);
    const data = response ? await response.json().catch(() => ({})) : {};
    if (!response?.ok) {
      setError(data.error ?? "The addon could not start.");
      return;
    }
    const finished = await followTask(data.task as TaskView, setTask, () => live.current);
    if (!finished) {
      if (live.current) setError("Lost track of the run. Try again.");
      setTask(null);
      return;
    }
    setTask(finished);
    if (finished.status !== "done") {
      setError(finished.error || "The addon did not finish.");
      return;
    }
    setNotes(finished.notes);
    setName("");
    const result = finished.result as { preparedMapId?: string; name?: string } | null;
    if (result?.preparedMapId) onCreated(result.preparedMapId, result.name ?? name);
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(ui.btnSmall, "text-xs")}
      >
        <Puzzle className="size-3.5" />
        Build a map with an addon
      </button>
      {open ? (
        <div className={cn(ui.card, "reveal mt-2 p-4")}>
          <SectionHead
            title="Build a map with an addon"
            glyph="system-maps"
            aside={
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className={ui.iconAction}>
                <X className="size-4" />
              </button>
            }
          />
          {mapGenerators.length > 1 ? (
            <Select
              label="Generator"
              value={key(generator)}
              onChange={(next) => {
                setChosen(next);
                setOptions({});
              }}
              disabled={running}
              options={mapGenerators.map((entry) => ({ value: key(entry), label: entry.title, hint: addonByText(entry) }))}
            />
          ) : (
            <p className="text-sm text-amber-100">
              {generator.title} <AddonByline owner={generator} />
            </p>
          )}
          {generator.description ? <p className="mt-1 text-xs text-stone-400">{generator.description}</p> : null}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 sm:col-span-2">
              <span className="block text-xs text-stone-300">Name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className={cn(ui.input, "text-xs")} />
            </label>
            <label className="block space-y-1">
              <span className="block text-xs text-stone-300">Squares across</span>
              <input type="number" value={width} min={ADDON_MAP_LIMITS.minSide} max={ADDON_MAP_LIMITS.maxSide} onChange={(event) => setWidth(Number(event.target.value))} className={cn(ui.input, "text-xs")} />
            </label>
            <label className="block space-y-1">
              <span className="block text-xs text-stone-300">Squares down</span>
              <input type="number" value={height} min={ADDON_MAP_LIMITS.minSide} max={ADDON_MAP_LIMITS.maxSide} onChange={(event) => setHeight(Number(event.target.value))} className={cn(ui.input, "text-xs")} />
            </label>
            <div className="space-y-1">
              <span className="block text-xs text-stone-300">Kind of place</span>
              <Select label="Kind of place" size="sm" value={theme} onChange={setTheme} options={MAP_THEMES.map((value) => ({ value, label: THEME_LABEL[value] ?? value }))} />
            </div>
            <div className="space-y-1">
              <span className="block text-xs text-stone-300">Light</span>
              <Select
                label="Light"
                size="sm"
                value={ambient}
                onChange={setAmbient}
                options={[
                  { value: "bright", label: "Bright" },
                  { value: "dim", label: "Dim" },
                  { value: "dark", label: "Dark" },
                ]}
              />
            </div>
            <label className="block space-y-1 sm:col-span-2">
              <span className="block text-xs text-stone-300">What should it be like?</span>
              <textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={600} rows={2} placeholder="A flooded crypt with two ways in" className={cn(ui.input, "text-xs")} />
            </label>
          </div>

          {generator.options.length ? (
            <div className="mt-3">
              <AddonFields
                idPrefix={`map-${generator.addonId}-${generator.id}`}
                fields={generator.options}
                values={{ ...fieldDefaults(generator.options), ...options }}
                onChange={(field, value) => setOptions((current) => ({ ...current, [field]: value }))}
              />
            </div>
          ) : null}

          {error ? <p role="alert" className="motion-shake mt-3 text-xs text-red-300">{error}</p> : null}
          {notes.length ? (
            <ul className="live-in mt-3 space-y-1">
              {notes.map((note) => (
                <li key={note} className="text-xs text-amber-200/80">{note}</li>
              ))}
            </ul>
          ) : null}

          {running && task ? (
            <div className="live-in mt-3 space-y-2" role="status">
              <div className="h-2 overflow-hidden rounded-full bg-stone-800">
                <div
                  className={cn("h-full rounded-full bg-amber-400/80 transition-[width] duration-500", task.progress.fraction === null && "animate-pulse")}
                  style={{ width: `${Math.round((task.progress.fraction ?? 0.15) * 100)}%` }}
                />
              </div>
              <p className="flex items-center gap-2 text-xs text-stone-300">
                <Loader2 className="size-3.5 animate-spin" />
                {task.progress.message || "Building"}
              </p>
              <button type="button" onClick={() => void cancelTask(task.id)} className={cn(ui.btnSmall, "text-xs")}>
                Stop it
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => void build()} className={cn(ui.btnPrimary, "mt-3")}>
              <Hammer className="size-4" />
              Build it
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
