"use client";

import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useState } from "react";
import { bannerButtonClass } from "@/app/campaigns/[campaignId]/SessionBanner";
import { KitButton, PanelError, panelField, panelRow } from "@/app/campaigns/[campaignId]/PanelKit";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Select, type SelectOption } from "@/components/ui/Select";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/lib/cn";
import {
  DICE_SCRIPT_LIMITS,
  describeForced,
  kindTitle,
  type DiceKind,
  type DiceRoller,
  type DiceScript,
  type ForcedFace,
} from "@/lib/dice-script-logic";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";

// The test table's dice (issue 685, src/lib/db/dice-scripts.ts): a seed, so
// a fight played the same way rolls the same dice, and faces forced on the
// rolls they are aimed at, so an author can reach the moment they want to
// see (the boss's critical hit, a hero's last death save) without replaying
// the fight until the dice agree. Opened from the test fight's banner only:
// no other table can script its dice, and the server refuses it there too.

type Combatant = { name: string; roller: "hero" | "enemy" };

type View = {
  script: DiceScript;
  summary: string;
  used: Array<{ line: string; at: string }>;
  seededRolls: number;
  combatants: Combatant[];
};

type Row = { key: string; roller: DiceRoller; kind: DiceKind; face: number; who: string };

const ROLLERS: SelectOption<DiceRoller>[] = [
  { value: "any", label: "Anyone" },
  { value: "enemy", label: "An enemy" },
  { value: "hero", label: "A hero" },
];

const KINDS: SelectOption<DiceKind>[] = (["attack", "damage", "save", "death_save", "initiative", "check", "any"] as const).map((kind) => ({
  value: kind,
  label: kindTitle(kind),
  ...(kind === "damage" ? { hint: "One damage die" } : {}),
}));

// "Anyone" in the creature picker: a menu row needs a value of its own, and
// no creature on a table is called this.
const ANYONE = "\u0000anyone";

let keys = 0;
const nextKey = () => `face-${++keys}`;

function rowOf(face: ForcedFace): Row {
  return { key: nextKey(), roller: face.roller, kind: face.kind, face: face.face, who: face.who ?? ANYONE };
}

function faceOf(row: Row): ForcedFace {
  return row.who !== ANYONE ? { roller: row.roller, kind: row.kind, face: row.face, who: row.who } : { roller: row.roller, kind: row.kind, face: row.face };
}

const maxFace = (kind: DiceKind) => (kind === "damage" ? DICE_SCRIPT_LIMITS.face.max : 20);

