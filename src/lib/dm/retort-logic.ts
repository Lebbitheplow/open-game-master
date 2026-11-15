// What a character's answer to a blow did to the creature that struck
// (Armor of Agathys's cold, Fire Shield's flame, Holy Aura's blinding,
// Thought Shield's psychic, a feature's retaliation), read off the creature
// as the answer found and left it, and how to take it back. Pure; the reads
// and writes are spell-retort.ts's.
//
// The same holds for what the hit's own rider laid on the character it hit
// (RiderMark below): a wolf's prone, a constrictor's grapple, a wight's drain.
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

import { maxHpRiders, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";

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
  // The hit points each answer took, read apart (Thought Shield's psychic,
  // Armor of Agathys's cold): a reaction that changes how much of the blow
  // landed, or whether the temporary hit points were still there, corrects
  // that answer alone (SRD 5.1: Thought Shield deals "the same amount of
  // damage that you do"). Absent on records written before it.
  share?: Record<string, number>;
};

// What the answers did, from the creature before and after them; null when
// they did nothing to it. One answer's share is the whole; several give
// theirs in `share`.
export function retortOf(enemyId: string, before: RetortCreature, after: RetortCreature, by: string[], share?: Record<string, number>): Retort | null {
  const laid = after.conditions.filter((name) => !before.conditions.includes(name));
  const ended = before.conditions
    .filter((name) => !after.conditions.includes(name))
    .map((name) => (name in before.conditionMeta ? { name, meta: before.conditionMeta[name] } : { name }));
  const hp = before.currentHp - after.currentHp;
  const fell = before.status === "alive" && after.status !== "alive";
  if (!hp && !fell && !laid.length && !ended.length) {
    return null;
  }
  const shares = share ?? (by.length === 1 ? { [by[0]]: hp } : undefined);
  return { enemyId, by, hp, maxHp: before.maxHp, fell, laid, ended, ...(shares ? { share: shares } : {}) };
}

function joinShares(first: Retort["share"], second: Retort["share"]): Retort["share"] {
  if (!first && !second) {
    return undefined;
  }
  const out: Record<string, number> = { ...(first ?? {}) };
  for (const [name, hp] of Object.entries(second ?? {})) {
    out[name] = (out[name] ?? 0) + hp;
  }
  return out;
}

// Two answers to the same swing (Thought Shield as the damage lands, the
// spells as the hit does) kept as one.
export function joinRetorts(first: Retort | null, second: Retort | null): Retort | null {
  if (!first || !second || first.enemyId !== second.enemyId) {
    return first ?? second;
  }
  const share = joinShares(first.share, second.share);
  return {
    enemyId: first.enemyId,
    by: [...first.by, ...second.by.filter((name) => !first.by.includes(name))],
    hp: first.hp + second.hp,
    maxHp: first.maxHp,
    fell: first.fell || second.fell,
    laid: [...first.laid, ...second.laid.filter((name) => !first.laid.includes(name))],
    ended: [...first.ended, ...second.ended.filter((entry) => !first.ended.some((had) => had.name === entry.name))],
    ...(share ? { share } : {}),
  };
}

