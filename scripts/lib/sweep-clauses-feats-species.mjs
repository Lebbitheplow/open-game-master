// The clause ledger's probes for three species feats whose effects ride the
// fight's own doors (scripts/test-enforce-sweep-clauses-feats.mjs lists their
// ids, since the ledger's check reads that file's text for a probe's name):
// Flames of Phlegethos on a fire spell, Orcish Fury on a hit and after
// Relentless Endurance, Bountiful Luck on an ally's natural 1.
import { assert } from "./sweep-clauses-srd-rig.mjs";
import { call } from "./enforce-campaign.mjs";

export const SPECIES_PROBES = [
  "feat.flames-of-phlegethos.reroll", "feat.flames-of-phlegethos.wreathe", "feat.flames-of-phlegethos.burn",
  "feat.orcish-fury.die", "feat.orcish-fury.rest", "feat.orcish-fury.strike",
  "feat.bountiful-luck.reroll", "feat.bountiful-luck.lucky",
];

const worn = (...names) => names.map((name) => ({ name, qty: 1, equipped: true }));

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

  // A half-orc fighter's longsword hit (1d8 + 3) waits on its card, which
  // offers Orcish Fury; chosen, the weapon's d8 is rolled once more.
  const furyHit = async (feats) => {
    const t = await rig.table({ gameSettings: { dicePolicy: "real_allowed" } });
    const who = t.hero({ class: "fighter", level: 4, race: "half_orc", feats, equipment: worn("Longsword") });
    const [foe] = await t.fight([who]);
    const { listOpenPendingRolls } = await import("../../src/lib/db/dm-turns.ts");
    const route = await t.world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");
    const swing = async () => {
      await t.swing(who, foe, [15], { weapon: "Longsword" });
      const [pending] = listOpenPendingRolls(t.world.campaignId);
      return { pending, offered: (pending?.thrown?.options ?? []).map((option) => option.id) };
    };
    const choose = async (pending, use, ...faces) => {
      t.world.signIn({ id: t.sheet(who).userId });
      t.world.dice(...faces);
      const out = await call(route, "POST", { use }, { campaignId: t.world.campaignId, pendingRollId: pending.id });
      t.world.clearDice();
      return out;
    };
    return { t, who, foe, swing, choose };
  };

  P["feat.orcish-fury.die"] = async () => {
    const plain = await furyHit([]);
    assert.equal((await plain.swing()).offered.includes("orcish_fury"), false, "a half-orc without the feat was offered Orcish Fury");
    const { t, who, foe, swing, choose } = await furyHit(["Orcish Fury"]);
    assert.deepEqual(t.sheet(who).resources.feat_orcish_fury, { max: 1, used: 0 }, "the use");
    const { pending, offered } = await swing();
    assert.ok(offered.includes("orcish_fury"), `the hit's card offered ${JSON.stringify(offered)}`);
    const before = t.enemy(foe).currentHp;
    const out = await choose(pending, "orcish_fury", 5, 6);
    assert.equal(out.status, 200, JSON.stringify(out.json));
    assert.equal(before - t.enemy(foe).currentHp, 5 + 3 + 6, "the longsword's 5 + 3, and the fury's d8 of 6");
    assert.equal(t.used(who, "feat_orcish_fury"), 1);
    // A seat an agent plays (or a companion) has no card: a bare use_resource
    // adds the die to its latest weapon hit this turn (orcish-fury.ts), and
    // before one lands it is refused with nothing spent, to try again after.
    const bare = await rig.table();
    const orc = bare.hero({ class: "fighter", level: 4, race: "half_orc", feats: ["Orcish Fury"], equipment: worn("Longsword") });
    const { createConnectionGrant } = await import("../../src/lib/agents/grants.ts");
    const seat = createConnectionGrant({ userId: bare.sheet(orc).userId, name: "seat", scopes: ["play"], campaignId: bare.world.campaignId });
    assert.ok(!("error" in seat), seat.error);
    const [target] = await bare.fight([orc]);
    const early = await bare.use(orc, "Orcish Fury", {}, [6]);
    assert.notEqual(early.ok, true, `a use before any hit was taken: ${JSON.stringify(early)}`);
    assert.equal(early.retry, true, "the refusal before a hit asks for the call again after one");
    assert.equal(bare.used(orc, "feat_orcish_fury"), 0, "the refused use was spent");
    const hit = await bare.swing(orc, target, [15, 5], { weapon: "Longsword" });
    assert.ok(hit.damage, `the agent seat's longsword did not hit: ${JSON.stringify(hit.out).slice(0, 300)}`);
    const struck = bare.enemy(target).currentHp;
    const fury = await bare.use(orc, "Orcish Fury", {}, [6]);
    assert.equal(fury.ok, true, JSON.stringify(fury));
    assert.equal(struck - bare.enemy(target).currentHp, 6, "the bare use's d8 of 6 on the creature the longsword hit");
    assert.equal(bare.used(orc, "feat_orcish_fury"), 1);
  };

  P["feat.orcish-fury.rest"] = async () => {
    const { t, who, swing, choose } = await furyHit(["Orcish Fury"]);
    const first = await swing();
    assert.equal((await choose(first.pending, "orcish_fury", 5, 6)).status, 200);
    t.kit.freshTurn();
    const again = await swing();
    assert.equal(again.offered.includes("orcish_fury"), false, "Orcish Fury was offered again before a rest");
    const { resourceDef } = await import("../../src/lib/srd/class-resources.ts");
    assert.equal(resourceDef("feat_orcish_fury").recharge, "short");
    assert.equal(t.used(who, "feat_orcish_fury"), 1);
  };

  // Relentless Endurance holds the half-orc at 1 hit point; right after it,
  // the reaction makes one weapon attack. Without the feat, or before the
  // trait has held them, the reaction is refused.
  P["feat.orcish-fury.strike"] = async () => {
    const outcome = {};
    for (const [label, feats, drop] of [["plain", [], true], ["unspent", ["Orcish Fury"], false], ["fury", ["Orcish Fury"], true]]) {
      const t = await rig.table();
      const who = t.hero({ class: "fighter", level: 4, race: "half_orc", feats, equipment: worn("Longsword") });
      const [foe] = await t.fight([who]);
      if (drop) {
        t.world.patch(who.id, { currentHp: 3 });
        t.foesTurn(foe);
        const hit = await t.strike(foe, who, [16, 4]);
        assert.equal(hit.ok, true, hit.error);
        assert.equal(t.sheet(who).currentHp, 1, "the staging: Relentless Endurance held them at 1");
      }
      const before = t.enemy(foe).currentHp;
      const out = await t.invoke("use_reaction", { characterId: who.id, feature: "orcish fury", targetEnemyId: foe.id }, [15, 5]);
      outcome[label] = out.ok ? before - t.enemy(foe).currentHp : "refused";
    }
    assert.deepEqual(outcome, { plain: "refused", unspent: "refused", fury: 8 }, "the reaction's longsword hit (5 + 3)");
  };

  // A fighter's Strength check (DC 15, +3) lands on a natural 1 and waits on
  // its card; the halfling within 30 feet, their player at the table, is
  // offered Bountiful Luck, and the fighter's die is rolled again.
  const luckyTable = async (feats) => {
    const t = await rig.table({ gameSettings: { dicePolicy: "real_allowed" } });
    const roller = t.hero({ class: "fighter", level: 4, race: "hill_dwarf" });
    const halfling = t.hero({ class: "rogue", level: 4, race: "lightfoot_halfling", feats });
    const { subscribe } = await import("../../src/lib/events.ts");
    subscribe(t.world.campaignId, () => {}, t.sheet(halfling).userId);
    const { listOpenPendingRolls, getPendingRoll } = await import("../../src/lib/db/dm-turns.ts");
    const { listRecentRolls } = await import("../../src/lib/db/rolls.ts");
    const route = await t.world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");
    const check = async (who, faces) => {
      await t.invoke("request_roll", { characterId: who.id, kind: "ability_check", ability: "str", dc: 15, reason: "the gate" }, faces);
      const [pending] = listOpenPendingRolls(t.world.campaignId);
      return { pending, offered: (pending?.thrown?.options ?? []).map((option) => `${option.id}${option.by ? `:${option.by === halfling.id ? "halfling" : option.by}` : ""}`) };
    };
    const lend = async (pending, ...faces) => {
      t.world.signIn({ id: t.sheet(halfling).userId });
      t.world.dice(...faces);
      const out = await call(route, "POST", { use: "bountiful_luck", by: halfling.id }, { campaignId: t.world.campaignId, pendingRollId: pending.id });
      t.world.clearDice();
      const landed = listRecentRolls(t.world.campaignId, 30).find((roll) => roll.id === getPendingRoll(pending.id).rollId);
      return { out, total: landed?.total ?? null };
    };
    return { t, roller, halfling, check, lend };
  };

  P["feat.bountiful-luck.reroll"] = async () => {
    const plain = await luckyTable([]);
    assert.equal((await plain.check(plain.roller, [1])).offered.includes("bountiful_luck:halfling"), false, "a halfling without the feat was offered Bountiful Luck");
    const { check, lend, roller } = await luckyTable(["Bountiful Luck"]);
    const missed = await check(roller, [4]);
    assert.equal(missed.offered.includes("bountiful_luck:halfling"), false, "Bountiful Luck was offered on a 4");
    const one = await check(roller, [1]);
    assert.ok(one.offered.includes("bountiful_luck:halfling"), `the card of a natural 1 offered ${JSON.stringify(one.offered)}`);
    const { out, total } = await lend(one.pending, 17);
    assert.equal(out.status, 200, JSON.stringify(out.json));
    assert.equal(total, 20, "the new roll of 17, + 3 Strength, stands");
  };

  P["feat.bountiful-luck.lucky"] = async () => {
    const { t, check, lend, roller, halfling } = await luckyTable(["Bountiful Luck"]);
    const before = await t.roll(halfling, { kind: "saving_throw", ability: "wis", dc: 30 }, [1, 19]);
    assert.deepEqual(before.faces, [19], `the staging: Lucky rolls the halfling's own 1 again (${JSON.stringify(before.faces)})`);
    const one = await check(roller, [1]);
    assert.equal((await lend(one.pending, 17)).out.status, 200);
    assert.equal(t.has(halfling, "bountiful luck lent"), true, `conditions: ${t.sheet(halfling).conditions.join(", ")}`);
    // The halfling's own natural 1 is not rolled again by Lucky now.
    const own = await t.roll(halfling, { kind: "saving_throw", ability: "wis", dc: 30 }, [1, 19]);
    assert.deepEqual(own.faces, [1], `the halfling's own save threw ${JSON.stringify(own.faces)}`);
  };
}