export function TestDiceScript({ campaignId }: { campaignId: string }) {
  const capabilities = useCapabilities();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [seed, setSeed] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // What the last save said: Save the dice changed nothing on screen, so a
  // press looked like it had done nothing. The word goes as soon as the dice
  // on screen are changed again, since then they are no longer what it said.
  const [said, setSaid] = useState("");

  if (!hostOffers(capabilities, "diceScripts")) {
    return null;
  }

  function show(next: View) {
    setView(next);
    setSeed(next.script.seed === null ? "" : String(next.script.seed));
    setRows(next.script.queue.map(rowOf));
  }

  async function send(method: "GET" | "PUT" | "DELETE", body?: DiceScript) {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/campaigns/${campaignId}/dice-script`, {
      method,
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    }).catch(() => null);
    const payload = (await response?.json().catch(() => null)) as (View & { error?: string }) | null;
    setBusy(false);
    if (!response?.ok || !payload) {
      setError(payload?.error ?? (response ? "The dice could not be read." : "Could not reach the server."));
      return;
    }
    show(payload);
    setSaid(
      method === "PUT"
        ? "Saved. This table's next rolls use these dice."
        : method === "DELETE"
          ? "Back to ordinary dice: no seed and nothing forced."
          : "",
    );
  }

  function openSheet(next: boolean) {
    setOpen(next);
    if (next) {
      void send("GET");
    }
  }

  const seedText = seed.trim();
  const seedValue = seedText === "" ? null : Number(seedText);
  const seedBad = seedValue !== null && (!Number.isInteger(seedValue) || seedValue < DICE_SCRIPT_LIMITS.seed.min || seedValue > DICE_SCRIPT_LIMITS.seed.max);

  function save() {
    if (seedBad) {
      setError(`The seed is a whole number from 0 to ${DICE_SCRIPT_LIMITS.seed.max}, or empty for random dice.`);
      return;
    }
    void send("PUT", { seed: seedValue, queue: rows.map(faceOf) });
  }

  function patch(key: string, change: Partial<Row>) {
    setSaid("");
    setRows((now) =>
      now.map((row) => {
        if (row.key !== key) {
          return row;
        }
        const next = { ...row, ...change };
        return { ...next, face: Math.min(next.face, maxFace(next.kind)) };
      }),
    );
  }

  function move(index: number, by: -1 | 1) {
    setSaid("");
    setRows((now) => {
      const to = index + by;
      if (to < 0 || to >= now.length) {
        return now;
      }
      const next = [...now];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  const combatants = view?.combatants ?? [];
  const whoOptions = (roller: DiceRoller): SelectOption<string>[] => [
    { value: ANYONE, label: roller === "enemy" ? "Any enemy" : roller === "hero" ? "Any hero" : "Anyone" },
    ...combatants
      .filter((entry) => roller === "any" || entry.roller === roller)
      .map((entry) => ({ value: entry.name, label: entry.name, hint: entry.roller === "hero" ? "Hero" : "Enemy" })),
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => openSheet(true)}
        className={bannerButtonClass()}
        aria-haspopup="dialog"
      >
        Set the dice
      </button>
      <Sheet open={open} onOpenChange={openSheet} title="This test's dice" className="lg:w-[min(92vw,38rem)]">
        <div className="space-y-4 text-xs text-stone-300">
          <p className="text-stone-400">
            Only this test table rolls these dice. Every other table rolls honestly. Dice you roll yourself are never changed.
          </p>

          <label className="block">
            <span className="block text-[11px] font-medium text-stone-300">Seed</span>
            <input
              type="text"
              inputMode="numeric"
              value={seed}
              onChange={(event) => {
                setSeed(event.target.value.replace(/[^0-9]/g, ""));
                setSaid("");
              }}
              placeholder="Empty: random dice"
              aria-describedby="dice-seed-hint"
              aria-invalid={seedBad || undefined}
              className={cn(panelField, "mt-1 min-h-10 w-full")}
            />
            <span id="dice-seed-hint" className="mt-1 block text-[11px] text-stone-500">
              The same seed rolls the same dice when the fight is played the same way. A new seed starts over.
              {view?.seededRolls ? ` ${view.seededRolls} ${view.seededRolls === 1 ? "die" : "dice"} rolled from it so far.` : ""}
            </span>
          </label>

          <section aria-labelledby="dice-forced-head" className="space-y-2">
            <h3 id="dice-forced-head" className="text-[11px] font-medium text-stone-300">Forced rolls</h3>
            <p className="text-[11px] text-stone-500">
              Each one is used by the first roll it fits, then it is gone. A forced d20 is the die the roll keeps, with advantage or without.
            </p>
            {rows.length ? (
              <ol className="space-y-2">
                {rows.map((row, index) => (
                  <li key={row.key} className={panelRow} role="group" aria-label={`Forced roll ${index + 1}: ${describeForced(faceOf(row))}`}>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <label className="block">
                        <span className="block text-[11px] text-stone-400">Who rolls</span>
                        <Select
                          label="Who rolls"
                          value={row.roller}
                          options={ROLLERS}
                          onChange={(roller) => patch(row.key, { roller, who: combatants.some((entry) => entry.name === row.who && (roller === "any" || entry.roller === roller)) ? row.who : ANYONE })}
                          className="mt-1 min-h-10 w-full"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-[11px] text-stone-400">Which</span>
                        <Select
                          label="Which creature"
                          value={row.who}
                          options={whoOptions(row.roller)}
                          onChange={(who) => {
                            const side = combatants.find((entry) => entry.name === who)?.roller;
                            patch(row.key, { who, ...(side ? { roller: side } : {}) });
                          }}
                          className="mt-1 min-h-10 w-full"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-[11px] text-stone-400">Roll</span>
                        <Select label="Roll" value={row.kind} options={KINDS} onChange={(kind) => patch(row.key, { kind })} className="mt-1 min-h-10 w-full" />
                      </label>
                      <div>
                        <span className="block text-[11px] text-stone-400" aria-hidden="true">Face</span>
                        <NumberStepper
                          label={row.kind === "damage" ? "Face on the damage die" : "Face on the d20"}
                          value={row.face}
                          min={1}
                          max={maxFace(row.kind)}
                          onChange={(face) => patch(row.key, { face })}
                          className="mt-1"
                        />
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-end gap-1">
                      <KitButton tone="icon" always aria-label={`Move forced roll ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                        <ArrowUp className="size-4" aria-hidden="true" />
                      </KitButton>
                      <KitButton tone="icon" always aria-label={`Move forced roll ${index + 1} down`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}>
                        <ArrowDown className="size-4" aria-hidden="true" />
                      </KitButton>
                      <KitButton
                        tone="iconDanger"
                        always
                        aria-label={`Remove forced roll ${index + 1}`}
                        onClick={() => {
                          setSaid("");
                          setRows((now) => now.filter((entry) => entry.key !== row.key));
                        }}
                      >
                        <X className="size-4" aria-hidden="true" />
                      </KitButton>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[11px] text-stone-500">None: every roll falls as it falls.</p>
            )}
            <KitButton
              disabled={rows.length >= DICE_SCRIPT_LIMITS.queue}
              onClick={() => {
                setSaid("");
                setRows((now) => [...now, { key: nextKey(), roller: "enemy", kind: "attack", face: 20, who: ANYONE }]);
              }}
            >
              Add a forced roll
            </KitButton>
          </section>

          {error ? <PanelError>{error}</PanelError> : null}

          <div className="flex flex-wrap items-center gap-2">
            <KitButton tone="primary" busy={busy} disabled={busy} onClick={save}>
              Save the dice
            </KitButton>
            <KitButton tone="danger" disabled={busy} onClick={() => void send("DELETE")}>
              Back to ordinary dice
            </KitButton>
            {said ? (
              <span role="status" className="motion-pop text-[11px] text-stone-300" data-dice-saved>
                {said}
              </span>
            ) : null}
          </div>

          <section aria-labelledby="dice-used-head" className="space-y-1">
            <h3 id="dice-used-head" className="text-[11px] font-medium text-stone-300">Used so far</h3>
            {view?.used.length ? (
              <ul className="space-y-0.5 text-[11px] text-stone-400">
                {[...view.used].reverse().map((entry, index) => (
                  <li key={`${entry.at}-${index}`}>{entry.line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-stone-500">Nothing forced has been rolled yet.</p>
            )}
          </section>
        </div>
      </Sheet>
    </>
  );
}
