// The Bladesinger's Extra Attack (wizard, Bladesinging 6): "Attack twice with
// the Attack action, and one of those attacks may be a cantrip with a casting
// time of one action" (src/lib/srd/subclasses.json, wizard::Extra Attack).
//
// Before this a cantrip was always the whole action: after one swing of the
// rapier, Fire Bolt was refused with "Extra Attack gives more weapon attacks,
// not a second casting", which is the feature's own denial, and a cantrip cast
// first shut the Attack action for the turn.
//
// The rule, at the budget both cast paths charge (an attack-roll cantrip
// through pc_attack with `spell`, a save cantrip through cast_at_enemy: both
// reach cast-rules.ts turnCharge through the one cast door):
//   - for a holder, a cantrip with a casting time of one action is one attack
//     of the Attack action, counted by spendAttack itself, so it comes before
//     or after the weapon attack, a slowed bladesinger makes one attack in
//     all, and Action Surge's new action counts its own attacks;
//   - one cantrip per Attack action: a mark on the turn names the action it
//     was cast in, and a second cantrip in the same action is refused;
//   - a spell of 1st level or higher is still the whole action, never an
//     attack, and is refused once the action is spent.
// Ruling: Haste's extra action gives "one weapon attack", so it never pays for
// the cantrip.
//
// Called by turnCharge (the engine's cast guard and the Hand's spell cards
// both ask it), and by the Hand's afterCommit for the tests that walk a turn.
//
// Pure: no database.
import { actionsSpent, CASTING_HELD, spendAttack, spendCastAttack, type SpendResult, type TurnBudget } from "@/lib/dm/action-budget";
import { activeAuthored } from "@/lib/srd/authored-effects";

// The turn's mark that an Attack action has had its cantrip, by the count of
// whole actions spent when it was cast.
export const CANTRIP_ATTACK = "attack-cantrip:";

// Whether one attack of this character's Attack action may be a cantrip.
export function holdsCantripAttack(sheet: Parameters<typeof activeAuthored>[0]): boolean {
  return activeAuthored(sheet, "attack_cantrip").length > 0;
}

// A cantrip with a casting time of one action, cast by a holder: one attack
// of the Attack action.
export function spendCantripAttack(budget: TurnBudget, spell: string, who: string): SpendResult {
  const swing = spendAttack(budget, who, { hasteOk: false });
  if (!swing.ok) {
    // Slow's own refusal, and a casting that holds the action, say more.
    if (budget.slowed || budget.oncePerTurn.includes(CASTING_HELD)) {
      return swing;
    }
    return {
      ok: false,
      error: `${who} has no attack of the Attack action left to make ${spell} with: Extra Attack lets one attack of the action be a cantrip, and ${budget.castThisAction ? "this turn's action went on casting a spell" : budget.attacksMade > 0 ? `all ${budget.attacksAllowed} attacks of it are made` : "the action is spent"}. Nothing was spent.`,
      refused: "rules",
    };
  }
  const key = `${CANTRIP_ATTACK}${actionsSpent(swing.budget)}`;
  if (swing.budget.oncePerTurn.includes(key)) {
    return {
      ok: false,
      error: `${who} has already cast a cantrip in place of one attack of this Attack action, and Extra Attack allows one: the other attack is made with a weapon. ${spell} is not cast. Nothing was spent.`,
      refused: "rules",
    };
  }
  return {
    ok: true,
    budget: { ...swing.budget, oncePerTurn: [...swing.budget.oncePerTurn, key] },
    note: [swing.note, `Extra Attack: ${spell} takes the place of one attack of the Attack action.`].filter(Boolean).join(" "),
  };
}

// What a spell with a casting time of one action costs the turn: the whole
// action, or for a holder's cantrip one attack of the Attack action.
// `holder`: holdsCantripAttack of the caster. `cantrip`: the spell is one.
export function spendActionCast(budget: TurnBudget, spell: string, who: string, as: { holder: boolean; cantrip: boolean }): SpendResult {
  if (as.holder && as.cantrip) {
    return spendCantripAttack(budget, spell, who);
  }
  const spent = spendCastAttack(budget, spell, who);
  // The plain refusal says Extra Attack gives no casting at all, which is not
  // true of a holder: theirs gives a cantrip, and this spell is not one.
  if (!spent.ok && as.holder && budget.actionUsed && !budget.slowed && !budget.oncePerTurn.includes(CASTING_HELD)) {
    return {
      ok: false,
      error: `${who} has already used their action this turn; casting ${spell} needs one. Extra Attack lets one attack of the Attack action be a cantrip with a casting time of one action, not a spell of 1st level or higher. Nothing was spent.`,
      refused: "rules",
    };
  }
  return spent;
}
