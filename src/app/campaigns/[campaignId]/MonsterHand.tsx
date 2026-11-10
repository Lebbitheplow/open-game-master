"use client";

import { ArrowLeft, ChevronDown, Loader2 } from "lucide-react";
import { memo, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { HandCardFace, HandPreviewRows, typeLabel, typeTone } from "@/app/campaigns/[campaignId]/HandCardFace";
import type { HandCard } from "@/lib/battlemap/hand";
import { previewRows } from "@/lib/battlemap/hand-play";
import {
  deriveMonsterHand,
  monsterAimsAtRows,
  monsterCalls,
  monsterSentence,
  rollsMonsterAttack,
  takesManyTargets,
  type MonsterAdvantage,
} from "@/lib/battlemap/monster-hand";
import { describeAdjudicationResult, type ResultLine } from "@/lib/dm/catalog-result";
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import { replayAnimation } from "@/lib/motion/replay";
import { effectiveAcFor } from "@/lib/srd";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { offSide, SideBadge } from "@/app/campaigns/[campaignId]/SideBadge";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";
import {
  MonsterAimControls,
  MonsterResultLines,
  readCollapsed,
  subscribeStore,
  writeCollapsed,
  type PartyChip,
} from "@/app/campaigns/[campaignId]/MonsterHandAim";

// The DM's hand (issue #108): the monsters' turns as cards, above the
// message box where the players' Hand sits. The enemies the pointer walked
// past lead the roster (src/lib/dm/enemies-due.ts); any living enemy can be
// picked, as the console lets the DM correct anything. A played card is the
// console's own invoke call (monster-hand.ts), so the engine's rules hold:
// a legendary or lair card makes the spend and then what it buys, stopping
// at the first refusal.

function MonsterHandInner({
  campaignId,
  sheets,
  encounter,
  leaving,
  genre,
}: {
  campaignId: string;
  sheets: CharacterSheet[];
  encounter: PublicEncounter;
  // The fight is over and the mount is about to go: the fan folds away.
  leaving?: boolean;
  // The campaign's genre: the enemies' Dash, Dodge, Escape and the rest are
  // painted for it as the heroes' cards are (card-art.ts cardArtwork).
  genre?: string | null;
}) {
  const due = useMemo(() => encounter.enemiesDue ?? [], [encounter.enemiesDue]);
  const dueIds = useMemo(() => new Set(due.map((entry) => entry.id)), [due]);
  // The living enemies with actions to play, the due ones first, in the
  // order they are owed.
  const roster = useMemo(() => {
    const living = encounter.enemies.filter((enemy) => enemy.status === "alive" && enemy.actions);
    const byId = new Map(living.map((enemy) => [enemy.id, enemy]));
    const first = due.flatMap((entry) => (byId.has(entry.id) ? [byId.get(entry.id)!] : []));
    return [...first, ...living.filter((enemy) => !dueIds.has(enemy.id))];
  }, [encounter.enemies, due, dueIds]);

  const [enemyId, setEnemyId] = useState<string | null>(null);
  const selected =
    roster.find((enemy) => enemy.id === enemyId) ??
    roster.find((enemy) => dueIds.has(enemy.id) && !enemy.actions?.acted) ??
    roster[0] ??
    null;
  // Dash, Disengage and Dodge cards need a host that resolves an enemy's
  // (issue #621); the apps compile this hand and may open an older one.
  const capabilities = useCapabilities();
  const legendaryOn = hostOffers(capabilities, "legendaryCards");
  // Legendary and lair cards from a host that projects when they can be
  // taken (issue 685 audit); an older one leaves them to the console's forms.
  const cards = selected
    ? deriveMonsterHand(selected, { enemyActions: hostOffers(capabilities, "enemyActions"), legendaryCards: hostOffers(capabilities, "legendaryCards") })
    : [];

  // The other side as targets (issue 503): the party (and any creature it
  // dominates) for a foe, the foes (a turncoat among them) for a creature the
  // party dominates. The DM knows armour class, so the preview's odds are
  // real; the chip kind "enemy" means "a target whose AC we know".
  const mySide = selected ? (offSide(encounter, selected.id, "enemy") ?? "foe") : "foe";
  const party = useMemo<PartyChip[]>(
    () => [
      ...sheets
        .filter((sheet) => !sheet.deathSaves?.dead && (offSide(encounter, sheet.id, "pc") ?? "party") !== mySide)
        .map((sheet) => ({ id: sheet.id, name: sheet.name, kind: "enemy" as const, ac: effectiveAcFor(sheet), conditions: sheet.conditions, note: `${sheet.currentHp}/${effectiveMaxHp(sheet)} hp · AC ${effectiveAcFor(sheet)}` })),
      ...encounter.enemies
        .filter((enemy) => enemy.status === "alive" && (offSide(encounter, enemy.id, "enemy") ?? "foe") !== mySide)
        .map((enemy) => ({ id: enemy.id, name: enemy.name, kind: "enemy" as const, ac: enemy.ac, conditions: enemy.conditions, row: true, note: `${enemy.currentHp !== undefined ? `${enemy.currentHp}/${enemy.maxHp} hp` : enemy.health}${enemy.ac !== undefined ? ` · AC ${enemy.ac}` : ""}` })),
    ],
    [sheets, encounter, mySide],
  );
  // Its own side, for a legendary shield on itself or an ally, and everyone
  // in reach, for negative energy that spares nobody.
  const allies = useMemo<PartyChip[]>(
    () => [
      ...encounter.enemies
        .filter((enemy) => enemy.status === "alive" && (offSide(encounter, enemy.id, "enemy") ?? "foe") === mySide)
        .map((enemy) => ({ id: enemy.id, name: enemy.name, kind: "enemy" as const, ac: enemy.ac, conditions: enemy.conditions, row: true, note: `${enemy.currentHp !== undefined ? `${enemy.currentHp}/${enemy.maxHp} hp` : enemy.health}${enemy.ac !== undefined ? ` · AC ${enemy.ac}` : ""}` })),
      ...sheets
        .filter((sheet) => !sheet.deathSaves?.dead && (offSide(encounter, sheet.id, "pc") ?? "party") === mySide)
        .map((sheet) => ({ id: sheet.id, name: sheet.name, kind: "enemy" as const, ac: effectiveAcFor(sheet), conditions: sheet.conditions, note: `${sheet.currentHp}/${effectiveMaxHp(sheet)} hp · AC ${effectiveAcFor(sheet)}` })),
    ],
    [sheets, encounter, mySide],
  );

  const [pickedId, setPickedId] = useState<string | null>(null);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [advantage, setAdvantage] = useState<MonsterAdvantage>("none");
  // A legendary move's or jump's square, and the spell it casts.
  const [column, setColumn] = useState("");
  const [row, setRow] = useState("");
  const [spell, setSpell] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [lines, setLines] = useState<ResultLine[]>([]);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const collapsed = useSyncExternalStore(subscribeStore, readCollapsed, () => false);

  const picked = cards.find((card) => card.id === pickedId && !card.disabled) ?? null;
  const many = picked ? takesManyTargets(picked) : false;
  const intent = picked?.intent.card === "monster" ? picked.intent : null;
  // A save forced on one target is cast_at_player, a character's door.
  const sideChips = intent?.pick === "allies" ? allies : intent?.pick === "anyone" ? [...party, ...allies] : party;
  const chips = !picked || !intent || monsterAimsAtRows(picked) ? sideChips : sideChips.filter((chip) => !chip.row);
  const aimed = chips.filter((chip) => targetIds.includes(chip.id));
  const aim = aimed[0] ?? null;
  const defaultAim = aim ?? chips[0] ?? null;
  const conditions = selected?.conditions ?? EMPTY;
  // Cheap enough to work out each render; the compiler memoizes what it can.
  const rows = picked ? previewRows(picked, picked.target === "none" ? null : defaultAim, conditions) : [];
  const sentence = picked && selected ? monsterSentence(selected.name, picked, aimed.map((chip) => chip.name)) : "";
  const needsTarget = Boolean(picked && picked.target !== "none");
  const square = intent?.square ?? null;
  const squareSet = column.trim() !== "" && row.trim() !== "";
  const ready =
    Boolean(picked) &&
    (!needsTarget || aimed.length > 0) &&
    (!square || square.optional || squareSet) &&
    (!intent?.spells || Boolean(spell));

  function say(text: string) {
    setNotice(text);
    replayAnimation(noticeRef.current, "shake-x var(--dur-beat) var(--ease-snap) both");
  }

  function clearAim() {
    setPickedId(null);
    setTargetIds([]);
    setAdvantage("none");
    setColumn("");
    setRow("");
    setSpell("");
  }

  function pick(card: HandCard) {
    if (card.disabled) {
      say(card.disabled);
      return;
    }
    setNotice("");
    setTargetIds([]);
    setAdvantage("none");
    setColumn("");
    setRow("");
    setSpell("");
    setPickedId((current) => (current === card.id ? null : card.id));
  }

  function toggleTarget(id: string) {
    setTargetIds((current) => {
      if (!many) {
        return current[0] === id ? [] : [id];
      }
      if (current.includes(id)) {
        return current.filter((entry) => entry !== id);
      }
      // Lightning Storm's three bolts: no more creatures than it reaches.
      const most = intent?.most;
      return most && current.length >= most ? current : [...current, id];
    });
  }

  async function commit() {
    if (!picked || !selected || sending) {
      return;
    }
    const calls = monsterCalls(picked, aimed.map((chip) => chip.id), advantage, new Set(aimed.filter((chip) => chip.row).map((chip) => chip.id)), {
      square: squareSet ? { x: Number(column), y: Number(row) } : null,
      spell: spell || null,
    });
    if (!calls) {
      say(many ? "Pick everyone caught in it." : "Pick a target.");
      return;
    }
    setSending(true);
    setNotice("");
    try {
      const done: ResultLine[] = [];
      for (const [index, call] of calls.entries()) {
        // `hand`: a card, not the console's form. A table the AI runs refuses
        // an enemy's card from the GM seat (test-seats-logic.ts).
        const response = await fetch(`/api/campaigns/${campaignId}/dm/invoke`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...call, hand: true }),
        });
        const data = (await response.json().catch(() => ({}))) as { error?: string; result?: unknown };
        if (!response.ok) {
          // The engine's own reason. The card stays raised to try another
          // way, and what went through before it (a legendary action spent)
          // shows above.
          setLines(done);
          say(data.error || "The engine would not take that.");
          return;
        }
        // What a spend hands on ("Resolve it now with enemy_attack") is the
        // card's own next call, made below: not a step left for the GM.
        const handedOn = index < calls.length - 1 && data.result && typeof data.result === "object";
        done.push(...describeAdjudicationResult(handedOn ? { ...(data.result as Record<string, unknown>), next: undefined } : data.result));
      }
      setLines(done);
      clearAim();
    } catch {
      say("Could not reach the table.");
    } finally {
      setSending(false);
    }
  }

  // The initiative panel's two buttons, here too: the hand is where the DM
  // is looking while the enemies are due.
  async function handOn(play: boolean) {
    if (busy) {
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/initiative`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "enemies", play }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        say(data.error ?? "The order would not take that.");
      } else {
        clearAim();
      }
    } catch {
      say("Could not reach the table.");
    } finally {
      setBusy(false);
    }
  }

  if (!roster.length || !selected) {
    return null;
  }

  const current = encounter.orderReady ? encounter.order[encounter.turnIndex] : undefined;
  const middle = (cards.length - 1) / 2;
  const step = cards.length > 1 ? Math.min(4.4, 13 / (cards.length - 1)) : 0;

  return (
    <section
      className="hand"
      data-tour="monster-hand"
      aria-label="The monsters' hand"
      onKeyDown={(event) => {
        if (event.key === "Escape" && picked) {
          event.stopPropagation();
          clearAim();
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          key={due.length ? "due" : "free"}
          className="hand-label min-w-0 break-words font-display text-[11px] uppercase tracking-[0.14em] text-red-200/90"
        >
          {due.length ? "Enemy turns" : "The monsters"}
        </span>
        <span className="hidden text-[11px] text-stone-500 sm:inline">
          {due.length
            ? `Before ${current?.name ?? "the next turn"}: play each one, then hand on the turn.`
            : "Play a monster's action as a card; the engine rolls it."}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {due.length ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handOn(true)}
                className="min-h-9 rounded-md border border-red-800 bg-red-950/50 px-2.5 py-1 text-xs text-red-100 disabled:opacity-40 motion-press sm:min-h-7"
              >
                Play the rest for me
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handOn(false)}
                className="min-h-9 rounded-md border border-amber-700 bg-amber-950/50 px-2.5 py-1 text-xs text-amber-100 disabled:opacity-40 motion-press sm:min-h-7"
              >
                Hand on the turn
              </button>
            </>
          ) : null}
          <Tooltip content={collapsed ? "Show the monsters' cards" : "Put the cards away. The console still has every action."}>
            <button
              type="button"
              onClick={() => {
                clearAim();
                writeCollapsed(!collapsed);
              }}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Show the monsters' cards" : "Hide the monsters' cards"}
              className="flex size-9 items-center justify-center rounded-lg text-stone-500 hover:text-amber-200 sm:size-7"
            >
              <ChevronDown className={cn("chevron-turn size-4", collapsed && "rotate-180")} />
            </button>
          </Tooltip>
        </span>
      </div>

      {collapsed ? null : (
        <>
          {/* Whose cards: the due enemies first, each with its hit points
              and whether it has acted this round. */}
          <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Which monster">
            {roster.map((enemy, index) => {
              const isDue = dueIds.has(enemy.id);
              const acted = Boolean(enemy.actions?.acted);
              const movement = enemy.actions?.movement;
              return (
                <button
                  key={enemy.id}
                  type="button"
                  style={{ "--i": index } as CSSProperties}
                  aria-pressed={enemy.id === selected.id}
                  onClick={() => {
                    setEnemyId(enemy.id);
                    clearAim();
                  }}
                  className={cn(ui.btnSmall, "hand-target min-h-11 flex-col items-start gap-0 px-3 py-1 text-left sm:min-h-9")}
                >
                  <span className={cn("text-[13px] leading-tight text-stone-200", acted && "text-stone-500 line-through")}>
                    {isDue ? <span className="mr-1 inline-block size-1.5 rounded-full bg-red-400 align-middle" aria-label="due" /> : null}
                    {enemy.name}
                  </span>
                  <span className="font-mono text-[10px] leading-tight text-stone-500">
                    {enemy.currentHp !== undefined ? `${enemy.currentHp}/${enemy.maxHp} hp` : enemy.health}
                    {enemy.ac !== undefined ? ` · AC ${enemy.ac}` : ""}
                    {acted ? " · acted" : ""}
                    {movement ? ` · ${movement.leftFeet} ft left${movement.dashes ? " · Dashed" : ""}` : ""}
                    {/* A legendary action or the lair may act now: say so on
                        the creature's chip, so the GM need not open each one. */}
                    {legendaryOn && enemy.actions?.legendary ? ` · ${enemy.actions.legendary.left} legendary` : ""}
                    {legendaryOn && enemy.actions?.lair?.length ? " · lair" : ""}
                  </span>
                  <SideBadge side={offSide(encounter, enemy.id, "enemy")} className="mt-0.5" />
                </button>
              );
            })}
          </div>

          <div
            key={selected.id}
            className="hand-fan"
            data-aiming={picked ? "true" : undefined}
            data-folding={leaving ? "true" : undefined}
            role="group"
            aria-label={`${selected.name}'s cards`}
          >
            {cards.map((card, index) => (
              <HandCardFace
                genre={genre}
                key={card.id}
                card={card}
                index={index}
                offset={index - middle}
                step={step}
                picked={picked?.id === card.id}
                attached={false}
                played={false}
                aim={card.target === "none" ? null : defaultAim}
                conditions={conditions}
                onPick={pick}
              />
            ))}
          </div>

          {selected.actions?.manual?.length ? (
            <p className="mt-1 truncate text-xs text-stone-400" title={selected.actions.manual.join(", ")}>
              By hand: {selected.actions.manual.join(", ")}
            </p>
          ) : null}

          {picked ? (
            <div className="hand-aim mt-1 rounded-xl border border-red-500/30 bg-stone-950/80 p-2.5 shadow-elev-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="hand-type-chip" style={{ "--chip-tone": typeTone(picked.type) } as CSSProperties}>
                  {typeLabel(picked.type)}
                </span>
                <span className="min-w-0 truncate font-display text-sm font-semibold text-amber-100">
                  {selected.name} · {picked.name}
                </span>
                <span className="ml-auto min-w-0 truncate text-xs text-stone-400">
                  {!needsTarget ? "Ready when you are." : aimed.length ? `Lined up on ${aimed.map((chip) => chip.name).join(", ")}.` : many ? "Pick everyone caught in it." : "Pick a target."}
                </span>
              </div>

              <MonsterAimControls
                chips={needsTarget ? chips : null}
                targetIds={targetIds}
                onToggle={toggleTarget}
                square={square}
                column={column}
                row={row}
                onColumn={setColumn}
                onRow={setRow}
                spells={intent?.spells ?? null}
                spell={spell}
                onSpell={setSpell}
                advantage={rollsMonsterAttack(picked) ? advantage : null}
                onAdvantage={setAdvantage}
              />

              <div className="hand-rows-box mt-2">
                <HandPreviewRows rows={rows} />
              </div>
              {sentence ? <p className="mt-2 text-xs italic text-stone-300">{sentence}</p> : null}

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={clearAim} className={cn(ui.btnSmall, "min-h-9")}>
                  <ArrowLeft className="size-3.5" /> Back
                </button>
                <button
                  type="button"
                  disabled={!ready || sending}
                  aria-busy={sending}
                  onClick={() => void commit()}
                  className={cn(ui.btnPrimary, "ml-auto min-h-9")}
                >
                  {sending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {picked.intent.card === "monster" && picked.intent.action === "flee" ? "Let it flee" : `Play ${picked.name}`}
                </button>
              </div>
            </div>
          ) : null}

          {lines.length ? <MonsterResultLines name={selected.name} lines={lines} onDismiss={() => setLines([])} /> : null}
        </>
      )}
      <p ref={noticeRef} role="status" className={cn("mt-1 text-xs text-amber-300", notice ? "" : "hidden")}>
        {notice}
      </p>
    </section>
  );
}

const EMPTY: string[] = [];

// Memoized like the composer it sits in.
export const MonsterHand = memo(MonsterHandInner);
