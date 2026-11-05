// Who is acting in the engine call running now: the character or creature
// whose tool call it is (pc_attack's characterId, enemy_attack's enemyId, an
// area's caster). Damage applied while the call runs is theirs, which is how
// the damage a swallowed creature deals its swallower from inside is counted
// wherever it lands (src/lib/dm/swallow.ts noteBlowFromInside, called from
// enemy-damage.ts applyEnemyDamage): a weapon, a smite or a Sneak Attack
// riding it, a spell, an area, a reaction or a feature's spend.
//
// Set around the synchronous handlers only (encounter-tools.ts
// applyEncounterCall, mutations.ts applyDmMutation), so no other request's
// call can run while it is set.

export type ActingParty = { kind: "sheet" | "enemy"; ref: string };

let acting: ActingParty | null = null;

export function withActor<T>(party: ActingParty | null, run: () => T): T {
  const before = acting;
  acting = party ?? before;
  try {
    return run();
  } finally {
    acting = before;
  }
}

export function currentActor(): ActingParty | null {
  return acting;
}

// Whose turn the engine is working through when the fight's own state does
// not say it: a creature's turn ends as the pointer moves on past the
// character after it (turn-end.ts), so the mark that burns as its turn ends
// (Acid Arrow) is dealt on that creature's turn, not on the character's the
// pointer leaves (src/lib/dm/swallow.ts counts damage from inside so).
let turnOf: string | null = null;

export function withTurnOf<T>(id: string, run: () => T): T {
  const before = turnOf;
  turnOf = id;
  try {
    return run();
  } finally {
    turnOf = before;
  }
}

export function turnInHand(): string | null {
  return turnOf;
}

// The field naming who acts, by tool: a character's own calls, and the
// creature's.
const SHEET_FIELDS: Record<string, string> = {
  pc_attack: "characterId",
  cast_at_enemy: "characterId",
  use_reaction: "characterId",
  use_resource: "characterId",
  use_item: "characterId",
  take_action: "characterId",
  aoe_damage: "casterCharacterId",
};
const ENEMY_FIELDS: Record<string, string> = {
  enemy_attack: "enemyId",
  cast_at_player: "casterEnemyId",
  aoe_damage: "casterEnemyId",
  take_action: "enemyId",
};

// Read before the tool validates its arguments, so anything JSON can hold
// (null, an array, a number) names no one here and the tool's own schema
// refuses it.
export function actorOfCall(name: string, rawArguments: string): ActingParty | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments || "{}");
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const args = parsed as Record<string, unknown>;
  const text = (field: string | undefined) => (field && typeof args[field] === "string" && (args[field] as string).trim() ? (args[field] as string).trim() : null);
  const sheet = text(SHEET_FIELDS[name]);
  if (sheet) {
    return { kind: "sheet", ref: sheet };
  }
  const enemy = text(ENEMY_FIELDS[name]);
  return enemy ? { kind: "enemy", ref: enemy } : null;
}
