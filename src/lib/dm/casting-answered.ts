// A creature's casting, checked before its spell resolves, and the cast it
// loses when a reaction makes the spell fail. Counterspell
// (src/lib/dm/reaction-spells.ts) and Magic-User's Nemesis
// (src/lib/dm/magic-users-nemesis.ts) both answer a spell "as it is cast": the
// model names the creature and the spell before it resolves the cast, and a
// spell that fails costs the creature its slot or use and the action it was
// cast with, so the engine refuses the cast that would have followed.
// Must not import mutations.ts (reaction-counters.ts plans through here).

import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { getActiveEncounter, saveEncounter, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { spellFactsFor } from "@/lib/content";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { characterSenses, sensesReaching } from "@/lib/dm/attack-light";
import { enemyActedThisRound } from "@/lib/dm/can-act";
import { spendEnemyAction } from "@/lib/dm/enemy-approach";
import { findMonsterSpell, slotFor, spellUsesLeft, spendSlot, spendSpellUse, type AbilityLedger } from "@/lib/dm/monster-abilities";
import { boughtByLegendary } from "@/lib/dm/enemy-casting";
import type { ToolError } from "@/lib/dm/tool-errors";
import { swallowCoverError } from "@/lib/dm/swallow";
import { textKey } from "@/lib/language/text-logic";

export type Counter = {
  enemy: EncounterEnemy;
  spell: string;
  // The level of the slot it is cast with (a cantrip and an innate use: the
  // spell's own).
  level: number;
  // How the creature pays for it: the slot or use the cast takes, and the
  // action, bonus action, reaction or legendary cantrip it costs.
  spend: (ledger: AbilityLedger | undefined) => AbilityLedger | undefined;
  timing: "action" | "bonus" | "reaction" | "legendary";
};

// Everything that can refuse a Counterspell, before the slot is spent: the
// creature named, the spell its block lists, a spell not yet resolved (the
// action, bonus action or reaction it costs not yet taken this round), a
// caster who can see it, and 60 ft.
// Shared by every reaction that answers a creature's casting before the spell
// resolves (Counterspell, Magic-User's Nemesis: magic-users-nemesis.ts).
// `name` is the reaction, `spellArg` the argument its call names the spell in.
export function checkCasting(
  input: { encounter: Encounter | null | undefined; sheet: CharacterSheet; targetEnemyId?: string; spell?: string },
  name = "Counterspell",
  spellArg = "spell",
): Counter | ToolError {
  const { encounter, sheet } = input;
  const args = input;
  const enemy = encounter && args.targetEnemyId ? resolveTargetFoe(encounter.campaignId, encounter, args.targetEnemyId) : null;
  if (!encounter || !enemy || enemy.status !== "alive") {
    return { error: `${name} answers a creature casting a spell: pass its targetEnemyId and the spell${spellArg === "spell" ? "" : ` (${spellArg})`}. Nothing was spent.`, retry: true };
  }
  const wanted = (args.spell ?? "").trim();
  if (!wanted) {
    return { error: `${name} needs the spell ${enemy.displayName} is casting (${spellArg}), so the server knows its level. Nothing was spent.`, retry: true };
  }
  // Not across a swallower's wall, either way (swallow.ts).
  const walled = swallowCoverError(sheet.id, enemy.id);
  if (walled) {
    return walled;
  }
  // Only a spell the creature can cast: its block's list.
  const casting = enemy.stats.spellcasting;
  const listed = findMonsterSpell(casting, wanted);
  const innate = (enemy.stats.spells ?? []).find((name) => textKey(name) === textKey(wanted));
  if (!listed && !innate) {
    return { error: `${enemy.displayName}'s stat block lists no ${wanted}; ${name} answers a spell the creature is casting. Nothing was spent.`, refused: "rules" };
  }
  const facts = spellFactsFor(wanted);
  const own = listed?.level ?? facts?.level ?? null;
  if (own === null) {
    return { error: `The server does not know the level of "${wanted}"; name the spell as its stat block lists it. Nothing was spent.`, retry: true };
  }
  // A caster who cannot see the creature cannot target it.
  if (sheet.conditions.some((entry) => entry.toLowerCase() === "blinded")) {
    return { error: `${sheet.name} is blinded: ${name} needs a creature they can see. Nothing was spent.`, refused: "rules" };
  }
  // Revelation in Flesh shows the invisible within 60 feet (the one sight rule, attack-light.ts sensesReaching).
  const unveiled = sensesReaching(encounter.id, { refId: sheet.id, senses: characterSenses(sheet) }, { refId: enemy.id }).invisible;
  const unseen = enemy.conditions.some((entry) => entry.toLowerCase() === "invisible") && !seesInvisible(sheet) && !unveiled;
  if (unseen) {
    return { error: `${enemy.displayName} is invisible to ${sheet.name}: ${name} needs a creature they can see. Nothing was spent.`, refused: "rules" };
  }
  const apart = tilesBetween(encounter.id, sheet.id, enemy.id);
  if (apart !== null && apart > 12) {
    return { error: `${enemy.displayName} is ${apart * 5} ft away; ${name} reaches a creature within 60 ft. Nothing was spent.`, refused: "rules" };
  }
  // What the cast costs the creature, and whether it has already been paid
  // (a spell already resolved cannot be countered).
  const ledger = encounter.legendary.abilities?.[enemy.id];
  const timing: Counter["timing"] =
    own === 0 && boughtByLegendary(encounter, enemy.id).includes("cantrip")
      ? "legendary"
      : facts?.castingTime === "bonus"
        ? "bonus"
        : facts?.castingTime === "reaction"
          ? "reaction"
          : "action";
  const paid =
    timing === "action"
      ? enemyActedThisRound(encounter, enemy.id)
      : timing === "bonus"
        ? encounter.legendary.bonus?.round === encounter.round && encounter.legendary.bonus.ids.includes(enemy.id)
        : timing === "reaction"
          ? encounter.reactionsUsed.includes(enemy.id)
          : false;
  if (paid) {
    return {
      error: `${enemy.displayName} has already taken its ${timing === "bonus" ? "bonus action" : timing} this round; a spell already resolved cannot be countered. Call ${name} before resolving the enemy's spell. Nothing was spent.`,
      refused: "rules",
    };
  }
  let level = own;
  let spend: Counter["spend"] = (next) => next;
  if (listed?.perDay) {
    if (spellUsesLeft(ledger, listed) <= 0) {
      return { error: `${enemy.displayName} has no use of ${wanted} left today; it cannot be casting it. Nothing was spent.`, refused: "rules" };
    }
    spend = (next) => spendSpellUse(next, listed.name);
  } else if (own > 0 && listed && listed.level !== null && casting && Object.keys(casting.slots).length) {
    const slot = slotFor(casting, ledger, own);
    if (slot === null) {
      return { error: `${enemy.displayName} has no spell slot left for ${wanted}; it cannot be casting it. Nothing was spent.`, refused: "rules" };
    }
    level = slot;
    spend = (next) => spendSlot(next, slot);
  }
  return { enemy, spell: wanted, level, spend, timing };
}

// See Invisibility, True Seeing or a truesight sense lets a caster see an
// invisible creature.
function seesInvisible(sheet: CharacterSheet): boolean {
  const lines = [...sheet.conditions, ...sheet.features.map((feature) => feature.name)].join(" ").toLowerCase();
  return /see invisibility|true seeing|truesight|blindsight/.test(lines);
}

// The cast a creature loses: its slot or use goes, and so does the action,
// bonus action, reaction or legendary cantrip it was cast with, so the engine
// refuses the cast that would have followed. What goes through here: every
// reaction that makes a spell fail before it resolves.
export function wasteCasting(campaignId: string, counter: Counter) {
  const live = getActiveEncounter(campaignId);
  if (!live) {
    return;
  }
    const abilities = { ...(live.legendary.abilities ?? {}) };
    let ledger = counter.spend(abilities[counter.enemy.id]);
    if (counter.timing === "legendary") {
      const bought = ledger?.bought ?? [];
      const at = bought.indexOf("cantrip");
      ledger = { ...(ledger ?? {}), bought: bought.filter((_, index) => index !== at) };
    } else if (counter.timing === "bonus") {
      const used = live.legendary.bonus?.round === live.round ? live.legendary.bonus.ids : [];
      live.legendary.bonus = { round: live.round, ids: [...used, counter.enemy.id] };
    } else if (counter.timing === "reaction") {
      live.reactionsUsed = [...live.reactionsUsed, counter.enemy.id];
    } else {
      spendEnemyAction(live, counter.enemy.id);
    }
    if (ledger) {
      abilities[counter.enemy.id] = ledger;
    }
    live.legendary.abilities = abilities;
  saveEncounter(live);
}

// What the lost cast cost the creature, in words.
export function castingCost(counter: Counter): string {
  return counter.timing === "bonus" ? "its bonus action" : counter.timing === "reaction" ? "its reaction" : counter.timing === "legendary" ? "the legendary action that bought it" : "its action for the round";
}

