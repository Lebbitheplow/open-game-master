"use client";

import { useEffect, useRef } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/locale";
import { WIELD_LABEL, changeWears, gearWornState, isAttunable, isWeaponRow, isWornGear, itemStatus, wearLock } from "@/components/sheet/sheet-state";
import { isHeldFocus } from "@/components/sheet/paperdoll-logic";
import { armorChangeMinutes } from "@/lib/dm/don-doff";
import { guessStands, matchArmor } from "@/lib/srd/armor";
import { swapQuestion, wearConflict, type WearConflict } from "@/lib/srd/wear-slots";
import { contentName } from "@/lib/content/names";
import { magicItemBonus, rowName } from "@/lib/srd/item-row";
import { isTack } from "@/lib/srd/tack";
import { useLocale } from "@/lib/locale";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import type { HandsFull } from "@/lib/dm/gear-hands";
import { ITEM_CATEGORY_LABEL, itemCategory, itemToneStyle } from "@/lib/srd/item-category-logic";
import { inventoryItemIcon } from "@/lib/inventory-art-logic";

// One wearable item on the character sheet: its charges, whether it is
// attuning or cursed, and the wear and attune toggles with the engine's
// reasons on them (who may, when, and what the clock is charged). Split from
// CharacterSheetDialog.tsx, which posts the change. Putting it on where its
// kind is already worn (a second cloak) asks first, with the swap and, for
// the DM and the party lead, the SRD's exception of wearing both (issue 412).
// Taking up a weapon with both hands full asks which one goes back in the
// pack, where the route can make the change for nothing (issue 1105).
export function SheetGearRow({
  sheet,
  item,
  worn,
  idle = null,
  inCombat,
  myTurn,
  dead,
  busy,
  onGear,
  conflict = null,
  canLayer = false,
  onSwap,
  onLayer,
  hands = null,
  onHands,
  onDismiss,
}: {
  sheet: CharacterSheet;
  item: EquipmentItem;
  worn: boolean;
  // Worn, but its place is full and its magic does not count: "one cloak at
  // a time" (src/lib/srd/wear-slots.ts).
  idle?: string | null;
  inCombat: boolean;
  myTurn: boolean;
  dead: boolean;
  busy: boolean;
  onGear: (change: { equipped?: boolean; attuned?: boolean }) => void;
  // The question asked before a swap, while it is open on this row.
  conflict?: WearConflict | null;
  canLayer?: boolean;
  onSwap?: () => void;
  onLayer?: () => void;
  // The route's question for full hands, while it is open on this row, and
  // the answer: the weapons to put away as this one is taken up.
  hands?: HandsFull | null;
  onHands?: (putAway: string[]) => void;
  onDismiss?: () => void;
}) {
  // Magic gear works only while worn, so every row here can
  // be put on; only body armor is barred in a fight.
  const t = useT();
  const locale = useLocale();
  // The row reads in the reader's language (gear, weapons, armor), the magic
  // bonus riding on the translated base; the row's own key, the icon and
  // every patch sent stay the stored English name.
  const shownName = (() => {
    const shown = contentName("items", { slug: item.slug, name: rowName(item) }, locale);
    const bonus = magicItemBonus(item.name);
    return bonus ? `${shown} +${bonus}` : shown;
  })();
  const isArmor = matchArmor(item) !== null;
  const isShield = matchArmor(item)?.category === "shield";
  // What the fight bars now (sheet-state.ts wearLock): the route refused an
  // off-turn change while the button stayed open, so the refusal was the
  // first a player heard of it.
  const lock = wearLock(item, { inCombat, myTurn });
  const armorLocked = lock === "armor";
  const shieldLocked = lock === "shield";
  const isWeapon = !isArmor && isWeaponRow(item);
  const weaponLocked = lock === "weapon";
  const wornLocked = lock === "worn";
  const weaponHint = !isWeapon
    ? undefined
    : weaponLocked
      ? "Drawing or stowing a weapon happens on your own turn; it is not your turn."
      : guessStands(sheet.equipment)
        ? "Nobody has said which weapon is out yet, so the first change is free."
        : inCombat
          ? "Drawing or stowing a weapon takes your free object interaction, on your own turn."
          : undefined;
  // A wand, staff or rod is held too, and sits with the weapons on the
  // paperdoll's In hand place: its button reads as theirs do.
  const inHand = isWeapon || (!isArmor && isHeldFocus(item));
  // A saddle goes on the mount, where it weighs nothing for its rider
  // (src/lib/srd/tack.ts).
  const tack = isTack(item);
  const wearLabel = inHand
    ? t(WIELD_LABEL[worn ? "in-hand" : "stowed"])
    : tack
      ? worn
        ? t("On mount")
        : t(WIELD_LABEL.stowed)
      : worn
        ? t("worn")
        : t("wear");
  const status = itemStatus(t, sheet, item);
  const category = itemCategory(item);
  const attunable = isAttunable(item);
  // The question opens under the row that was pressed. In the paperdoll's
  // open place that row can be the last thing on a phone's screen, which
  // left the question, and its answer buttons, below the fold.
  const question = useRef<HTMLDivElement>(null);
  const asking = conflict?.item ?? hands?.item ?? null;
  // The other rows a question names, in the reader's language as this row is.
  const listed = (names: readonly string[]) => names.map((name) => contentName("items", name, locale)).join(t(" and "));
  useEffect(() => {
    if (asking) {
      question.current?.scrollIntoView({ block: "nearest" });
    }
  }, [asking]);
  return (
    <>
    <div data-gear-row={item.name} data-tone={category} style={itemToneStyle(category, "row")} className="flex items-center gap-2 text-xs text-stone-300">
      <GameIcon icon={inventoryItemIcon(item)} size="size-6" className="tone-rim" />
      <span className="min-w-0 grow truncate">
        <span className="sr-only">{ITEM_CATEGORY_LABEL[category]}: </span>
        {shownName}
      </span>
      {idle ? (
        <span className="motion-pop shrink-0 rounded-full border border-stone-700 px-1.5 text-[10px] text-stone-400" title={t("Worn, but a character wears {kind} at a time, so its magic does not count.", { kind: idle })}>
          {t("not in effect")}
        </span>
      ) : item.layered && worn ? (
        <span className="motion-pop shrink-0 rounded-full border border-amber-800/60 px-1.5 text-[10px] text-amber-300" title={t("Worn beside another of its kind, on the GM's say.")}>
          {t("beside another")}
        </span>
      ) : null}
      {status.charges ? (
        <span key={status.charges} className="motion-pop shrink-0 font-mono text-[10px] text-sky-300">
          {status.charges}
        </span>
      ) : null}
      {status.attuning ? (
        <span className="motion-pop shrink-0 rounded-full border border-sky-800/60 px-1.5 text-[10px] text-sky-300" title={t("Attuning takes a short rest; the next rest completes it.")}>
          {/* A phone's row has no room for the whole sentence beside a name; the sheet's item chip above says it in full. */}
          <span className="sm:hidden">{t("attuning")}</span>
          <span className="hidden sm:inline">{t("attunes at the next rest")}</span>
        </span>
      ) : null}
      {status.cursed ? (
        <span className="motion-pop shrink-0 rounded-full border border-red-800/60 px-1.5 text-[10px] text-red-300" title={status.attuneRefusal ?? t("Cursed")}>
          {t("cursed")}
        </span>
      ) : null}
      {/* Only what is worn or wielded offers it: a wand is held, a potion carried. */}
      {isWornGear(item) ? (
      <button
        type="button"
        disabled={busy || armorLocked || shieldLocked || weaponLocked || wornLocked || dead}
        aria-busy={busy}
        aria-label={
          inHand
            ? `${item.name}: ${wearLabel}. ${worn ? "Pack it away" : "Take it in hand"}.`
            : tack
              ? `${item.name}: ${wearLabel}. ${worn ? "Take it off your mount" : "Put it on your mount"}.`
              : undefined
        }
        title={
          dead
            ? t("{name} is dead and cannot change what they wear or are attuned to.", { name: sheet.name })
            : weaponHint
              ? weaponHint
              : tack && !inCombat
              ? worn
                ? t("On your mount, so it weighs nothing for you. Press to pack it, and carry its weight.")
                : t("In your pack, where it does nothing and you carry its weight. Press to put it on your mount.")
              : !inCombat
              ? // What the route will charge the clock (don-doff.ts), before the press.
                armorChangeMinutes(sheet.equipment, { [item.name]: { equipped: !worn } }).lines.join(" ") || undefined
              : !isArmor
                ? wornLocked
                  ? "Putting something on or taking it off happens on your own turn; it is not your turn."
                  : "Putting something on or taking it off takes your free object interaction, on your own turn."
                : isShield
                  ? shieldLocked
                    ? t("A shield takes your action, on your own turn; it is not your turn.")
                    : t("A shield takes your action, on your own turn")
                  : t("Armor takes minutes to change, so not during a fight")
        }
        onClick={() => onGear({ equipped: !worn })}
        className={cn(
          // A finger-sized target on a phone, the size of the kit's controls.
          "motion-press min-h-[40px] min-w-[40px] shrink-0 rounded border px-1.5 py-0.5 disabled:opacity-40 sm:min-h-0 sm:min-w-0",
          worn
            ? "border-amber-700/70 bg-amber-950/40 text-amber-200"
            : "border-stone-700 text-stone-400",
        )}
      >
        <span key={wearLabel} className="motion-pop inline-block">{wearLabel}</span>
      </button>
      ) : null}
      {attunable ? (
      <button
        type="button"
        disabled={busy || inCombat || dead || Boolean(status.attuneRefusal)}
        // The engine's refusal (attunementRefusal: a curse,
        // the three-item cap, who may attune).
        title={
          inCombat
            ? t("Attuning to an item, or ending it, takes a short rest, so not during a fight.")
            : (status.attuneRefusal ??
              // Ending it on purpose moves the clock an hour (don-doff.ts).
              (item.attuned
                ? armorChangeMinutes(sheet.equipment, { [item.name]: { attuned: false } }).lines.join(" ")
                : undefined))
        }
        onClick={() => onGear({ attuned: !(item.attuned || item.attuning) })}
        className={cn(
          "motion-press min-h-[40px] min-w-[40px] shrink-0 rounded border px-1.5 py-0.5 disabled:opacity-40 sm:min-h-0 sm:min-w-0",
          item.attuned
            ? "border-sky-800/70 bg-sky-950/40 text-sky-200"
            : "border-stone-700 text-stone-400",
        )}
      >
        {item.attuned ? t("attuned") : item.attuning ? t("cancel") : t("attune")}
      </button>
      ) : null}
    </div>
    {status.stored ? <p className="ml-8 text-[11px] text-stone-400">{status.stored}</p> : null}
    {conflict ? (
      <div ref={question} role="group" aria-label={t("Wear {name}?", { name: shownName })} className="reveal ml-8 space-y-1.5 rounded border border-amber-800/60 bg-amber-950/30 px-2 py-1.5 text-[11px] text-amber-100">
        <p>{swapQuestion(conflict)}</p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={busy} onClick={onSwap} className={cn(ANSWER, "border-amber-700/70 bg-amber-950/40 text-amber-200")}>
            {t("Take off {off}, wear {name}", { off: conflict.wearing.join(" and "), name: shownName })}
          </button>
          {canLayer ? (
            <button type="button" disabled={busy} onClick={onLayer} title={t("The SRD's exception, the GM's call: a circlet under a helmet, two cloaks layered.")} className={cn(ANSWER, "border-stone-600 text-stone-200")}>
              {t("Wear both (GM's call)")}
            </button>
          ) : null}
          <button type="button" onClick={onDismiss} className={cn(ANSWER, "border-stone-700 text-stone-400")}>
            {t("Keep as is")}
          </button>
        </div>
      </div>
    ) : null}
    {hands ? (
      <div ref={question} role="group" data-hands-question={item.name} aria-label={t("Take up {name}?", { name: shownName })} className="reveal ml-8 space-y-1.5 rounded border border-amber-800/60 bg-amber-950/30 px-2 py-1.5 text-[11px] text-amber-100">
        <p>
          {t("{who}'s hands are full ({items}), so something has to be put away before {name} is taken up.", { who: sheet.name, items: listed(hands.holding), name: shownName })}
          {/* In a fight the question is asked only while the change is free, and a player there expects a cost. */}
          {inCombat ? ` ${t("Nobody has said which weapon is out yet, so this change is free.")}` : null}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {hands.swaps.map((putAway) => (
            <button key={putAway.join("\n")} type="button" disabled={busy} onClick={() => onHands?.(putAway)} className={cn(ANSWER, "border-amber-700/70 bg-amber-950/40 text-amber-200")}>
              {t("Put away {off}, take up {name}", { off: listed(putAway), name: shownName })}
            </button>
          ))}
          <button type="button" onClick={onDismiss} className={cn(ANSWER, "border-stone-700 text-stone-400")}>
            {t("Keep as is")}
          </button>
        </div>
      </div>
    ) : null}
    </>
  );
}

