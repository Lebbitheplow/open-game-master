// Storing a spell in a Ring of Spell Storing and casting it back out.
//
// Storing goes through use_spell_slot with storeIn: a character at the table
// pays for the casting through the one cast guard, the slot and the action,
// and the guard puts the spell in the ring, where it has no effect. With
// storedBy instead, the caster is someone the table has no sheet for (an NPC,
// or whoever filled a ring the party found), and nothing of the party's is
// spent.
//
// SRD 5.1 says a spell that does not fit is expended without effect. Here it
// is refused before anything is spent: the free levels are on the sheet, so a
// person standing there would know, and a DM's wrong call should not cost a
// player a slot.
//
// SRD 5.1: the caster casts it "by touching the ring as the spell is cast", so
// on a mapped fight someone else's ring must be beside them. No map, no distance
// to hold them to.
//
// A reaction spell cast into the ring has no trigger to answer, so in a fight
// it takes the caster's action rather than their reaction. A spell of a minute
// or more is held across turns as any other casting is (long-casting.ts), going
// in or coming out.
//
// Casting one back goes through use_item with spell, which writes the same
// credit a wand or a scroll does (src/lib/srd/item-cast-credit.ts): the spell's
// own tool then resolves it with no slot and the original caster's numbers, and
// only then does it leave the ring (src/lib/dm/item-casts.ts).

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { spellFactsFor } from "@/lib/content";
import { spendAction } from "@/lib/dm/action-budget";
import { canAct } from "@/lib/dm/can-act";
import type { CastResult, CastStoring } from "@/lib/dm/cast-guard";
import { scrollNumbers } from "@/lib/dm/consumables";
import { heldTurnRefusal } from "@/lib/dm/held-turn";
import { beginHeldCasting } from "@/lib/dm/long-casting";
import { castingRoundsOf, completedCastingOf } from "@/lib/dm/long-casting-logic";
import { readiedReleaseFor } from "@/lib/dm/readied-release";
import { creditStoredSpell, putInRing, storeRefusal, storerNamed } from "@/lib/dm/ring-store";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { swallowCoverError } from "@/lib/dm/swallow";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
// The credits live in the database on the server (src/lib/db/item-cast-credits.ts).
import "@/lib/db/item-cast-credits";
import { spellDrawnMark, takeItemCast } from "@/lib/srd/item-cast-credit";
import { ringBarrier, storedSpellNamed, storedSpellsOf, storeLevelsFree, type StoredSpell } from "@/lib/srd/spell-storing";

export type StoreRequest = {
  storeIn: string;
  spell: string;
  level?: number;
  // A caster with no sheet at this table.
  storedBy?: string;
};

// `cast` is the cast guard with this caster's hooks already on it, so a store
// spends what any cast spends.
export function storeSpell(
  campaign: Campaign,
  turnId: string,
  caster: CharacterSheet,
  holder: CharacterSheet,
  request: StoreRequest,
  cast: (input: { spell: string; level?: number; dryRun?: boolean; storing: CastStoring }) => CastResult,
): ToolResult {
  const ring = storerNamed(holder, request.storeIn);
  if (!ring) {
    return { error: `${holder.name} carries no Ring of Spell Storing named "${request.storeIn}". Nothing was spent.`, retry: true };
  }
  const facts = spellFactsFor(request.spell, spellAuthorsFor(campaign));
  const name = facts?.name ?? request.spell;
  if (facts?.level === 0) {
    return { error: `${ring.name} stores spells of 1st through 5th level, and ${name} is a cantrip. Nothing was spent.`, refused: "rules" };
  }
  const waits = `${name} has no effect now: it waits in ${ring.name} until its wearer casts it.`;

  const storedBy = request.storedBy?.trim().slice(0, 80);
  if (storedBy) {
    if (!facts) {
      return { error: `The server does not know a spell called "${request.spell}". Name it as the spell lists do. Nothing was spent.`, retry: true };
    }
    const level = request.level ?? facts.level;
    if (level < facts.level) {
      return { error: `${name} is a level ${facts.level} spell and cannot be stored at level ${level}. Nothing was spent.`, retry: true };
    }
    const refused = storeRefusal(holder.id, request.storeIn, name, level);
    if (refused) {
      return refused;
    }
    // No caster at the table to take numbers from: a spell scroll's for the
    // level (SRD 5.1, Spell Scroll), and no modifier a table could name.
    const entry: StoredSpell = { spell: name, level, ...scrollNumbers(level), abilityMod: 0, by: storedBy };
    putInRing(campaign, turnId, holder.id, request.storeIn, entry);
    return { ok: true, storedIn: ring.name, holder: holder.name, spell: name, level, levelsFree: storeLevelsFree(ring) - level, saveDc: entry.saveDc, attackBonus: entry.attackBonus, note: waits };
  }

  if (caster.id !== holder.id) {
    const walled = swallowCoverError(caster.id, holder.id);
    if (walled) {
      return walled;
    }
    const encounter = getActiveEncounter(campaign.id);
    const apart = encounter ? tilesBetween(encounter.id, caster.id, holder.id) : null;
    if (apart !== null && apart > 1) {
      return { error: `${caster.name} must touch ${ring.name} to cast a spell into it, and ${holder.name} is ${apart * 5} ft away. They must move next to them first. Nothing was spent.`, refused: "rules" };
    }
  }
  // The guard asks whether it fits, by the slot it will really use: a warlock's
  // pact slot sets its own level.
  const asked = { spell: name, ...(request.level !== undefined ? { level: request.level } : {}), storing: { ring: ring.name, holderId: holder.id } };
  const check = cast({ ...asked, dryRun: true });
  if ("error" in check) {
    return check;
  }
  const spent = cast(asked);
  if ("error" in spent) {
    return spent;
  }
  // A casting held across turns goes in when it is done.
  if (typeof spent.casting === "string") {
    return { ...spent, note: `${name} goes into ${ring.name} when this casting is complete.` };
  }
  return { ...spent, storedIn: ring.name, holder: holder.name, levelsFree: storeLevelsFree(ring) - Number(spent.slotLevel ?? facts?.level ?? 0), note: waits };
}

