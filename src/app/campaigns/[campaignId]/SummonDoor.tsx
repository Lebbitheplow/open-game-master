"use client";

import { Loader2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { replayAnimation } from "@/lib/motion/replay";
import { askConcentrationSwap, isConcentrationQuestion } from "@/components/concentration-prompt";
import { spellsToLookUp } from "@/lib/battlemap/hand";
import { stepMix, summonDoorPost, summonDoorRows, summonReady, type SummonChoices, type SummonDoorRow } from "@/lib/battlemap/hand-summon";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";
import { useHandSpells, useHandSummons } from "@/app/campaigns/[campaignId]/HandSpells";
import { HandSummonPick } from "@/app/campaigns/[campaignId]/HandSummonPick";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The sheet's summoning door (issue 685, src/lib/battlemap/hand-summon.ts
// summonDoorRows). Find Familiar, Find Steed, Animate Dead, Create Undead,
// the Conjure spells of a minute and every summoning cast outside a fight
// had no card: the player typed it, and an AI GM picked the creature (or
// asked again), or the GM entered it on the console. Here the player picks
// it from the same catalogue the Hand's card reads and casts it; out of a
// fight as a ritual too when they may. In a fight a casting of a minute is
// begun with the turn's action and finished, the creature picked, once its
// rounds have run out. The card goes the way the Hand's does: the engine
// casts it at a table the AI runs, the GM resolves it as played at one a
// person runs.
export function SummonDoor({ sheet, mine, inCombat }: { sheet: CharacterSheet; mine: boolean; inCombat: boolean }) {
  const offered = hostOffers(useCapabilities(), "summonPicker");
  const catalogues = useHandSummons(mine && offered ? sheet : null, mine && offered);
  // The table's own spell facts, which the cast guard's refusals read.
  const spells = useHandSpells(mine && offered ? sheet : null);
  const rows = useMemo(() => summonDoorRows(sheet, spellsToLookUp(sheet), catalogues, inCombat, spells), [sheet, catalogues, inCombat, spells]);
  const [choices, setChoices] = useState<Record<string, SummonChoices>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const refusalRef = useRef<HTMLParagraphElement>(null);
  if (!mine || !offered || !rows.length) return null;

  const pickOf = (row: SummonDoorRow) => choices[row.spell] ?? {};
  const update = (row: SummonDoorRow, next: Partial<SummonChoices>) => setChoices((current) => ({ ...current, [row.spell]: { ...current[row.spell], ...next } }));

  async function send(row: SummonDoorRow, asRitual: boolean) {
    const { content, intent } = summonDoorPost(row, pickOf(row), asRitual);
    setBusy(`${row.spell}:${asRitual}`);
    setRefusal(null);
    setSent(null);
    try {
      const post = (concentrationAck?: unknown) =>
        fetch(`/api/campaigns/${sheet.campaignId}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, kind: "do", characterId: sheet.id, intent, ...(concentrationAck ? { concentrationAck } : {}) }),
        });
      let response = await post();
      let data = (await response.json().catch(() => ({}))) as { error?: string };
      // A casting that ends the spell held now is asked about first (issue 252).
      if (isConcentrationQuestion(response.status, data)) {
        const ack = await askConcentrationSwap(data);
        if (!ack) return;
        response = await post(ack);
        data = (await response.json().catch(() => ({}))) as { error?: string };
      }
      if (!response.ok) {
        setRefusal(data.error || "The casting was refused.");
        replayAnimation(refusalRef.current, "shake-x var(--dur-beat) var(--ease-snap) both");
        return;
      }
      setSent(row.spell);
      setChoices((current) => ({ ...current, [row.spell]: {} }));
    } catch {
      setRefusal("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="reveal mt-3 space-y-3" aria-label="Summoning">
      {rows.map((row) => {
        const pick = pickOf(row);
        const card = { name: row.spell, summon: row.pick?.summon, choice: row.pick?.choice };
        const ready = row.state === "begin" || summonReady(card, pick);
        const label = row.state === "begin" ? "Begin casting" : row.state === "finish" ? "Finish casting" : "Cast";
        return (
          <div key={row.spell} className="rounded-lg border border-stone-700/60 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-sm text-amber-100">{row.spell}</span>
              <span className="text-xs text-stone-400">
                {row.state === "casting"
                  ? `Casting: ${row.roundsLeft ?? 0} rounds left.`
                  : row.state === "begin"
                    ? "Takes a minute or more: begun with your action, the creature chosen when it is done."
                    : row.state === "finish"
                      ? "The casting is done: choose what it brings."
                      : row.slotLevel
                        ? `Level ${row.slotLevel} slot.`
                        : ""}
              </span>
            </div>
            {row.pick && row.state !== "begin" ? (
              <HandSummonPick
                card={card}
                choices={pick}
                onForm={(form) => update(row, { form })}
                onCount={(count) => update(row, { count })}
                onKind={(kind) => update(row, { kind })}
                onStep={(form, delta) => update(row, { mix: stepMix(card, pick.mix ?? {}, form, delta) })}
              />
            ) : null}
            {row.state !== "casting" ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!ready || row.blocked !== null || row.disabled !== null || busy !== null}
                  title={row.blocked ?? row.disabled ?? (ready ? undefined : "Choose the creature first.")}
                  onClick={() => void send(row, false)}
                  className={cn(ui.btnSmall, "min-h-10 sm:min-h-8")}
                >
                  {busy === `${row.spell}:false` ? <Loader2 className="size-3 animate-spin" /> : null}
                  {label}
                </button>
                {row.state === "cast" && row.ritual ? (
                  <button
                    type="button"
                    disabled={!ready || row.blocked !== null || busy !== null}
                    title={row.blocked ?? "Ten minutes longer, and no spell slot spent."}
                    onClick={() => void send(row, true)}
                    className={cn(ui.btnSmall, "min-h-10 sm:min-h-8")}
                  >
                    {busy === `${row.spell}:true` ? <Loader2 className="size-3 animate-spin" /> : null}
                    Cast as a ritual
                  </button>
                ) : null}
                {row.blocked || row.disabled ? <span className="text-[11px] text-stone-400">{row.blocked ?? row.disabled}</span> : null}
                {sent === row.spell ? (
                  <span role="status" className="animate-fade-up text-[11px] text-sky-200/90">
                    Sent.
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      {refusal ? (
        <p ref={refusalRef} role="alert" className="animate-fade-up text-[11px] text-amber-300">
          {refusal}
        </p>
      ) : null}
    </section>
  );
}