// An answer to a question a row asks. Finger-sized on a phone, the size of
// the row's own toggle: at the line's own height the answers were under
// half that, with "keep as is" a few pixels from the one that changes gear.
const ANSWER = "motion-press min-h-[40px] rounded border px-1.5 py-0.5 disabled:opacity-40 sm:min-h-0";

type GearChange = { equipped?: boolean; attuned?: boolean };
type GearAsk = Record<string, GearChange & { layered?: boolean }>;

// The swap question open on one row: what was asked, and what fills its place.
export type PendingWear = { name: string; conflict: WearConflict; change: GearChange };

// The question full hands ask on the row that was to be taken up, as the
// route sent it (src/lib/dm/gear-hands.ts handSwaps).
export type PendingHands = { name: string; hands: HandsFull };

// One question is open on a sheet at a time, whichever kind it is.
export type PendingAsk = PendingWear | PendingHands;

// The question a change must ask before it is posted, or null when it can go
// straight through: a press on a row and a drop on the paperdoll both ask it.
export function wearQuestion(item: EquipmentItem, equipment: EquipmentItem[], change: GearChange): PendingWear | null {
  const conflict = changeWears(item, equipment, change) ? wearConflict(item, equipment) : null;
  return conflict ? { name: item.name, conflict, change } : null;
}