// Casts a stored spell back out. Null for anything but a Ring of Spell Storing,
// so use_item goes on as it always has. A dry run asks every refusal and writes
// nothing, for a card asked before it is posted (intent-check.ts).
export function releaseStoredSpell(campaign: Campaign, sheet: CharacterSheet, itemName: string, spell: string | undefined, turnId: string, { dryRun = false }: { dryRun?: boolean } = {}): ToolResult | null {
  const ring = storerNamed(sheet, itemName);
  if (!ring) {
    return null;
  }
  if (sheet.deathSaves?.dead || sheet.currentHp <= 0) {
    return { error: `${sheet.name} is ${sheet.deathSaves?.dead ? "dead" : "unconscious at 0 hit points"} and cannot use ${ring.name}.`, refused: "rules" };
  }
  const barrier = ringBarrier(sheet, ring);
  if (barrier) {
    return { error: barrier, refused: "rules" };
  }
  const held = storedSpellsOf(ring);
  if (!held.length) {
    return { error: `${ring.name} holds no spells. A spell is stored by casting it into the ring: use_spell_slot with storeIn. Nothing was spent.`, refused: "rules" };
  }
  const named = spell?.trim();
  if (!named && held.length > 1) {
    return { error: `${ring.name} holds ${held.map((entry) => entry.spell).join(", ")}; name the one cast in spell. Nothing was spent.`, retry: true };
  }
  const [only] = held;
  const entry = storedSpellNamed(ring, named || only.spell);
  if (!entry) {
    return { error: `${ring.name} holds ${held.map((other) => other.spell).join(", ")}, not ${named}. Nothing was spent.`, refused: "rules" };
  }
  const numbers = [entry.saveDc ? `save DC ${entry.saveDc}` : "", entry.attackBonus ? `attack +${entry.attackBonus}` : ""].filter(Boolean).join(", ");
  const facts = spellFactsFor(entry.spell, spellAuthorsFor(campaign));
  const time = facts?.castingTime;
  const reaction = time === "reaction";
  const summary = {
    ok: true,
    used: ring.name,
    spellCast: entry.spell,
    spellLevel: entry.level,
    ...(entry.saveDc ? { saveDc: entry.saveDc } : {}),
    ...(entry.attackBonus ? { attackBonus: entry.attackBonus } : {}),
  };
  const resolveNote = reaction
    ? `${entry.spell} is ready to cast from ${ring.name} as a reaction: use_reaction with feature "${entry.spell}" when its trigger happens. It spends no slot, and leaves the ring only then.`
    : `Resolve ${entry.spell} now with the spell's own tool, ${sheet.name} as its caster: that cast spends no slot, uses level ${entry.level}${numbers ? ` and ${numbers}` : ""}, and takes it out of ${ring.name}.`;
  // A second call before the spell's tool ran pays for nothing new.
  if (takeItemCast(sheet.id, entry.spell, { dryRun: true })) {
    return { ...summary, note: resolveNote };
  }
  // A casting held across turns has been paid for, turn by turn: its card finishes
  // it (long-casting.ts). The credit it left may have run out meanwhile.
  if (completedCastingOf(sheet, entry.spell)) {
    if (!dryRun) {
      creditStoredSpell(sheet.id, ring, entry);
    }
    return { ...summary, note: resolveNote };
  }
  const encounter = getActiveEncounter(campaign.id);
  // Off their turn, a use they readied: their reaction (readied-release.ts).
  // A reaction spell spends its own, when use_reaction casts it.
  const readied = reaction ? null : readiedReleaseFor(sheet, encounter, "item");
  if (readied && "error" in readied) {
    return toolError(readied);
  }
  let spent: ReturnType<typeof budgetFor> = null;
  if (encounter && !readied && !reaction) {
    const kind = time === "bonus" ? "bonus" : "action";
    const able = canAct({ sheet, encounter, kind });
    if (!able.ok) {
      return toolError(able);
    }
    const heldOff = heldTurnRefusal(encounter, sheet);
    if (heldOff) {
      return heldOff;
    }
    const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
    if (budget) {
      const paid = spendAction(budget, kind, `casting ${entry.spell} from ${ring.name}`, sheet.name);
      if (!paid.ok) {
        return toolError(paid);
      }
      spent = { ...paid.budget, oncePerTurn: [...paid.budget.oncePerTurn, spellDrawnMark(entry.spell)] };
      if (!dryRun) {
        storeBudget(encounter, spent);
      }
    }
  }
  if (dryRun) {
    return { ...summary, dryRun: true };
  }
  readied?.release();
  // SRD 5.1: "otherwise treated as if you cast the spell", so one of a minute
  // or more is held across their turns, and its credit waits for that to finish.
  const rounds = encounter && !reaction ? castingRoundsOf(facts, false) : null;
  if (encounter && rounds !== null) {
    const begun = beginHeldCasting(campaign, turnId, sheet, encounter, spent ? { budget: spent } : null, { name: entry.spell, facts, slotLevel: null, ritual: false, rounds, fromRing: ring.name });
    return { ...begun, used: ring.name, note: `${entry.spell} takes effect when this casting is complete, and stays in ${ring.name} until then.` };
  }
  creditStoredSpell(sheet.id, ring, entry);
  return { ...summary, note: resolveNote };
}
