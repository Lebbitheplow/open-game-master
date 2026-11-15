// What a character's answer to a blow did to the creature that struck
// (Armor of Agathys's cold, Fire Shield's flame, Holy Aura's blinding,
// Thought Shield's psychic, a feature's retaliation), read off the creature
// as the answer found and left it, and how to take it back. Pure; the reads
// and writes are spell-retort.ts's.
//
// SRD 5.1 keys each answer to the hit: Armor of Agathys "If a creature hits
// you with a melee attack", Fire Shield "Whenever a creature within 5 feet of
// you hits you with a melee attack", Holy Aura "If a fiend or an undead hits
// a creature with a melee attack" (Thought Shield to the psychic damage the
// hit deals). Shield's +5 counts "including against the triggering attack",
// Cutting Words comes "before the GM determines whether the attack roll
// succeeds", and a reroll at disadvantage replaces the roll: an attack they
// turn into a miss never hit, and set off none of it. The engine lands an
// enemy's hit and its answers in one call (enemy-attack.ts) and the
// reactions after it (reaction-refund.ts settleHits), so the creature kept
// the flame of a blow that missed. What the answer did is kept with the
// swing, and taken back with it.

export type RetortCreature = {
  currentHp: number;
  maxHp: number;
  status: string;
  conditions: string[];
  conditionMeta: Record<string, unknown>;
};

export type Retort = {
  // The creature it answered.
  enemyId: string;
  // The answers that fired, for the line that takes them back.
  by: string[];
  // Hit points they took off it; below 0 when it drank them (a golem's
  // Fire Absorption).
  hp: number;
  // Its maximum as they met it: a creature whose form changed since (a
  // Polymorph's beast dropped) is not given back hit points of another body.
  maxHp: number;
  // They dropped it.
  fell: boolean;
  // Conditions they laid on it (Holy Aura's blindness), and those they ended
  // with their meta (the oil Fire Shield's flame burnt off).
  laid: string[];
  ended: Array<{ name: string; meta?: unknown }>;
};

// What the answers did, from the creature before and after them; null when
// they did nothing to it.
export function retortOf(enemyId: string, before: RetortCreature, after: RetortCreature, by: string[]): Retort | null {
  const laid = after.conditions.filter((name) => !before.conditions.includes(name));
  const ended = before.conditions
    .filter((name) => !after.conditions.includes(name))
    .map((name) => (name in before.conditionMeta ? { name, meta: before.conditionMeta[name] } : { name }));
  const hp = before.currentHp - after.currentHp;
  const fell = before.status === "alive" && after.status !== "alive";
  if (!hp && !fell && !laid.length && !ended.length) {
    return null;
  }
  return { enemyId, by, hp, maxHp: before.maxHp, fell, laid, ended };
}

// Two answers to the same swing (Thought Shield as the damage lands, the
// spells as the hit does) kept as one.
export function joinRetorts(first: Retort | null, second: Retort | null): Retort | null {
  if (!first || !second || first.enemyId !== second.enemyId) {
    return first ?? second;
  }
  return {
    enemyId: first.enemyId,
    by: [...first.by, ...second.by.filter((name) => !first.by.includes(name))],
    hp: first.hp + second.hp,
    maxHp: first.maxHp,
    fell: first.fell || second.fell,
    laid: [...first.laid, ...second.laid.filter((name) => !first.laid.includes(name))],
    ended: [...first.ended, ...second.ended.filter((entry) => !first.ended.some((had) => had.name === entry.name))],
  };
}

export type RetortBack = {
  currentHp: number;
  conditions: string[];
  conditionMeta: Record<string, unknown>;
  // Hit points given back (or taken, for hit points it drank).
  hp: number;
};

// The creature with the answer taken back, or null when nothing can be.
// A creature the answer slew stays slain: its death has let go of what it
// held, ended its concentration, taken its token off the board and may have
// ended the fight, none of which comes back. Hit points go back only to the
// body that lost them, within its maximum and never to 0; conditions it laid
// come off and those it ended come back, where nothing since has done the same.
export function retortBack(now: RetortCreature, retort: Retort): RetortBack | null {
  if (retort.fell || now.status !== "alive") {
    return null;
  }
  const sameBody = now.maxHp === retort.maxHp;
  const currentHp = sameBody && retort.hp ? Math.min(now.maxHp, Math.max(1, now.currentHp + retort.hp)) : now.currentHp;
  const meta = { ...now.conditionMeta };
  for (const name of retort.laid) {
    delete meta[name];
  }
  const kept = now.conditions.filter((name) => !retort.laid.includes(name));
  const back = retort.ended.filter((entry) => !kept.includes(entry.name));
  for (const entry of back) {
    if (entry.meta !== undefined) {
      meta[entry.name] = entry.meta;
    }
  }
  const conditions = [...kept, ...back.map((entry) => entry.name)];
  const changed = currentHp !== now.currentHp || conditions.length !== now.conditions.length || back.length > 0;
  return changed ? { currentHp, conditions, conditionMeta: meta, hp: currentHp - now.currentHp } : null;
}