// Every wearable row of a sheet. A press that would put a row on where its
// kind is already worn opens the question instead of posting; the server
// refuses the same change with the same conflict (src/lib/dm/usage-rules.ts
// gearPatch), which opens it too. The swap takes the others off and puts
// this one on in one request; "wear both" is the DM's and the lead's. Full
// hands are the route's to judge (it knows the fight and the guess), so that
// question opens only from its answer, and is answered the same way: the
// weapons chosen put away and this one taken up in one request.
export function SheetGearRows({
  sheet,
  items,
  armor,
  corrects,
  inCombat,
  myTurn,
  dead,
  busy,
  pending,
  onPending,
  onGear,
}: {
  sheet: CharacterSheet;
  items: EquipmentItem[];
  armor: { armorName: string | null; shieldName: string | null };
  corrects: boolean;
  inCombat: boolean;
  myTurn: boolean;
  dead: boolean;
  busy: boolean;
  pending: PendingAsk | null;
  onPending: (pending: PendingAsk | null) => void;
  onGear: (gear: GearAsk) => void;
}) {
  return items.map((item) => {
    const state = gearWornState(item, sheet.equipment, armor);
    const asked = pending?.name === item.name ? pending : null;
    const open = asked && "conflict" in asked ? asked : null;
    const hands = asked && "hands" in asked ? asked.hands : null;
    return (
      <SheetGearRow
        key={item.name}
        sheet={sheet}
        item={item}
        worn={state.worn}
        idle={state.idle}
        inCombat={inCombat}
        myTurn={myTurn}
        dead={dead}
        busy={busy}
        onGear={(change) => {
          const question = wearQuestion(item, sheet.equipment, change);
          onPending(question);
          if (!question) {
            onGear({ [item.name]: change });
          }
        }}
        conflict={open?.conflict ?? null}
        canLayer={corrects}
        onSwap={() => {
          if (!open) return;
          onPending(null);
          const off = Object.fromEntries(open.conflict.wearing.map((name) => [name, { equipped: false }]));
          onGear({ ...off, [item.name]: { ...open.change, equipped: true } });
        }}
        onLayer={() => {
          if (!open) return;
          onPending(null);
          onGear({ [item.name]: { ...open.change, equipped: true, layered: true } });
        }}
        hands={hands}
        onHands={(putAway) => {
          onPending(null);
          const off = Object.fromEntries(putAway.map((name) => [name, { equipped: false }]));
          onGear({ ...off, [item.name]: { equipped: true } });
        }}
        onDismiss={() => onPending(null)}
      />
    );
  });
}
