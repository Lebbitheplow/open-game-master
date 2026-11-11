// Spell Thief (Arcane Trickster 17): "Right after a creature casts a spell
// that targets you or includes you in its area, a reaction makes it save
// (its spellcasting ability against your spell save DC). On a failure the
// spell has no effect on you, and if it is of 1st level or higher and of a
// level you can cast, you know it for 8 hours and the caster cannot cast it
// until then."
//
// The cast is on record (cast-at-player.ts recordTrigger "cast"), so the use
// is refused with none open before this runs (reaction-counters.ts). The
// spell has already landed when the reaction comes, so "no effect on you" is
// its damage handed back (the save record it rode, last-save.ts
// noteSaveDamage) and the conditions its caster laid on the rogue taken off.
// Before this the use and the reaction were spent and nothing happened.

import type { Campaign } from "@/lib/db/campaigns";
import { getDmTurn } from "@/lib/db/dm-turns";
import { getEnemy, patchEnemyConditions } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { effectiveMaxHp, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { openSaves, openTriggers } from "@/lib/dm/last-save";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { highestSlotLevel } from "@/lib/srd/scrolls";
import { spellLevelOf } from "@/lib/srd/spell-lists";
import { UNCONSCIOUS } from "@/lib/dm/vitals-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import { isConditionNamed } from "@/lib/srd/feature-names";

// The marks the theft leaves: on the rogue, the spell they know for 8 hours;
// on the caster, the spell it cannot cast until then (4800 rounds).
export const STOLEN_SPELL = "stolen spell";
export const SPELL_STOLEN = "spell stolen";
const EIGHT_HOURS = 4800;

type Mod = Record<string, number>;
const MENTAL = ["int", "wis", "cha"] as const;
const LABEL: Record<(typeof MENTAL)[number], string> = { int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

// The caster's spellcasting ability, read as its best mental score: a block's
// casting line is free text, and the score it names is the one it casts with.
function castingAbility(stats: { abilities?: Mod }): (typeof MENTAL)[number] {
  const scores = stats.abilities ?? {};
  return MENTAL.reduce<(typeof MENTAL)[number]>((best, ability) => ((scores[ability] ?? 10) > (scores[best] ?? 10) ? ability : best), "int");
}

export function planSpellThief(campaign: Campaign, turnId: string, rogue: CharacterSheet): ToolError | { apply: () => Record<string, unknown> } {
  const cast = openTriggers(campaign.id).filter((record) => record.kind === "cast" && record.characterId === rogue.id).at(-1);
  const caster = cast ? getEnemy(cast.forcer.id) : null;
  if (!cast || !caster) {
    return { error: `Spell Thief answers a spell a creature has just cast at ${rogue.name}, and none is on record. Nothing was spent.`, refused: "rules" };
  }
  return {
    apply: () => {
      const derived = computeSheetDerived(rogue);
      const dc = derived.spellSaveDc ?? 8 + derived.proficiencyBonus + derived.abilityMods.int;
      const ability = castingAbility(caster.stats as never);
      const save = rollEnemySave(campaign.id, caster, ability, dc, { magical: true, record: { turn: getDmTurn(turnId) ?? undefined, detail: `${caster.displayName}: ${LABEL[ability]} save against ${rogue.name}'s Spell Thief` } });
      const spell = cast.spell ?? "the spell";
      if (save.success) {
        return { save: `${caster.displayName} ${LABEL[ability]} save ${save.total} against DC ${dc}: made. ${spell} takes its course.` };
      }
      // The damage the spell dealt through its save comes back, and what its
      // caster laid on the rogue goes.
      const dealt = openSaves(campaign.id).filter((record) => record.characterId === rogue.id && record.forcer.id === caster.id && record.damage).at(-1)?.damage?.amount ?? 0;
      const now = getSheetById(rogue.id) ?? rogue;
      const laid = now.conditions.filter((name) => (now.conditionMeta as ConditionMetaMap)?.[name]?.source === caster.id);
      const hp = Math.min(effectiveMaxHp(now), now.currentHp + dealt);
      const woke = now.currentHp <= 0 && hp > 0;
      const cleared = removeConditions(now.conditions, now.conditionMeta as ConditionMetaMap, [...laid, ...(woke ? now.conditions.filter((name) => isConditionNamed(name, UNCONSCIOUS)) : [])]);
      // The slot the cast record names, else the spell's own level: a
      // creature's casting records no slot (cast-at-player.ts).
      const level = cast.level ?? spellLevelOf(spell) ?? 0;
      const steals = level >= 1 && highestSlotLevel(now) >= level;
      const conditions = steals ? [...cleared.conditions, `${STOLEN_SPELL} (${spell})`] : cleared.conditions;
      const meta = steals ? { ...cleared.meta, [`${STOLEN_SPELL} (${spell})`]: { rounds: EIGHT_HOURS, source: caster.id } } : cleared.meta;
      const updated = patchSheet(rogue.id, { currentHp: hp, conditions, conditionMeta: meta, ...(woke ? { deathSaves: null } : {}) });
      if (updated) publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      if (steals) {
        const fresh = getEnemy(caster.id) ?? caster;
        const mark = `${SPELL_STOLEN} (${spell})`;
        patchEnemyConditions(fresh.id, [...fresh.conditions.filter((entry) => !isConditionNamed(entry, mark)), mark], { ...(fresh.conditionMeta as ConditionMetaMap), [mark]: { rounds: EIGHT_HOURS, source: rogue.id } } as typeof fresh.conditionMeta);
        publishEncounter(campaign.id);
      }
      return {
        save: `${caster.displayName} ${LABEL[ability]} save ${save.total} against DC ${dc}: failed.`,
        applied: [
          `${spell} has no effect on ${rogue.name}${dealt ? `: ${dealt} damage comes back (HP ${hp})` : ""}${laid.length ? `, and ${laid.join(", ")} end` : ""}.`,
          ...(steals ? [`${rogue.name} knows ${spell} for 8 hours, and ${caster.displayName} cannot cast it until then.`] : level >= 1 ? [`${spell} is of a level ${rogue.name} cannot cast, so it is not stolen.`] : []),
        ],
      };
    },
  };
}
