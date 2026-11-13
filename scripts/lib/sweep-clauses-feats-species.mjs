// The clause ledger's probes for three species feats whose effects ride the
// fight's own doors (scripts/test-enforce-sweep-clauses-feats.mjs lists their
// ids, since the ledger's check reads that file's text for a probe's name):
// Flames of Phlegethos on a fire spell, Orcish Fury on a hit and after
// Relentless Endurance, Bountiful Luck on an ally's natural 1.
import { assert } from "./sweep-clauses-srd-rig.mjs";

export const SPECIES_PROBES = [
  "feat.flames-of-phlegethos.reroll", "feat.flames-of-phlegethos.wreathe", "feat.flames-of-phlegethos.burn",
];

export function speciesProbes(rig, P) {
  // A tiefling wizard's Fire Bolt (1d10 at level 4) whose damage die lands on
  // a 1: with the feat the 1 is rolled again and the 7 deals the damage.
  const fireBolt = async (feats) => {
    const t = await rig.table();
    const who = t.hero({ class: "wizard", level: 4, race: "tiefling", spells: [], cantrips: ["Fire Bolt"], feats, abilities: { int: 16 } });
    const [foe] = await t.fight([who]);
    // 20 feet off, so the shot is not at disadvantage.
    t.kit.place(foe.id, 9, 5);
    const before = t.enemy(foe).currentHp;
    const out = await t.invoke("pc_attack", { characterId: who.id, targetEnemyId: foe.id, spell: "Fire Bolt" }, [15, 1, 7]);
    assert.equal(out.ok, true, out.error);
    return { t, who, foe, dealt: before - t.enemy(foe).currentHp };
  };

  P["feat.flames-of-phlegethos.reroll"] = async () => {
    const plain = await fireBolt([]);
    const flames = await fireBolt(["Flames of Phlegethos"]);
    assert.deepEqual({ plain: plain.dealt, flames: flames.dealt }, { plain: 1, flames: 7 }, "Fire Bolt's damage die on a 1, then a 7");
  };

  P["feat.flames-of-phlegethos.wreathe"] = async () => {
    const plain = await fireBolt([]);
    const flames = await fireBolt(["Flames of Phlegethos"]);
    assert.equal(plain.t.has(plain.who, "flames of phlegethos"), false, "a tiefling without the feat was wreathed");
    assert.equal(flames.t.has(flames.who, "flames of phlegethos"), true, `conditions: ${flames.t.sheet(flames.who).conditions.join(", ")}`);
    const meta = flames.t.sheet(flames.who).conditionMeta?.["flames of phlegethos"];
    assert.equal(meta?.untilTurnEndOf, flames.who.id, `the flames last until the end of the caster's next turn: ${JSON.stringify(meta)}`);
    assert.notEqual(meta?.turnBegun, true, "the flames ended with the turn they were cast on");
  };

  P["feat.flames-of-phlegethos.burn"] = async () => {
    const burned = {};
    for (const [label, feats] of [["plain", []], ["flames", ["Flames of Phlegethos"]]]) {
      const { t, who, foe } = await fireBolt(feats);
      t.kit.place(foe.id, 6, 5);
      t.foesTurn(foe);
      const before = t.enemy(foe).currentHp;
      const hit = await t.strike(foe, who, [16, 4, 3]);
      assert.equal(hit.ok, true, hit.error);
      burned[label] = before - t.enemy(foe).currentHp;
    }
    assert.deepEqual(burned, { plain: 0, flames: 3 }, "fire dealt to the dummy whose club hit the caster (a 3 on the d4)");
  };
}
