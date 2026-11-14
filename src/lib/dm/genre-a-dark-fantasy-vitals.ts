// The dark fantasy classes' changes to stabilizing a dying creature, read by
// src/lib/dm/stabilize.ts handleStabilize and src/lib/dm/death.ts wakeStable:
// - Last Rites: "A dying creature you sing over stabilizes automatically and is
//   warded: it cannot be raised as undead": no Medicine check, and the ward is
//   a mark on the creature the table and the GM read.
// - Triage: "your stabilized patients wake with 1d4 HP after 1 minute": the
//   stable wait is a minute, not 1d4 hours, and the hit points it ends on are
//   the d4's, rolled as the creature is stabilized and carried in the mark
//   "triaged (N)" until it wakes.
// Before this both were lines of the GM's prompt.
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { dmRoll } from "@/lib/dm/roll-card";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { STABLE_SOURCE, UNCONSCIOUS } from "@/lib/dm/vitals-logic";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { downConditions } from "@/lib/dm/vitals-logic";
import { stableDeathTrack } from "@/lib/dm/death-logic";
import { creditFeatureTeleport } from "@/lib/dm/feature-teleport";

export const LAST_RITES_WARD = "warded by last rites";
const TRIAGED = "triaged";

// The line that stands for the Medicine check when the healer sings Last Rites.
export function lastRites(healer: CharacterSheet, patient: CharacterSheet): string | null {
  return holdsFeature(healer, "Last Rites") ? `${healer.name} sings Last Rites over ${patient.name}, who stabilizes and is warded against being raised as undead` : null;
}

type Wait = { hours: number; conditions: string[]; conditionMeta: ConditionMetaMap };

// The stable wait a Triage healer leaves: a minute, waking with the d4's hit
// points; null for any other healer.
export function triageWait(campaign: Campaign, turn: DmTurn | null, healer: CharacterSheet, patient: CharacterSheet, held: { conditions: string[]; conditionMeta: ConditionMetaMap }): (Wait & { minutes: number; hp: number }) | null {
  if (!holdsFeature(healer, "Triage")) {
    return null;
  }
  const hp = Math.max(1, dmRoll(campaign.id, turn, "custom", `Triage: hit points ${patient.name} wakes with (1d4)`, "1d4").total);
  const mark = `${TRIAGED} (${hp})`;
  return {
    hours: 0,
    minutes: 1,
    hp,
    conditions: [...held.conditions.filter((entry) => !isConditionNamed(entry, TRIAGED)), mark],
    conditionMeta: { ...held.conditionMeta, [UNCONSCIOUS]: { rounds: 10, source: STABLE_SOURCE }, [mark]: { rounds: 10 } },
  };
}

// The ward Last Rites leaves on the creature stabilized.
export function ritesWard(conditions: string[], meta: ConditionMetaMap): { conditions: string[]; conditionMeta: ConditionMetaMap } {
  return conditions.includes(LAST_RITES_WARD) ? { conditions, conditionMeta: meta } : { conditions: [...conditions, LAST_RITES_WARD], conditionMeta: { ...meta, [LAST_RITES_WARD]: {} } };
}

// The hit points a triaged creature wakes with, and its conditions without the mark.
export function triageWake(sheet: Pick<CharacterSheet, "conditions" | "conditionMeta">, woken: { conditions: string[]; conditionMeta: ConditionMetaMap }): { hp: number; conditions: string[]; conditionMeta: ConditionMetaMap } | null {
  const mark = sheet.conditions.find((entry) => isConditionNamed(entry, TRIAGED));
  const hp = mark ? Number(/\((\d+)\)/.exec(mark)?.[1] ?? 1) : 0;
  if (!mark || !hp) {
    return null;
  }
  const cleared = removeConditions(woken.conditions, woken.conditionMeta, [mark]);
  return { hp, conditions: cleared.conditions, conditionMeta: cleared.meta };
}

// The Flock Remembers: "1/long rest, when you drop to 0 HP, the flock carries
// you 60 ft to safety and you stabilize". Held at the drop (genre-drop-holds.ts):
// the doctor lies at 0, unconscious and stable, and is credited 60 feet of
// carrying the token may move (move_token, teleport true, spell "The Flock
// Remembers"), no opportunity attack drawn. Not on a killing blow, as no hold is.
const FLOCK = "dark_fantasy_the_flock_remembers";
export function flockHold(sheet: CharacterSheet, write: (target: CharacterSheet, patch: FullPatchSheetInput, delta: Record<string, unknown>) => void): Record<string, unknown> | null {
  const state = sheet.resources?.[FLOCK];
  if (!state || state.used >= state.max) {
    return null;
  }
  const down = downConditions(sheet);
  write(sheet, { currentHp: 0, resources: { ...sheet.resources, [FLOCK]: { max: state.max, used: state.used + 1 } }, conditions: down.conditions, conditionMeta: down.conditionMeta, deathSaves: stableDeathTrack() }, { "The Flock Remembers": true });
  creditFeatureTeleport(sheet.id, "The Flock Remembers", 60);
  return {
    ok: true,
    hp: `0/${sheet.maxHp}`,
    held: "The Flock Remembers",
    note: `${sheet.name} drops to 0, and the flock carries them up to 60 feet to safety: they are stable. Move their token with move_token, teleport true, spell "The Flock Remembers". The use is spent.`,
  };
}
