// Magic-User's Nemesis (Monster Slayer 11): "A reaction forces a caster or
// teleporter within 60 feet to make a Wisdom save or lose the spell."
//
// The use answers the record of a creature's casting (cast-at-player.ts
// recordTrigger "cast", the row in src/lib/srd/trigger-table.ts), so with no
// spell on record it is refused and nothing is spent. A creature's spell has
// landed by the time a reaction can answer it (the engine resolves it where
// it is cast), so "lose the spell" is the spell undone on every character it
// was cast at: the damage it dealt through its save handed back and the
// conditions it laid taken off (undoSpellOn, which Spell Thief shares). Before
// this the use and the reaction were spent and the spell stood.
//
// A teleport by a creature keeps no record a reaction can answer, so that
// half of the sentence is still the GM's to rule at the table.
// Planned before the use is spent; must not import mutations.ts.

import type { Campaign } from "@/lib/db/campaigns";
import { getDmTurn } from "@/lib/db/dm-turns";
import { getEnemy, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { effectiveMaxHp, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { kindOf, openSaves, openTriggers, type LastSave } from "@/lib/dm/last-save";
import { openTriggersFor, type TriggerAsk } from "@/lib/dm/reaction-triggers";
import type { ToolError } from "@/lib/dm/tool-errors";
import { UNCONSCIOUS } from "@/lib/dm/vitals-logic";
import { computeSheetDerived } from "@/lib/srd";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { triggerSpecFor } from "@/lib/srd/trigger-table";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { textKey } from "@/lib/language/text-logic";

export const MAGIC_USERS_NEMESIS_ID = "sub_magic_users_nemesis";
const NAME = "Magic-User's Nemesis";

export type SpellUndone = { name: string; dealt: number; hp: number; laid: string[] };

// A creature's spell undone on one character it was cast at this turn: the
// damage it dealt through its save comes back (the save record it rode,
// last-save.ts noteSaveDamage) and the conditions its caster laid go. What
// goes through here: every reaction that makes a spell already resolved have
// no effect (Spell Thief on the rogue alone, Magic-User's Nemesis on all).
export function undoSpellOn(campaign: Campaign, targetId: string, casterId: string): SpellUndone | null {
  const now = getSheetById(targetId);
  if (!now) {
    return null;
  }
  const dealt = openSaves(campaign.id).filter((record) => record.characterId === targetId && record.forcer.id === casterId && record.damage).at(-1)?.damage?.amount ?? 0;
  const meta = (now.conditionMeta ?? {}) as ConditionMetaMap;
  const laid = now.conditions.filter((name) => meta[name]?.source === casterId);
  const hp = Math.min(effectiveMaxHp(now), now.currentHp + dealt);
  const woke = now.currentHp <= 0 && hp > 0;
  const cleared = removeConditions(now.conditions, now.conditionMeta, [...laid, ...(woke ? now.conditions.filter((name) => isConditionNamed(name, UNCONSCIOUS)) : [])]);
  const updated = patchSheet(targetId, { currentHp: hp, conditions: cleared.conditions, conditionMeta: cleared.meta, ...(woke ? { deathSaves: null } : {}) });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return { name: now.name, dealt, hp, laid };
}

type Plan = { apply: () => Record<string, unknown> };

export function planMagicUsersNemesis(campaign: Campaign, turnId: string, ranger: CharacterSheet, ask: TriggerAsk): Plan | ToolError {
  const spec = triggerSpecFor(ask.name, { counterId: ask.counterId });
  const event = spec ? openTriggersFor(ask, spec).at(-1) : undefined;
  const caster: EncounterEnemy | null = event?.creatureId ? getEnemy(event.creatureId) : null;
  // The castings of that creature this turn: one record for each character
  // its spell was cast at.
  const casts: LastSave[] = caster ? openTriggers(campaign.id).filter((record) => kindOf(record) === "cast" && record.forcer.id === caster.id && Boolean(record.characterId)) : [];
  const spell = casts.at(-1)?.spell ?? "the spell";
  if (!caster || caster.status !== "alive" || !casts.length) {
    return { error: `${NAME} answers a creature casting a spell within 60 feet of ${ranger.name}, and the server has none on record this turn. Nothing was spent.`, refused: "rules" };
  }
  return {
    apply: () => {
      const derived = computeSheetDerived(ranger);
      const dc = derived.spellSaveDc ?? 8 + derived.proficiencyBonus + derived.abilityMods.wis;
      const save = rollEnemySave(campaign.id, caster, "wis", dc, { magical: true, record: { turn: getDmTurn(turnId) ?? undefined, detail: `${caster.displayName}: WIS save against ${ranger.name}'s ${NAME}` } });
      if (save.success) {
        return { save: `${caster.displayName} Wisdom save ${save.total} against DC ${dc}: made. ${spell} takes its course.` };
      }
      const targets = [...new Set(casts.filter((record) => textKey(record.spell ?? "") === textKey(casts.at(-1)?.spell ?? "")).map((record) => record.characterId))];
      const undone = targets.map((id) => undoSpellOn(campaign, id, caster.id)).filter((entry): entry is SpellUndone => entry !== null);
      return {
        save: `${caster.displayName} Wisdom save ${save.total ?? "failed"} against DC ${dc}: failed.`,
        applied: [
          `${spell} fails and is wasted.`,
          ...undone.map((entry) => `It has no effect on ${entry.name}${entry.dealt ? `: ${entry.dealt} damage comes back (HP ${entry.hp})` : ""}${entry.laid.length ? `${entry.dealt ? ", and" : ":"} ${entry.laid.join(", ")} end${entry.laid.length === 1 ? "s" : ""}` : ""}.`),
        ],
      };
    },
  };
}
