// The sorcerer clause probes written in the fifth round of the arcane repair,
// for the spell lists and their level-up swaps, and Revelation in Flesh: the clauses the ledger had marked "not run" (read_only), each
// now staged and run, and the focused cases of the mechanisms that round built
// (scripts/clauses/arcane.json; run by test-enforce-sweep-clauses-arcane-sorcerer.mjs).
// The probes a clause already had stay in the file that held them.
import assert from "node:assert/strict";
import { MOD, prof } from "./sweep-clauses-arcane.mjs";
import { call as callRoute } from "./enforce-campaign.mjs";

export function probes(rig) {
  const { world, kit, holder, sheet, foe, left, budget, call, spend, stage } = rig;
  const mind = () => holder("sorcerer", "Aberrant Mind");
  const d20s = (out) => out.rolled.filter((die) => die.sides === 20).length;
  const moved = (who) => kit.token(who.id).movedThisRound;
  const held = (who, name) => sheet(who).conditions.includes(name);

  // ---- the level-up door, as a player's own request reaches it ----
  const routes = lazy(async () => ({
    sheet: await world.route("campaigns/[campaignId]/sheet"),
    offer: await world.route("campaigns/[campaignId]/sheet/level-up"),
    content: await import("../../src/lib/content/index.ts"),
    prep: await import("../../src/lib/srd/spell-prep.ts"),
  }));
  const url = (tail = "") => `http://test/api/campaigns/${world.campaignId}/sheet${tail}`;
  // A sorcerer of an origin at a level below 20, with the experience for the
  // next: [the class's own spells known, ...].
  const grower = (origin, level, spells, extra = {}) => {
    const who = holder("sorcerer", origin, level, { spells, cantrips: ["Fire Bolt"], ...extra }, "grows");
    world.patch(who.id, { xp: 355000 });
    return who;
  };
  async function offered(who) {
    const { offer } = await routes();
    world.signIn({ id: sheet(who).userId });
    return callRoute(offer, "GET", undefined, { campaignId: world.campaignId }, url(`/level-up?characterId=${who.id}`));
  }
  // The next level, with the spells named and the one given up.
  async function levelUp(who, body) {
    const { sheet: route } = await routes();
    world.signIn({ id: sheet(who).userId });
    return callRoute(route, "PATCH", { characterId: who.id, level: sheet(who).level + 1, ...body }, { campaignId: world.campaignId }, url());
  }
  const knows = (who, name) => sheet(who).spellcasting.known.includes(name);
  // The spells the origin gives free of the count, as every reader of the
  // sheet takes them (spell-prep.ts grantedSpellsOf).
  async function granted(who) {
    const { prep } = await routes();
    const now = sheet(who);
    return prep.casterViewsOf(now).flatMap((view) => prep.grantedSpellsOf(view));
  }
  // What the tables say is wrong with the sheet's lists now: nothing, when
  // the spell swapped in is counted as the origin's own.
  async function listProblems(who) {
    const { prep } = await routes();
    return prep.spellListProblems(sheet(who), { freeCantripCount: 0 });
  }

  const PROBES = {
    // ---- Aberrant Mind: Revelation in Flesh
    // "you see any invisible creature within 60 feet that isn't behind total
    // cover": the sorcerer's shot at an invisible creature 15 feet off is one
    // d20 and the creature is one they can see; at 65 feet, and behind a
    // wall, it is unseen as before. Without the form every one is unseen.
    "revelation-see": async () => {
      const who = holder("sorcerer", "Aberrant Mind", 20, { equipment: [{ name: "Shortbow", qty: 1, equipped: true }, { name: "Arrows", qty: 20 }] }, "sees");
      const seen = {};
      for (const form of [false, true]) {
        const [near, far, walled] = await stage(who, { count: 3 });
        const board = kit.map();
        assert.ok(board.width >= 16 && board.height >= 6, `the board is ${board.width}x${board.height}`);
        // A wall across the whole board at y = 3: the creature south of it has total cover.
        kit.openField(Array.from({ length: board.width }, (_, x) => [x, 3, "#"]));
        kit.place(who.id, 1, 1);
        kit.place(near.id, 4, 1);
        kit.place(far.id, 14, 1);
        kit.place(walled.id, 1, 5);
        if (form) {
          const on = await spend(who, "Revelation in Flesh", { variant: "see", amount: 1 });
          assert.equal(on.ok, true, on.error);
          assert.ok(held(who, "revelation in flesh (see)"));
        }
        for (const enemy of [near, far, walled]) kit.setEnemy(enemy.id, { conditions: ["invisible"] });
        const view = rig.table.view(who);
        const shot = {};
        for (const [name, enemy] of [["near", near], ["far", far], ["walled", walled]]) {
          kit.freshTurn();
          const out = await call("pc_attack", { characterId: who.id, targetEnemyId: enemy.id, weapon: "Shortbow" }, [15, 15, 3]);
          shot[name] = out.ok ? d20s(out) : "refused";
        }
        seen[form ? "form" : "plain"] = {
          shot,
          unseen: [near, far, walled].map((enemy) => view.sight?.[enemy.id]?.unseen ?? null),
          reaches: [near, far, walled].map((enemy) => view.edges?.[enemy.id]?.senses?.attacker?.invisible ?? false),
        };
        kit.openField();
      }
      const name = (at) => `${foe(world.enemies()[at]).displayName} is invisible`;
      assert.deepEqual(seen.plain.unseen, [name(0), name(1), name(2)], "without the form, each invisible creature is unseen");
      assert.equal(seen.plain.shot.near, 2, "d20s for a shot at an invisible creature 15 feet off, without the form");
      assert.deepEqual([seen.form.shot.near, seen.form.unseen[0], seen.form.reaches[0]], [1, null, true], "[d20s, why unseen, the Hand's edge] at 15 feet, in the form");
      assert.deepEqual([seen.form.shot.far, seen.form.unseen[1], seen.form.reaches[1]], [2, name(1), false], "[d20s, why unseen, the Hand's edge] at 65 feet, in the form");
      assert.notEqual(seen.form.shot.walled, 1, "a shot at the creature behind the wall is refused or rolled unseen");
      assert.deepEqual([seen.form.unseen[2], seen.form.reaches[2]], [name(2), false], "[why unseen, the Hand's edge] behind total cover, in the form");
    },
    // "spend 5 feet of movement to escape nonmagical restraints or a grapple":
    // in the form, take_action escape frees a grappled sorcerer for 5 feet of
    // movement with the action already spent and no die thrown, and a netted
    // one the same; a spell's restraint, and a turn with no movement left,
    // get the ordinary escape (the action and its check) and no slip.
    "revelation-squeeze": async () => {
      const who = mind();
      const [enemy] = await stage(who);
      const grab = () => world.patch(who.id, { conditions: [...sheet(who).conditions.filter((name) => name !== "grappled"), "grappled"], conditionMeta: { ...sheet(who).conditionMeta, grappled: { source: enemy.id, escapeDc: 13 } } });
      const bind = (meta) => world.patch(who.id, { conditions: [...sheet(who).conditions.filter((name) => name !== "restrained"), "restrained"], conditionMeta: { ...sheet(who).conditionMeta, restrained: meta } });
      const escape = (faces = []) => call("take_action", { characterId: who.id, action: "escape" }, faces);
      const acted = await call("take_action", { characterId: who.id, action: "dodge" });
      assert.equal(acted.ok, true, acted.error);
      // Without the form: the action is spent, so there is no escape.
      grab();
      const plain = await escape([20]);
      assert.deepEqual([plain.ok, held(who, "grappled")], [false, true], "[escape taken, still grappled] with the action spent and no form");
      const points = left(who, "sorcery_points");
      const on = await spend(who, "Revelation in Flesh", { variant: "squeeze", amount: 1 });
      assert.equal(on.ok, true, on.error);
      assert.equal(points - left(who, "sorcery_points"), 1);
      // The Hand deals the slip as a free card with the action spent.
      const card = rig.table.deriveHand(sheet(who), { ...rig.table.FRESH_TURN, myTurn: true, actionUsed: true, bonusUsed: true }, {}).find((entry) => entry.id === "basic:escape");
      assert.deepEqual([card?.cost, card?.disabled, card?.roll], ["free", null, "no roll"], "[cost, shut, roll] of the Escape card in the form, the action spent");
      const before = moved(who);
      const slip = await escape([1]);
      assert.equal(slip.ok, true, slip.error);
      assert.deepEqual(
        [slip.result.success, held(who, "grappled"), moved(who) - before, d20s(slip), slip.unused, budget().actionUsed],
        [true, false, 1, 0, 1, true],
        "[freed, still grappled, squares of movement charged, d20s thrown, forced faces unused, the action still spent] for the slip",
      );
      // A net is no spell's: the same slip, 5 feet more.
      bind({ source: "net" });
      const net = await escape([1]);
      assert.equal(net.ok, true, net.error);
      assert.deepEqual([held(who, "restrained"), moved(who) - before, d20s(net)], [false, 2, 0], "[still restrained, squares charged in all, d20s] out of a net");
      // A spell's restraint is not slipped: with the action spent there is no
      // escape, and with it in hand the escape is the spell's own check.
      bind({ spell: "Web", source: who.id });
      const webbed = await escape([20]);
      assert.deepEqual([webbed.ok, held(who, "restrained"), moved(who) - before], [false, true, 2], "[escape taken, still restrained, squares charged] in a Web with the action spent");
      kit.freshTurn();
      const strained = await escape([1]);
      assert.equal(strained.ok, true, strained.error);
      assert.deepEqual(
        [strained.result.success, held(who, "restrained"), moved(who) - before, d20s(strained), budget().actionUsed],
        [false, true, 2, 1, true],
        "[freed, still restrained, squares charged, d20s, the action spent] against a Web with the action in hand",
      );
      assert.match(String(strained.result.revelationInFlesh), /a spell's/);
      // No movement left: the grapple is escaped the ordinary way or not at all.
      world.patch(who.id, { conditions: sheet(who).conditions.filter((name) => name !== "restrained") });
      grab();
      kit.place(who.id, 5, 5, 6);
      kit.freshTurn();
      const spent = await escape([1]);
      assert.equal(spent.ok, true, spent.error);
      assert.deepEqual(
        [spent.result.success, held(who, "grappled"), moved(who), d20s(spent), budget().actionUsed],
        [false, true, 6, 1, true],
        "[freed, still grappled, squares moved, d20s, the action spent] with all 30 feet walked: a 1 against the escape DC of 13",
      );
      assert.match(String(spent.result.revelationInFlesh), /none left this turn/);
      kit.place(who.id, 5, 5);
      rig.refill(who);
    },
  };
  const KNOWN = {};
  void [MOD, prof, offered, levelUp, knows, granted, listProblems, grower];
  return { PROBES, KNOWN };
}

// A module loaded on first use and kept.
function lazy(load) {
  let seen = null;
  return () => (seen ??= load());
}
