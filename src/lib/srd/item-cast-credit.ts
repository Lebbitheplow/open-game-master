// A spell cast from a magic item, waiting for the tool that resolves it.
//
// SRD 5.1, Magic Items, Spells: a spell cast from an item "doesn't expend any
// of the user's spell slots, and requires no components, unless the item's
// description says otherwise". Reading a spell scroll casts its spell with
// the scroll's own save DC and attack bonus. use_item spends the scroll or the
// charge (src/lib/dm/consumables.ts, src/lib/dm/item-use.ts) and writes a
// credit here; the cast guard (src/lib/dm/cast-guard.ts) takes it back when
// aoe_damage, cast_at_enemy, heal or cast_buff then resolves that spell, so
// the slot is never spent twice, and spellSaveDcFor / spellAttackFor
// (src/lib/srd/index.ts) read the item's numbers while it stands.
//
// Kept per sheet for a few minutes: long enough for the DM's reply to resolve
// the spell it just paid for, short enough that a scroll read and never
// resolved does not pay for a cast an hour later. On the server they are kept
// in the database (src/lib/db/item-cast-credits.ts), as a turn's last hits
// are: one held in memory was lost to a restart between use_item and the
// spell's tool, and with it the cast's free slot and the charge or scroll
// owed back when the cast never happened. "Revert this turn" forgets the
// credits the turn wrote and gives back the ones it used. The browser and a
// pure suite keep them in memory.
//
// A spell that runs on (Call Lightning's next bolt, a Spiritual Weapon's next
// strike) outlasts its credit, so the item's row keeps its numbers while the
// spell holds: runningItemSpell, written by src/lib/dm/item-casts.ts.

import { findNamed, textKey } from "@/lib/language/text-logic";
import type { EquipmentItem } from "@/lib/schemas/sheet";

const WINDOW_MS = 5 * 60 * 1000;
// A credit taken by the cast still lends its DC for a minute: the tool that
// resolves the spell may ask for the DC after the cast guard ran.
const NUMBERS_AFTER_USE_MS = 60 * 1000;

export type ItemCast = {
  spell: string;
  level: number;
  item: string;
  saveDc?: number;
  attackBonus?: number;
  // A healing spell's modifier, when it is not the user's own (a stored
  // spell keeps its original caster's).
  abilityMod?: number;
  // The Ring of Spell Storing it comes from: it leaves the ring when it is
  // cast (src/lib/dm/item-casts.ts).
  storedIn?: string;
  // What use_item spent for this cast, to put back if the cast never happens
  // (src/lib/dm/item-use.ts takeBackItemCast): the row as it stood, and the
  // charges it gave. A ring's spell is not spent until it is cast, and a die
  // that has already destroyed a wand cannot be taken back, so neither has one.
  paid?: { row: EquipmentItem; charges?: number };
  // The turn that paid: the same turn asking again is the one use, not a second
  // (src/lib/dm/item-use.ts paidItemCast).
  turnId?: string;
};

// `usedTurn`: the turn whose cast took it, so reverting that turn gives it back.
export type ItemCastCredit = ItemCast & { key: string; at: number; usedAt?: number; usedTurn?: string };

// Where the credits are kept. `turn` names the GM turn running now, if any.
export type ItemCastStore = {
  read(sheetId: string): ItemCastCredit[];
  write(sheetId: string, credits: ItemCastCredit[]): void;
  turn?(): string | null;
};

declare global {
  // Set by src/lib/db/item-cast-credits.ts when the server loads it; on
  // globalThis, as the dice script's hook is, so a module that loads it inside
  // an import cycle still finds it.
  var __odmItemCastStore: ItemCastStore | undefined;
}

const memory = new Map<string, ItemCastCredit[]>();
const MEMORY: ItemCastStore = {
  read: (sheetId) => memory.get(sheetId) ?? [],
  write: (sheetId, list) => void (list.length ? memory.set(sheetId, list) : memory.delete(sheetId)),
};
const store = (): ItemCastStore => globalThis.__odmItemCastStore ?? MEMORY;

// A credit still standing: waiting for its cast, or taken within the minute
// it lends its numbers.
export function creditStands(credit: ItemCastCredit, now: number): boolean {
  return credit.usedAt !== undefined ? now - credit.usedAt <= NUMBERS_AFTER_USE_MS : now - credit.at <= WINDOW_MS;
}

