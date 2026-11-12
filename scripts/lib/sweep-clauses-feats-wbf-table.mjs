// The feat clauses the ledger once held by a helper call, read where a table
// meets them: a tool call or the move route through a harness world, once for
// a holder of the feat and once for a character without it. A helper that
// answers right while its engine door never calls it fails here
// (scripts/clauses/feats.json; run by test-enforce-sweep-clauses-feats.mjs).
import { assert } from "./sweep-clauses-srd-rig.mjs";

export const worn = (...names) => names.map((name) => ({ name, qty: 1, equipped: true }));
export const d20s = (out) => (out.rolled ?? []).filter((die) => die.sides === 20).length;

// A 9th-level wizard's block for a dummy that casts (spell save DC 14).
const BLOCK = "The goblin is a 9th-level spellcaster. Its spellcasting ability is Intelligence (spell save DC 14, +6 to hit with spell attacks). It has the following wizard spells prepared:\nCantrips (at will): fire bolt\n1st level (4 slots): magic missile, burning hands\n3rd level (3 slots): fireball, counterspell";

export function tableKit(rig) {
  // The player's own move on the board (the route the map's drag posts to).
  async function walk(t, who, body) {
    t.world.signIn({ id: t.sheet(who).userId });
    const route = await t.world.route("campaigns/[campaignId]/battle-map/move");
    const res = await route.POST(
      new Request(`http://odm.test/api/campaigns/${t.world.campaignId}/battle-map/move`, { method: "POST", body: JSON.stringify(body) }),
      { params: Promise.resolve({ campaignId: t.world.campaignId }) },
    );
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  // One staging run twice, each on its own table: a character without the
  // feat ("plain") and its holder. Answers what each run returned.
  async function each(feat, build, run) {
    const seen = {};
    for (const [label, feats] of [["plain", []], ["holder", [feat]]]) {
      const t = await rig.table();
      const hero = t.hero({ class: "fighter", level: 4, ...build, feats });
      seen[label] = await run(t, hero, label);
    }
    return seen;
  }
  async function mage(t, enemy) {
    const spellcasting = await import("../../src/lib/dm/monster-spellcasting.ts");
    t.kit.setEnemy(enemy.id, { stats: { ...t.enemy(enemy).stats, spellcasting: spellcasting.parseSpellcasting(BLOCK, "Spellcasting"), traits: [`Spellcasting: ${BLOCK}`] } });
  }
  return { walk, each, mage };
}

export function tableProbes(rig, P) {
  const { walk, each, mage } = tableKit(rig);

  // Thirty feet of speed is 6 squares. Prone, five squares away: standing
  // costs half the speed (3) and leaves 3, an Athlete's stand costs 1.
  P["feat.athlete.stand.table"] = async () => {
    const seen = await each("Athlete", {}, async (t, hero) => {
      const [foe] = await t.fight([hero]);
      t.kit.place(foe.id, 17, 12);
      t.patch(hero, { conditions: ["prone"] });
      const stood = await t.invoke("take_action", { characterId: hero.id, action: "stand" });
      const out = await walk(t, hero, { x: 10, y: 5 });
      return { stood: stood.ok, status: out.status, moved: t.kit.token(hero.id).movedThisRound };
    });
    assert.ok(seen.plain.status >= 400, `a prone fighter stood and walked 25 feet on 30 feet of speed: ${JSON.stringify(seen)}`);
    assert.deepEqual([seen.holder.status, seen.holder.moved], [200, 6], `an Athlete stands for 5 feet and walks 25: ${JSON.stringify(seen)}`);
  };

  // The coat's poison against a creature that resists poison: a Poisoner's
  // 2d8 (4 + 4) lands whole, the vial's own 1d4 (a 4) is halved.
  P["feat.poisoner.resistance.table"] = async () => {
    const seen = await each("Poisoner", { equipment: [...worn("Longsword"), { name: "Poison, basic (vial)", qty: 1 }] }, async (t, hero) => {
      const [foe] = await t.fight([hero], { foe: { resist: "poison" } });
      const coat = await t.invoke("use_item", { characterId: hero.id, item: "Poison, basic (vial)" });
      assert.equal(coat.ok, true, coat.error);
      t.freshTurn();
      const before = t.enemy(foe).currentHp;
      const swing = await t.swing(hero, foe, [15, 4, 1, 4, 4]);
      assert.equal(swing.ok, true, swing.error);
      // Less the longsword's own 4 + 3.
      return before - t.enemy(foe).currentHp - 7;
    });
    assert.deepEqual(seen, { plain: 2, holder: 8 }, `poison damage to a creature resisting poison: ${JSON.stringify(seen)}`);
  };

  // Another creature in the line gives the target half cover (+2 AC): a 15
  // against AC 13 + 2 hits only for the shooter who ignores it.
  P["feat.sharpshooter.cover.table"] = async () => {
    const seen = await each("Sharpshooter", { equipment: worn("Longbow", "Arrows") }, async (t, hero) => {
      const [screen, target] = await t.fight([hero], { foes: 2 });
      t.kit.place(screen.id, 8, 5);
      t.kit.place(target.id, 11, 5);
      const before = t.enemy(target).currentHp;
      // +2 Dexterity and +2 proficiency: a 10 on the die is 14.
      const shot = await t.swing(hero, target, [10, 4], { weapon: "Longbow" });
      assert.equal(shot.ok, true, shot.error);
      return before - t.enemy(target).currentHp > 0;
    });
    assert.deepEqual(seen, { plain: false, holder: true }, "a 14 against a creature of AC 13 behind half cover hits");
  };

  // The caster stands beside the character: the save against its spell is
  // thrown twice by a Mage Slayer.
  P["feat.mage-slayer.save.table"] = async () => {
    const seen = await each("Mage Slayer", {}, async (t, hero) => {
      const [foe] = await t.fight([hero]);
      await mage(t, foe);
      t.foesTurn(foe);
      const out = await t.invoke("cast_at_player", { characterId: hero.id, casterEnemyId: foe.id, spell: "Burning Hands" }, [15, 15, 3, 3, 3]);
      assert.equal(out.ok, true, out.error);
      return d20s(out);
    });
    assert.deepEqual(seen, { plain: 1, holder: 2 }, "d20s for the save against an adjacent caster's Burning Hands");
  };

  // A creature walking into a glaive's 10 feet: the Polearm Master swings.
  P["feat.polearm-master.enter.table"] = async () => {
    const seen = await each("Polearm Master", { equipment: worn("Glaive") }, async (t, hero) => {
      const [foe] = await t.fight([hero]);
      t.kit.place(foe.id, 10, 5);
      t.foesTurn(foe);
      const out = await t.invoke("move_token", { token: foe.id, x: 7, y: 5 }, [15, 4]);
      assert.equal(out.ok, true, out.error);
      return d20s(out);
    });
    assert.deepEqual(seen, { plain: 0, holder: 1 }, "opportunity attacks as a creature enters the glaive's reach");
  };

  // After the Attack action a shield in hand shoves as the bonus action.
  P["feat.shield-master.shove.table"] = async () => {
    const seen = await each("Shield Master", { equipment: worn("Longsword", "Shield") }, async (t, hero) => {
      const [foe] = await t.fight([hero]);
      const early = await t.act(hero, "shove", { targetEnemyId: foe.id, bonus: true }, [15, 5]);
      const earlyBonus = t.budget()?.bonusUsed === true;
      t.freshTurn();
      const swing = await t.swing(hero, foe, [15, 4]);
      assert.equal(swing.ok, true, swing.error);
      const shove = await t.act(hero, "shove", { targetEnemyId: foe.id, bonus: true }, [15, 5]);
      return { early: early.ok && earlyBonus, shove: shove.ok, bonus: t.budget()?.bonusUsed === true };
    });
    assert.deepEqual(seen.plain, { early: false, shove: false, bonus: false }, `with no feat a shove is never a bonus action: ${JSON.stringify(seen)}`);
    assert.deepEqual(seen.holder, { early: false, shove: true, bonus: true }, `Shield Master's shove follows the Attack action as a bonus action: ${JSON.stringify(seen)}`);
  };

  // After a Dash (the action), the shove or one melee attack is the bonus action.
  P["feat.charger.shove.table"] = async () => {
    for (const how of ["shove", "attack"]) {
      const seen = await each("Charger", { equipment: worn("Longsword") }, async (t, hero) => {
        const [foe] = await t.fight([hero]);
        const act = () =>
          how === "shove"
            ? t.act(hero, "shove", { targetEnemyId: foe.id, bonus: true }, [15, 5])
            : t.invoke("pc_attack", { characterId: hero.id, targetEnemyId: foe.id, weapon: "Longsword", feature: "Charger" }, [15, 4]);
        const dash = await t.act(hero, "dash");
        assert.equal(dash.ok, true, dash.error);
        const out = await act();
        return { ok: out.ok, bonus: t.budget()?.bonusUsed === true };
      });
      assert.deepEqual(seen, { plain: { ok: false, bonus: false }, holder: { ok: true, bonus: true } }, `the ${how} after a Dash: ${JSON.stringify(seen)}`);
    }
    // With no Dash the feat opens nothing.
    const t = await rig.table();
    const hero = t.hero({ class: "fighter", level: 4, equipment: worn("Longsword"), feats: ["Charger"] });
    const [foe] = await t.fight([hero]);
    const out = await t.invoke("pc_attack", { characterId: hero.id, targetEnemyId: foe.id, weapon: "Longsword", feature: "Charger" }, [15, 4]);
    assert.equal(out.ok, false, "Charger's attack with no Dash");
  };

  // A Hit Die that shows 1 with Constitution 14 (+2): 3 hit points, and a
  // Durable character's least is twice the modifier, 4.
  P["feat.durable.floor.table"] = async () => {
    const seen = await each("Durable", {}, async (t, hero) => {
      await t.kit.endFight();
      t.patch(hero, { currentHp: 10 });
      const out = await t.invoke("take_rest", { kind: "short", spend: [{ characterId: hero.id, dice: 1 }] }, [1]);
      assert.equal(out.ok, true, out.error);
      return t.sheet(hero).currentHp - 10;
    });
    assert.deepEqual(seen, { plain: 3, holder: 4 }, "hit points from one Hit Die showing 1");
  };

  // In dim light, in plain view of a creature without darkvision: only a
  // Skulker may try to hide.
  P["feat.skulker.hide.table"] = async () => {
    const { getDatabase } = await import("../../src/lib/db/core.ts");
    const seen = await each("Skulker", {}, async (t, hero) => {
      const [foe] = await t.fight([hero]);
      getDatabase().prepare("UPDATE battle_maps SET ambient = 'dim', outdoors = 0 WHERE id = ?").run(t.kit.map().id);
      t.kit.place(foe.id, 9, 5);
      const out = await t.act(hero, "hide", {}, [15]);
      return out.ok;
    });
    assert.deepEqual(seen, { plain: false, holder: true }, "the Hide action in dim light, in the open");
  };

  // The hand crossbow's bonus shot follows an attack with a one-handed weapon.
  P["feat.crossbow-expert.bonus.table"] = async () => {
    const seen = await each("Crossbow Expert", { equipment: worn("Shortsword", "Hand Crossbow", "Crossbow Bolts") }, async (t, hero) => {
      const [foe] = await t.fight([hero]);
      const shot = () => t.invoke("pc_attack", { characterId: hero.id, targetEnemyId: foe.id, weapon: "Hand Crossbow", feature: "Crossbow Expert" }, [15, 4]);
      const early = await shot();
      t.freshTurn();
      const swing = await t.swing(hero, foe, [15, 4], { weapon: "Shortsword" });
      assert.equal(swing.ok, true, swing.error);
      const bonus = await shot();
      return { early: early.ok, bonus: bonus.ok, spent: t.budget()?.bonusUsed === true };
    });
    assert.deepEqual(seen, { plain: { early: false, bonus: false, spent: false }, holder: { early: false, bonus: true, spent: true } }, "the hand crossbow as a bonus action");
  };
}
