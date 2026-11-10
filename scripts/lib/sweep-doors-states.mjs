// The states that bar a hero from acting, each with the SRD 5.1 sentence it
// keeps and how it is laid on the staged table (scripts/lib/sweep-doors.mjs),
// shared by the tool-door matrix and the player-route matrix.
//
//   bars(row)   whether the state bars that row's kind of act
//   apply       lays it, through the engine's own tool where one lays it
//   stage       "main" unless the state needs a table of its own
//   family      the refusal kinds a tool may answer with (tool-errors.ts)
import assert from "node:assert/strict";

export const ACTORS = ["brom", "sera", "wren"];

export async function heroStates() {
  const encounters = await import("../../src/lib/db/encounters.ts");
  const lay = (condition, extra = () => ({})) => async (t, id, row) => {
    const out = await t.world.invoke("set_condition", { characterId: id, condition, ...extra(t, row) });
    assert.ok(out.ok, `laying ${condition}: ${out.error}`);
  };
  const TURN_KINDS = ["attack", "cast", "action", "bonus", "command"];
  const acts = (row, ...more) => [...TURN_KINDS, ...more].includes(row.kind);
  const INCAPACITATED = "SRD 5.1, Incapacitated: \"An incapacitated creature can't take actions or reactions.\"";
  const BONUS = "SRD 5.1, Bonus Actions: \"anything that deprives you of your ability to take actions also prevents you from taking a bonus action.\"";

  const STATES = [
    {
      id: "dead", words: "dead", family: ["refused:rules"],
      rule: "A dead character does nothing: SRD 5.1, Death Saving Throws, \"On your third failure, you die.\"",
      // Passing the turn the pointer rests on is how a fallen hero's turn goes by.
      bars: (row) => row.kind !== "pass",
      apply: (t, id) => t.world.patch(id, { currentHp: 0, conditions: [], deathSaves: { successes: 0, failures: 3, stable: false, dead: true } }),
    },
    {
      id: "dying", words: "dying at 0 hit points", family: ["refused:rules"],
      rule: `SRD 5.1, Falling Unconscious: "If damage reduces you to 0 hit points and fails to kill you, you fall unconscious." ${INCAPACITATED} ${BONUS}`,
      bars: (row) => acts(row, "reaction", "move", "free"),
      apply: async (t, id) => {
        const out = await t.world.invoke("apply_damage", { characterId: id, amount: t.world.sheet(id).currentHp, type: "slashing" });
        assert.ok(out.ok && t.world.sheet(id).currentHp === 0 && !t.world.sheet(id).deathSaves?.dead, `dropping them to 0: ${out.error}`);
      },
    },
    {
      id: "stable", words: "stable at 0 hit points", family: ["refused:rules"],
      rule: `SRD 5.1, Stabilizing a Creature: "A stable creature doesn't make death saving throws, even though it has 0 hit points, but it does remain unconscious." ${INCAPACITATED}`,
      bars: (row) => acts(row, "reaction", "move", "free"),
      apply: (t, id) => t.world.patch(id, { currentHp: 0, conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 0, stable: true, dead: false } }),
    },
    {
      id: "asleep", words: "unconscious with hit points left (asleep)", family: ["refused:rules"],
      rule: `SRD 5.1, Unconscious: "An unconscious creature is incapacitated (see the condition), can't move or speak, and is unaware of its surroundings." ${INCAPACITATED}`,
      bars: (row) => acts(row, "reaction", "move"),
      apply: lay("unconscious"),
    },
    {
      id: "stunned", words: "stunned", family: ["refused:rules"],
      rule: `SRD 5.1, Stunned: "A stunned creature is incapacitated (see the condition), can't move, and can speak only falteringly." ${INCAPACITATED}`,
      bars: (row) => acts(row, "reaction", "move"),
      apply: lay("stunned"),
    },
    {
      id: "paralyzed", words: "paralyzed", family: ["refused:rules"],
      rule: `SRD 5.1, Paralyzed: "A paralyzed creature is incapacitated (see the condition) and can't move or speak." ${INCAPACITATED}`,
      bars: (row) => acts(row, "reaction", "move"),
      apply: lay("paralyzed"),
    },
    {
      id: "petrified", words: "petrified", family: ["refused:rules"],
      rule: `SRD 5.1, Petrified: "The creature is incapacitated (see the condition), can't move or speak, and is unaware of its surroundings." ${INCAPACITATED}`,
      bars: (row) => acts(row, "reaction", "move"),
      apply: lay("petrified"),
    },
    {
      id: "incapacitated", words: "incapacitated", family: ["refused:rules"],
      rule: `${INCAPACITATED} ${BONUS}`,
      // Bare incapacitation leaves speed (can-act.ts), so a walk is not barred.
      bars: (row) => acts(row, "reaction"),
      apply: lay("incapacitated"),
    },
    {
      id: "surprised", words: "surprised in round 1", family: ["refused:rules"],
      rule: "SRD 5.1, Surprise: \"If you're surprised, you can't move or take an action on your first turn of the combat, and you can't take a reaction until that turn ends.\"",
      bars: (row) => acts(row, "reaction", "move"),
      apply: (t, id) => {
        const encounter = t.world.encounter();
        assert.equal(encounter.round, 1, "the stage is in round 1");
        encounters.saveEncounter({ ...encounter, surprisedIds: [id] });
      },
    },
    {
      id: "not_turn", words: "not on their turn", family: ["refused:rules"], passFamily: ["refused:rules", "retry"],
      rule: "SRD 5.1, Your Turn: \"On your turn, you can move a distance up to your speed and take one action.\"",
      bars: (row) => acts(row, "move", "free", "pass", "undo"),
      apply: (t, id) => t.kit.giveTurn(ACTORS.map((key) => t[key]).find((sheet) => sheet.id !== id).id),
    },
    {
      id: "charmed_by_target", words: "charmed by the creature the act harms", family: ["refused:rules"],
      rule: "SRD 5.1, Charmed: \"A charmed creature can't attack the charmer or target the charmer with harmful abilities or magical effects.\"",
      bars: (row) => Boolean(row.harms) && row.kind !== "command",
      apply: lay("charmed", (t, row) => ({ sourceEnemyId: row.harms === "foe0" ? t.foes[0].id : t.foes[1].id })),
    },
    {
      id: "grappled", words: "grappled (speed 0)", family: ["refused:rules"],
      rule: "SRD 5.1, Grappled: \"A grappled creature's speed becomes 0, and it can't benefit from any bonus to its speed.\"",
      bars: (row) => row.kind === "move" && row.tool === "move_token",
      apply: lay("grappled", (t) => ({ sourceEnemyId: t.foes[0].id })),
    },
    {
      id: "restrained", words: "restrained (speed 0)", family: ["refused:rules"],
      rule: "SRD 5.1, Restrained: \"A restrained creature's speed becomes 0, and it can't benefit from any bonus to its speed.\"",
      bars: (row) => row.kind === "move" && row.tool === "move_token",
      apply: lay("restrained"),
    },
    {
      id: "away", words: "away from the fight", stage: "away", family: ["retry", "refused:rules"],
      rule: "A character the story has elsewhere takes no part in the fight: nothing reaches across its edge (start_encounter's absent, src/lib/dm/ai-gate.ts awayCall, issue 740).",
      // What reaches into the fight: its foes and its allies. What the absent
      // hero does where they are (mounting up, dropping a dagger) is theirs
      // to do, and a hit on someone who is not there cannot be staged.
      bars: (row) => row.kind !== "reaction" && Boolean(row.harms || row.reaches),
      apply: () => {},
    },
    {
      id: "held", words: "on a turn held while the enemies before them still act", stage: "held", family: ["retry", "refused:rules"],
      rule: "SRD 5.1, The Order of Combat: \"Each participant in the battle takes a turn in initiative order.\" A character whose turn the pointer rests on while the enemies grouped before them are still to act does not act first (src/lib/dm/held-turn.ts heldTurnRefusal).",
      bars: (row) => acts(row, "move", "free", "pass"),
      apply: () => {},
    },
  ];
  return STATES;
}
