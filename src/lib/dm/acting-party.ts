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

export function actorOfCall(name: string, rawArguments: string): ActingParty | null {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  } catch {
    return null;
  }
  const text = (field: string | undefined) => (field && typeof args[field] === "string" && (args[field] as string).trim() ? (args[field] as string).trim() : null);
  const sheet = text(SHEET_FIELDS[name]);
  if (sheet) {
    return { kind: "sheet", ref: sheet };
  }
  const enemy = text(ENEMY_FIELDS[name]);
  return enemy ? { kind: "enemy", ref: enemy } : null;
}
