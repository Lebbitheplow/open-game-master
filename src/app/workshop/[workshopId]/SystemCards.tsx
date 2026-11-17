"use client";

import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { workshopPlaceholder } from "@/lib/placeholders";
import { Ribbon } from "@/components/ui/Ribbon";
import {
  WORKSHOP_SYSTEMS,
  systemBlurb,
  systemCount,
  systemGlyph,
  systemLabel,
  totalPieces,
  type SystemId,
  type WorldCount,
} from "@/app/workshop/[workshopId]/systems";
import type { WorkshopSummary } from "@/app/workshop/types";
import { HUB_TASKS } from "@/app/workshop/[workshopId]/CreateChooser";
import { useT, useTp } from "@/lib/locale";
import type { MessageKey } from "@/lib/messages-logic";

// The hub: one card per system, each wearing its live count so a DM sees at
// a glance what is built and what is still empty. Tapping one opens that
// system.

// Each system has its own selected plate. WorldForge uses the workshop bench.
function systemPlate(id: SystemId): string {
  if (id === "world") {
    return workshopPlaceholder("workshop");
  }
  return workshopPlaceholder(id === "rules" ? "rulesets" : id);
}

// The hub tasks' labels, keyed by the choice id HUB_TASKS carries.
type HubTaskId = "encounter" | "map" | "npc" | "outline";

const TASK_KEYS: Record<HubTaskId, MessageKey> = {
  encounter: "Prepare a fight",
  map: "Make a map",
  npc: "Create an NPC",
  outline: "Build a world",
};

export function SystemCards({
  workshop,
  bestiary,
  homebrew,
  pregens = null,
  plugin = null,
  world = null,
  onOpen,
  onTask,
}: {
  workshop: WorkshopSummary;
  bestiary: number | null;
  homebrew: number | null;
  pregens?: number | null;
  plugin?: number | null;
  world?: WorldCount | null;
  onOpen: (system: SystemId) => void;
  // A task on the row above the tools: opens the Create chooser on it.
  onTask?: (choiceId: string) => void;
}) {
  const t = useT();
  const tp = useTp();
  const total = totalPieces(t, workshop, bestiary, homebrew, pregens, plugin, world);
  return (
    <section className="mt-5">
      {onTask ? (
        // Four common jobs, for someone who knows what they want and not
        // which tool makes it. Each opens the Create chooser on that job;
        // every tool stays below.
        <div className="mb-5" data-hub-tasks>
          <Ribbon className="mb-2">{t("Start with a task")}</Ribbon>
          <ul className="stagger-up grid grid-cols-2 gap-2 sm:grid-cols-4">
            {HUB_TASKS.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => onTask(task.id)}
                  className="motion-press flex w-full items-center gap-2 rounded-xl border border-stone-800 bg-stone-950/50 px-3 py-2 text-left text-sm text-amber-50 transition-colors hover:border-amber-500/50"
                  data-hub-task={task.id}
                >
                  <GameIcon icon={{ kind: "glyph", key: task.glyph }} size="size-7" className="shrink-0" />
                  {t(TASK_KEYS[task.id as HubTaskId])}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mb-1.5 flex items-center gap-3">
        <Ribbon className="flex-1">{t("Systems")}</Ribbon>
        <span className="shrink-0 text-xs text-stone-500">
          {tp("{count} piece of prep", "{count} pieces of prep", { count: total })}
        </span>
      </div>
      {/* The counts are what is here, not what is missing: a workshop with
          one good fight in it is finished if one fight is what the game
          needs. */}
      <p className="mb-3 text-xs leading-relaxed text-stone-500">
        {t("Use only the tools your game needs; nothing here has to be filled in before you play. WorldForge, Cast, Region, Factions and Lore are views of the same records, so a change in one shows in all of them. A workshop stays yours until you bring it into a campaign; Plugin turns it into a world pack, one file any server can install so a campaign can be played in your setting.")}
      </p>
      <ul className="stagger-up grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-tour="hub-systems">
        {WORKSHOP_SYSTEMS.map((system) => {
          const count = systemCount(t, system.id, workshop, bestiary, homebrew, pregens, plugin, world);
          // The rule card's figure says "set" or "none" in words, so its emptiness
          // is read from the data, not from the figure's letters.
          const empty = count.figure === "0" || (system.id === "rules" && workshop.contents.houseRules === 0);
          return (
            <li key={system.id}>
              <button
                type="button"
                onClick={() => onOpen(system.id)}
                className={cn(
                  ui.card,
                  ui.tileHover,
                  "ornate flex h-full w-full flex-col gap-2 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <GameIcon icon={systemGlyph(system.id)} size="size-10" />
                  {count.figure !== null ? (
                    <span
                      className={cn(
                        "font-display text-2xl leading-none tracking-wide",
                        empty ? "text-stone-600" : "text-amber-200",
                      )}
                    >
                      {count.figure}
                    </span>
                  ) : null}
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={systemPlate(system.id)}
                  alt=""
                  loading="lazy"
                  className={cn(
                    "aspect-[16/7] w-full rounded-lg border border-amber-400/20 object-cover",
                    empty && "opacity-60",
                  )}
                />
                <div className="mt-auto">
                  <p className="font-display text-[13px] font-semibold tracking-[0.12em] text-amber-50">
                    {systemLabel(t, system.id)}
                  </p>
                  <p className="text-xs text-stone-500">{systemBlurb(t, system.id)}</p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-sm text-stone-500">
        {t("Everything here is yours alone. Import any of it into a campaign when you start one.")}
      </p>
    </section>
  );
}