function live(sheetId: string, now: number): ItemCastCredit[] {
  const all = store().read(sheetId);
  const kept = all.filter((credit) => creditStands(credit, now));
  if (kept.length !== all.length) {
    store().write(sheetId, kept);
  }
  return kept;
}

// use_item just cast `cast.spell` for this character from an item.
export function recordItemCast(sheetId: string, cast: ItemCast, now = Date.now()) {
  const kept = live(sheetId, now).filter((credit) => credit.key !== textKey(cast.spell) || credit.usedAt !== undefined);
  const turnId = cast.turnId || store().turn?.() || undefined;
  kept.push({ ...cast, ...(turnId ? { turnId } : {}), key: textKey(cast.spell), at: now });
  store().write(sheetId, kept);
}

// Takes the waiting credit for this spell, if there is one: the cast is paid
// by the item. A dry run only looks.
export function takeItemCast(
  sheetId: string,
  spell: string,
  { dryRun = false, now = Date.now() }: { dryRun?: boolean; now?: number } = {},
): ItemCast | null {
  const key = textKey(spell);
  const list = live(sheetId, now);
  const credit = list.find((entry) => entry.key === key && entry.usedAt === undefined);
  if (!credit) {
    return null;
  }
  if (!dryRun) {
    credit.usedAt = now;
    const turn = store().turn?.();
    if (turn) {
      credit.usedTurn = turn;
    }
    store().write(sheetId, list);
  }
  return { spell: credit.spell, level: credit.level, item: credit.item, saveDc: credit.saveDc, attackBonus: credit.attackBonus, abilityMod: credit.abilityMod, storedIn: credit.storedIn, paid: credit.paid, turnId: credit.turnId };
}

// The waiting credit gone without a cast: the cast it paid for will not happen.
export function dropItemCast(sheetId: string, spell: string, now = Date.now()) {
  const key = textKey(spell);
  const kept = live(sheetId, now).filter((credit) => credit.key !== key || credit.usedAt !== undefined);
  store().write(sheetId, kept);
}

// The once-a-turn mark on the budget that says the action is spent on this spell and
// the spell has not been cast: a ring's draw whose tool has not run, or a wand's use
// whose cast was refused and whose charge came back. The Hand cannot see the credit,
// which is in the server's memory, so without this a card sent back after its tool
// refused (a target out of range) stood greyed for the action it had paid.
export function spellDrawnMark(spell: string): string {
  return `spell drawn:${textKey(spell)}`;
}

export type RunningItemSpell = { spell: string; level: number; saveDc?: number; attackBonus?: number; abilityMod?: number };

type RunningHolder = {
  concentratingOn?: string | null;
  conditions?: readonly string[];
  conditionMeta?: Record<string, { spell?: string } | undefined>;
  equipment?: ReadonlyArray<{ castRunning?: RunningItemSpell[] }>;
};

// A spell an item cast that this character still holds: by their concentration
// or by a condition it laid on them. Pure: read off the sheet, so it survives a
// restart and ends when the spell does.
export function runningItemSpell(sheet: RunningHolder, spell: string): RunningItemSpell | null {
  const entry = findNamed((sheet.equipment ?? []).flatMap((row) => row.castRunning ?? []), spell, (running) => [running.spell]);
  if (!entry) {
    return null;
  }
  const holding = [
    ...(sheet.concentratingOn ? [sheet.concentratingOn] : []),
    ...(sheet.conditions ?? []),
    ...Object.values(sheet.conditionMeta ?? {}).flatMap((meta) => (meta?.spell ? [meta.spell] : [])),
  ];
  return findNamed(holding, spell, (name) => [name]) ? entry : null;
}

// Whether an item pays for this spell now: a cast waiting, or one still running.
export function paidByItem(sheet: RunningHolder & { id: string }, spell: string): { level: number } | null {
  return takeItemCast(sheet.id, spell, { dryRun: true }) ?? runningItemSpell(sheet, spell);
}

// The item's own numbers for this spell while its credit stands (waiting, or
// taken within the last minute), or null.
export function itemCastNumbers(
  sheetId: string | undefined,
  spell: string,
  now = Date.now(),
): { saveDc?: number; attackBonus?: number; abilityMod?: number } | null {
  if (!sheetId || !spell.trim()) {
    return null;
  }
  const key = textKey(spell);
  const credit = [...live(sheetId, now)].reverse().find((entry) => entry.key === key);
  return credit ? { saveDc: credit.saveDc, attackBonus: credit.attackBonus, abilityMod: credit.abilityMod } : null;
}
