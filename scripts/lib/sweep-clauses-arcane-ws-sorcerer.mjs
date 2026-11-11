// The sorcerer clause probes written in the fifth round of the arcane repair:
// the clauses the ledger had marked "not run" (read_only), each now staged and
// run, and the focused cases of the mechanisms that round built
// (scripts/clauses/arcane.json; run by test-enforce-sweep-clauses-arcane-sorcerer.mjs
// beside sweep-clauses-arcane-sorcerer.mjs, which keeps the probes
// it already had).
import assert from "node:assert/strict";

export function probes(rig, shared) {
  const { world, kit, holder, sheet, foe, counter, left, budget, show, call, spend, react, stage } = rig;
  const { friend } = shared;
  const shadow = () => holder("sorcerer", "Shadow Magic");
  const mind = () => holder("sorcerer", "Aberrant Mind");
  const points = (who) => left(who, "sorcery_points");
  const slotsUsed = (who) => Object.values(sheet(who).spellcasting.slots).map((slot) => slot.used).join("");
  const view = lazy(() => import("../../src/lib/battlemap/view.ts"));
  const pointsCast = lazy(() => import("../../src/lib/dm/ar-ws-points-cast.ts"));
  // What a call spent: [sorcery points, spell slots of every level as one word].
  async function paid(who, run) {
    const before = [points(who), slotsUsed(who)];
    const out = await run();
    return { out, cost: [before[0] - points(who), slotsUsed(who) === before[1] ? "no slot" : slotsUsed(who)] };
  }
  const knows = (who, ...spells) => {
    const casting = sheet(who).spellcasting;
    world.patch(who.id, { spellcasting: { ...casting, prepared: [...new Set([...casting.prepared, ...spells])], known: [...new Set([...casting.known, ...spells])] } });
  };

  const PROBES = {
    // "and when you do you can see through that darkness": a Darkness the
    // sorcery points paid for hides nothing from its caster, on an attack roll
    // and on their own board; one a slot paid for blinds them as it does
    // everybody (their darkvision does not pierce magical darkness).
    "eyes-see-through": async () => {
      const { buildPlayerMapView } = await view();
      const seen = {};
      for (const how of ["points", "slot"]) {
        const [enemy] = await stage(shadow(), { others: [friend()] });
        kit.place(friend().id, 1, 5);
        // 15 feet of darkness around (8, 5): the sorcerer at (5, 5), the dummy at (6, 5).
        const { out, cost } = await paid(shadow(), () => call("use_spell_slot", { characterId: shadow().id, spell: "Darkness", atX: 8, atY: 5, ...(how === "slot" ? { level: 2 } : {}) }));
        assert.equal(out.ok, true, out.error);
        kit.freshTurn();
        const swing = await kit.swing(shadow().id, enemy.id, [15, 3, 3]);
        assert.equal(swing.ok, true, swing.error);
        const board = kit.map();
        const mine = buildPlayerMapView(world.campaignId, sheet(shadow()).userId);
        const theirs = buildPlayerMapView(world.campaignId, sheet(friend()).userId);
        const inside = 5 * board.width + 9;
        seen[how] = {
          cost,
          attackerBlind: (swing.result.conditionEffects ?? []).some((line) => line.startsWith(`${sheet(shadow()).name} cannot see`)),
          casterSeesIn: mine.visible.includes(inside),
          friendSeesIn: theirs.visible.includes(inside),
        };
      }
      assert.deepEqual(seen, {
        points: { cost: [2, "no slot"], attackerBlind: false, casterSeesIn: true, friendSeesIn: false },
        slot: { cost: [0, "010000000"], attackerBlind: true, casterSeesIn: false, friendSeesIn: false },
      });
    },
    // "with no verbal, somatic or costly components": a psionic spell the
    // caster cannot speak, gesture or pay the material for is cast for the
    // points all the same, with slots still at hand; any other spell is
    // refused as it always was.
    "psionic-bare": async () => {
      const [enemy] = await stage(mind());
      knows(mind(), "Magic Missile");
      world.patch(mind().id, { conditions: ["silenced"] });
      const whispers = await paid(mind(), () => call("cast_at_enemy", { characterId: mind().id, targetEnemyId: enemy.id, spell: "Dissonant Whispers" }, [1, 3, 3, 3]));
      assert.equal(whispers.out.ok, true, `silenced, Dissonant Whispers (verbal): ${String(whispers.out.error).slice(0, 160)}`);
      assert.deepEqual(whispers.cost, [1, "no slot"], "[sorcery points, slots] a silenced casting of a 1st-level psionic spell costs");
      kit.freshTurn();
      const missile = await paid(mind(), () => call("cast_at_enemy", { characterId: mind().id, targetEnemyId: enemy.id, spell: "Magic Missile" }, [1, 1, 1]));
      assert.equal(missile.out.ok, false, "silenced, Magic Missile is no psionic spell");
      assert.deepEqual(missile.cost, [0, "no slot"]);
      // Both hands full: Arms of Hadar's gestures cannot be made.
      world.patch(mind().id, { conditions: [], equipment: [{ name: "Dagger", qty: 1, equipped: true }, { name: "Shortsword", qty: 1, equipped: true }] });
      kit.freshTurn();
      const arms = await paid(mind(), () => call("aoe_damage", { casterCharacterId: mind().id, spell: "Arms of Hadar", enemyIds: [enemy.id] }, [1, 2, 2]));
      world.patch(mind().id, { equipment: [] });
      assert.equal(arms.out.ok, true, `both hands full, Arms of Hadar (somatic): ${String(arms.out.error).slice(0, 160)}`);
      assert.deepEqual(arms.cost, [1, "no slot"]);
      // The costly material: Summon Aberration (400 gp) is the one psionic
      // spell with a price, and no cast tool summons its creature yet (the
      // server holds no row for it), so this half is asked of the rule the
      // cast door reads: with no 400 gp at hand the points pay, and the spell
      // they pay for asks for no material.
      const [rule, content] = [await pointsCast(), await import("../../src/lib/content/index.ts")];
      world.patch(mind().id, { gold: 0, copper: 0 });
      const facts = content.spellFactsFor("Summon Aberration", []);
      const offer = rule.pointsOfferFor(sheet(mind()), "Summon Aberration", facts, undefined);
      assert.deepEqual([offer?.points, offer?.bare], [4, true], "[points, cast bare] for Summon Aberration");
      assert.equal(rule.pointsPayFirst(world.campaignId, sheet(mind()), offer, { facts, problem: null }, { inFight: true }), true, "with no 400 gp material, the points pay");
      assert.deepEqual([rule.bareFacts(facts).material, rule.bareFacts(facts).materialCostGp], [false, null]);
      const whisper = content.spellFactsFor("Dissonant Whispers", []);
      assert.equal(rule.pointsPayFirst(world.campaignId, sheet(mind()), rule.pointsOfferFor(sheet(mind()), "Dissonant Whispers", whisper, undefined), { facts: whisper, problem: null }, { inFight: true }), false, "nothing shut: the slot pays");
    },
    // "It fails against radiant damage or a critical hit": a natural 20 that
    // drops the sorcerer rolls no Charisma save and leaves the use; the same
    // club on a 19 is answered by the save (src/lib/dm/pc-damage.ts).
    "grave-crit": async () => {
      const blow = async (faces) => {
        const [enemy] = await stage(shadow(), { others: [friend()], first: friend() });
        world.patch(shadow().id, { currentHp: 4 });
        kit.freshRound();
        const out = await call("enemy_attack", { enemyId: enemy.id, targetCharacterId: shadow().id }, faces);
        assert.equal(out.ok, true, out.error);
        const seen = { hp: sheet(shadow()).currentHp, used: counter(shadow(), "sub_strength_of_the_grave").used, d20s: out.rolled.filter((die) => die.sides === 20).length, crit: Boolean(out.result.crit ?? out.result.critical) };
        rig.refill(shadow());
        return seen;
      };
      // The dummy's club, 1d6 + 2. A critical hit doubles the die: 3 + 3 + 2.
      const crit = await blow([20, 3, 3, 20]);
      assert.deepEqual([crit.hp, crit.used, crit.d20s], [0, 0, 1], "[hit points, uses spent, d20s thrown] after a critical hit dropped the sorcerer: no save is rolled");
      // No critical: 3 + 2 damage is DC 10, and a 20 on the save holds them at 1.
      const plain = await blow([19, 3, 20]);
      assert.deepEqual([plain.hp, plain.used, plain.d20s], [1, 1, 2], "[hit points, uses spent, d20s thrown] after the same club on a 19");
    },
    // "and the ability to move through creatures and objects": in shadow form
    // the sorcerer's own walk (the board's move route) passes a hostile
    // creature of their own size and an object on the board, each at double
    // cost, and ends inside neither (src/lib/dm/ar-ws-umbral-logic.ts, read by
    // battlemap/passage.ts pcMoveTraits).
    "umbral-through": async () => {
      const maps = await import("../../src/lib/db/battle-maps.ts");
      const moveRoute = await world.route("campaigns/[campaignId]/battle-map/move");
      const walk = async (x, y) => {
        world.signIn({ id: sheet(shadow()).userId });
        // The dummy's opportunity attack, when the walk draws one, misses on a 1.
        world.clearDice();
        world.dice(1, 1);
        const response = await moveRoute.POST(
          new Request(`http://odm.test/api/campaigns/${world.campaignId}/battle-map/move`, { method: "POST", body: JSON.stringify({ x, y }) }),
          { params: Promise.resolve({ campaignId: world.campaignId }) },
        );
        world.clearDice();
        const at = kit.token(shadow().id);
        return { status: response.status, at: [at.x, at.y], spent: at.movedThisRound };
      };
      // A cell four squares long and one high, walled all round: the sorcerer
      // at (5, 5), a hostile dummy at (6, 5), a statue at (7, 5), floor at (8, 5).
      const cell = async () => {
        await stage(shadow());
        kit.openField([...[4, 5, 6, 7, 8, 9].flatMap((x) => [[x, 4, "#"], [x, 6, "#"]]), [4, 5, "#"], [9, 5, "#"]]);
        maps.insertToken({ mapId: kit.map().id, campaignId: world.campaignId, kind: "prop", refId: "statue", name: "Statue", x: 7, y: 5 });
      };
      await cell();
      const plain = await walk(8, 5);
      assert.deepEqual([plain.at, plain.spent], [[5, 5], 0], "[square, squares spent] with no shadow form: the creature and the statue stand in the way");
      await cell();
      const formed = await spend(shadow(), "Umbral Form");
      assert.equal(formed.ok, true, formed.error);
      assert.deepEqual((await walk(6, 5)).at, [5, 5], "in shadow form, a walk that would end inside the creature");
      assert.deepEqual((await walk(7, 5)).at, [5, 5], "in shadow form, a walk that would end inside the statue");
      const through = await walk(8, 5);
      assert.deepEqual([through.status, through.at, through.spent], [200, [8, 5], 5], "[status, square, squares spent] in shadow form: through the creature and the statue, each as difficult terrain (2 + 2 + 1)");
      // A wall is the building, no object: it stops the shadow too.
      assert.deepEqual((await walk(10, 5)).at, [8, 5], "in shadow form, a walk through the cell's wall");
      rig.refill(shadow());
    },
  };
  const KNOWN = {};
  return { PROBES, KNOWN };
}

// A module loaded on first use and kept.
function lazy(load) {
  let seen = null;
  return () => (seen ??= load());
}