// The answer kept with `given` of one answer's hit points taken back (a
// reaction lessened what it answered); null when nothing it did is left.
export function lessenedRetort(retort: Retort, by: string, given: number): Retort | null {
  const share = { ...(retort.share ?? {}), [by]: Math.max(0, (retort.share?.[by] ?? 0) - given) };
  const hp = retort.hp - given;
  const left = retort.by.filter((name) => name !== by || share[name] > 0);
  if (!hp && !retort.fell && !retort.laid.length && !retort.ended.length) {
    return null;
  }
  return { ...retort, by: left, hp, share };
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

// ---- the rider's mark on the character hit ----

// What a hit's rider did to the conditions of the character it hit (SRD 5.1:
// the "Hit:" text is what the hit does): the conditions it laid, and the drain
// of their maximum it raised (one "max hp reduced" mark grows with each
// drain, so the smaller one it replaced is kept to put back).
export type RiderMark = {
  laid: string[];
  ended: Array<{ name: string; meta?: unknown }>;
  // A condition it held already that it changed (a swallow's restrained over
  // a grapple's): the meta it found, put back while the rider's still stands.
  changed?: Array<{ name: string; meta?: unknown; left?: unknown }>;
  // The grapples a swallow ended that the character held on others (swallow.ts
  // gripsHeldBy), put back by the refund when the bite no longer hits.
  released?: Array<{ kind: "sheet" | "enemy"; id: string; meta: unknown }>;
};

type Conditioned = { conditions: string[]; conditionMeta: Record<string, unknown> };

const heldName = (sheet: Conditioned, name: string) => sheet.conditions.find((entry) => isConditionNamed(entry, name));
const sameMeta = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// A swallow's mark (SRD 5.1: "the target is swallowed, and the grapple
// ends"): every condition of `names` it laid, ended or changed on the
// character, so a bite a reaction turns into a miss leaves them as it found
// them, the grapple it ended holding again.
export function swallowMarkOf(before: Conditioned, after: Conditioned, names: readonly string[]): RiderMark | null {
  const mark: Required<Pick<RiderMark, "laid" | "ended" | "changed">> = { laid: [], ended: [], changed: [] };
  for (const name of names) {
    const was = heldName(before, name);
    const now = heldName(after, name);
    if (now && !was) {
      mark.laid.push(now);
    } else if (was && !now) {
      mark.ended.push(was in before.conditionMeta ? { name: was, meta: before.conditionMeta[was] } : { name: was });
    } else if (was && now && !sameMeta(before.conditionMeta[was], after.conditionMeta[now])) {
      mark.changed.push({ name: now, meta: before.conditionMeta[was], left: after.conditionMeta[now] });
    }
  }
  return mark.laid.length || mark.ended.length || mark.changed.length ? mark : null;
}

const drains = (sheet: Conditioned, name: string) => maxHpRiders([name], sheet.conditionMeta as ConditionMetaMap).drain > 0;

// The mark from the character before and after the rider. `own`: the
// conditions the rider reports it laid. A drop to 0 by the rider's damage
// lays unconscious and prone too, and the refund already undoes a drop that
// no longer happens, so only the rider's own conditions and its drain count.
export function riderMarkOf(before: Conditioned, after: Conditioned, own: readonly string[]): RiderMark | null {
  const laid = after.conditions.filter((name) => !before.conditions.includes(name) && (own.includes(name) || drains(after, name)));
  const ended = before.conditions
    .filter((name) => !after.conditions.includes(name) && drains(before, name))
    .map((name) => (name in before.conditionMeta ? { name, meta: before.conditionMeta[name] } : { name }));
  return laid.length || ended.length ? { laid, ended } : null;
}

// The character with the marks of riders that no longer hit taken off: their
// conditions gone, a drain they raised back to what it was.
export function ridersBack<T extends Conditioned>(sheet: T, marks: readonly RiderMark[]): T {
  let conditions = [...sheet.conditions];
  const meta = { ...sheet.conditionMeta };
  for (const mark of marks) {
    conditions = conditions.filter((name) => !mark.laid.includes(name));
    for (const name of mark.laid) {
      delete meta[name];
    }
    for (const entry of mark.ended.filter((had) => !conditions.includes(had.name))) {
      conditions.push(entry.name);
      if (entry.meta !== undefined) {
        meta[entry.name] = entry.meta;
      }
    }
    // Only where nothing since has changed it again.
    for (const entry of (mark.changed ?? []).filter((had) => conditions.includes(had.name) && sameMeta(meta[had.name], had.left))) {
      if (entry.meta === undefined) {
        delete meta[entry.name];
      } else {
        meta[entry.name] = entry.meta;
      }
    }
  }
  return { ...sheet, conditions, conditionMeta: meta };
}
