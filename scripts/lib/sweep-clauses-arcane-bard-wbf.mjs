// The bard clause probes of wave 2's last round (part wbf): the clauses the
// earlier rounds had read and not run, each staged through the tool or the
// route a table uses (scripts/clauses/arcane.json; run by
// test-enforce-sweep-clauses-arcane-bard.mjs beside sweep-clauses-arcane-bard.mjs).
import assert from "node:assert/strict";

export function probes(rig, shared) {
  const { world, kit, holder, sheet, foe, show, call, stage } = rig;
  const { friend } = shared;
  const B = (college, level = 20, extra = {}, tag = "") => holder("bard", college, level, extra, tag);
  const d = (out, sides) => out.rolled.filter((die) => die.sides === sides).length;
  const has = (who, prefix) => sheet(who).conditions.some((name) => name.startsWith(prefix));
  // A casting of Sleep (verbal, somatic, a pinch of sand) by a bard carrying
  // exactly `equipment`: the harness's component pouch is taken away with it.
  async function sleepWith(who, equipment) {
    await stage(who);
    world.patch(who.id, { equipment });
    return call("use_spell_slot", { characterId: who.id, spell: "Sleep" });
  }
  const scimitar = { name: "Scimitar", qty: 1, equipped: true };

  const PROBES = {
    // ---- College of Swords
    "swords-focus": async () => {
      const blade = B("College of Swords", 20, { spells: ["Sleep"] }, "focus");
      const other = B("College of Valor", 20, { spells: ["Sleep"] }, "focus");
      const plain = await sleepWith(other, [scimitar]);
      assert.equal(plain.ok, false, "a Valor bard with a scimitar and no instrument or pouch cast a spell with a material");
      assert.match(String(plain.error), /component pouch/);
      const out = await sleepWith(blade, [scimitar]);
      assert.equal(out.ok, true, `a Swords bard's scimitar is their focus: ${String(out.error).slice(0, 200)}`);
      // The hand that holds the focus handles the material: a shield beside it shuts nothing.
      const full = await sleepWith(blade, [scimitar, { name: "Shield", qty: 1, equipped: true }]);
      assert.equal(full.ok, true, `scimitar and shield: ${String(full.error).slice(0, 200)}`);
      // Sheathed, the weapon is no focus.
      const sheathed = await sleepWith(blade, [{ ...scimitar, equipped: false }]);
      assert.equal(sheathed.ok, false, "a sheathed scimitar served as the focus");
    },
    // ---- College of Glamour
    "majesty-charmed": async () => {
      const who = B("College of Glamour");
      const [enemy] = await stage(who);
      assert.equal((await rig.spend(who, "Mantle of Majesty")).ok, true);
      const command = async () => {
        kit.giveTurn(who.id);
        kit.freshTurn();
        const out = await call("cast_at_enemy", { characterId: who.id, targetEnemyId: enemy.id, spell: "Command" }, [20]);
        assert.equal(out.ok, true, out.error);
        return out;
      };
      // A 20 on the die saves a creature the bard has not charmed.
      const free = await command();
      assert.equal(free.result.saved, true, show(free).slice(0, 200));
      kit.setEnemy(enemy.id, { conditions: ["charmed"], conditionMeta: { charmed: { source: who.id, rounds: 10 } } });
      const bound = await command();
      assert.equal(bound.result.saved, false, `a creature the bard charmed saved against the mantle's command: ${show(bound).slice(0, 200)}`);
      assert.equal(d(bound, 20), 0, "it fails with no die rolled");
      // Charmed by somebody else, it rolls.
      kit.setEnemy(enemy.id, { conditions: ["charmed"], conditionMeta: { charmed: { source: friend().id, rounds: 10 } } });
      assert.equal((await command()).result.saved, true, "another creature's charm failed the save");
    },
    // ---- College of Creation
    "mote-burst": async () => {
      const who = B("College of Creation");
      const [struck, near, far] = await stage(who, { count: 3, others: [friend()] });
      world.patch(friend().id, { conditions: [], conditionMeta: {} });
      const gave = await rig.spend(who, "Bardic Inspiration", { targetCharacterId: friend().id });
      assert.equal(gave.ok, true, gave.error);
      // The friend beside the first foe; the second foe 5 feet from it, the third 10.
      kit.place(friend().id, 6, 4);
      kit.giveTurn(friend().id);
      kit.freshTurn();
      const before = [struck, near, far].map((enemy) => foe(enemy).currentHp);
      const friendHp = sheet(friend()).currentHp;
      // The d20, then the mote's die on the attack roll (a 7), then low dice: every Constitution save fails.
      const out = await call("pc_attack", { characterId: friend().id, targetEnemyId: struck.id }, [15, 7, 3, 3, 3, 3, 3, 3]);
      assert.equal(out.ok, true, out.error);
      const lost = [struck, near, far].map((enemy, at) => before[at] - foe(enemy).currentHp);
      assert.equal(lost[1], 7, `the foe 5 feet from the target takes thunder equal to the die's roll (a 7): ${JSON.stringify(lost)} ${show(out).slice(0, 260)}`);
      assert.equal(lost[2], 0, "a foe 10 feet from the target was caught");
      assert.ok(lost[0] >= 7, `the target takes the burst with the hit: ${lost[0]}`);
      assert.equal(has(friend(), "bardic inspiration"), false, "the die is spent");
      assert.equal(sheet(friend()).currentHp, friendHp, "the burst hurt a friend beside the target");
    },
    // ---- College of Spirits
    "spirits-focus": async () => {
      const who = B("College of Spirits", 20, { spells: ["Sleep"] }, "focus");
      const none = await sleepWith(who, []);
      assert.equal(none.ok, false, "a Spirits bard with no focus and no pouch cast a spell with a material");
      const out = await sleepWith(who, [{ name: "Candle", qty: 1 }]);
      assert.equal(out.ok, true, `a candle is a Spirits bard's focus: ${String(out.error).slice(0, 200)}`);
      // The candle is no focus for a bard of another college.
      const other = await sleepWith(B("College of Valor", 20, { spells: ["Sleep"] }, "focus"), [{ name: "Candle", qty: 1 }]);
      assert.equal(other.ok, false, "a Valor bard's candle served as a focus");
    },
    "whispers-reach": async () => {
      const who = B("College of Spirits");
      const guide = async (bard, x, y) => {
        await stage(bard, { others: [friend()] });
        world.patch(friend().id, { conditions: [], conditionMeta: {} });
        kit.place(friend().id, x, y);
        return call("cast_buff", { characterId: bard.id, spell: "Guidance", targetCharacterIds: [friend().id] });
      };
      const far = await guide(who, 5, 17);
      assert.equal(far.ok, true, `Guidance at ${rig.feetBetween(who, friend())} feet: ${String(far.error).slice(0, 200)}`);
      assert.ok(has(friend(), "guidance"), JSON.stringify(sheet(friend()).conditions));
      const past = await guide(who, 5, 18);
      assert.equal(past.ok, false, `Guidance at ${rig.feetBetween(who, friend())} feet, past the 60`);
      // Another bard's Guidance is the touch spell it is.
      const other = await guide(B("College of Valor", 20, { spells: ["Guidance"], cantrips: ["Guidance"] }, "guide"), 5, 7);
      assert.equal(other.ok, false, "a Valor bard's Guidance reached 10 feet");
    },
    // The friend stands at (4,5) with a dummy beside them: the mantle lets
    // them walk their whole 30 feet away with their reaction, and the dummy
    // does not swing. Nobody else may, and the leave ends with the bard's turn.
    "mantle-move": async () => {
      const who = B("College of Glamour");
      const stride = (x, y) => call("use_reaction", { characterId: friend().id, feature: "Mantle of Inspiration", x, y }, [15, 4]);
      const [enemy] = await stage(who, { others: [friend()] });
      kit.place(enemy.id, 3, 5);
      const early = await stride(4, 11);
      assert.equal(early.ok, false, "the move with no mantle laid");
      const out = await call("use_resource", { characterId: who.id, resource: "Mantle of Inspiration", targetCharacterIds: [friend().id] });
      assert.equal(out.ok, true, out.error);
      assert.ok(has(friend(), "mantle's stride"), JSON.stringify(sheet(friend()).conditions));
      const far = await stride(4, 12);
      assert.equal(far.ok, false, "35 feet on 30 feet of speed");
      const moved = await stride(4, 11);
      assert.equal(moved.ok, true, moved.error);
      const at = kit.token(friend().id);
      assert.deepEqual([at.x, at.y, d(moved, 20)], [4, 11, 0], "the whole speed, and no opportunity attack from the dummy beside them");
      assert.ok(world.encounter().reactionsUsed.includes(friend().id), "the move is their reaction");
      assert.ok(!has(friend(), "mantle's stride"), "the leave is spent with the move");
      assert.equal((await stride(4, 5)).ok, false, "a second move");
      // Unused, it ends with the bard's turn.
      await stage(who, { others: [friend()] });
      const again = await call("use_resource", { characterId: who.id, resource: "Mantle of Inspiration", targetCharacterIds: [friend().id] });
      assert.equal(again.ok, true, again.error);
      assert.ok(has(friend(), "mantle's stride"));
      rig.endCurrent();
      assert.ok(!has(friend(), "mantle's stride"), `after the bard's turn: ${JSON.stringify(sheet(friend()).conditions)}`);
    },
    // ---- College of Spirits
    // Speak with Dead is a 3rd-level necromancy spell: three creatures took
    // part (amount, the bard included; a 20th-level bard may hold it with 6).
    session: async () => {
      const who = B("College of Spirits", 20, { spells: ["Sleep"] }, "session");
      await stage(who);
      await kit.endFight();
      const ask = (variant, amount) => call("use_resource", { characterId: who.id, resource: "Spirit Session", variant, ...(amount ? { amount } : {}) });
      const cast = () => call("use_spell_slot", { characterId: who.id, spell: "Speak with Dead" });
      assert.equal((await cast()).ok, false, "the staging: the bard does not know Speak with Dead");
      assert.equal((await ask("Speak with Dead")).ok, false, "a 3rd-level spell from a session of one");
      assert.equal((await ask("Fireball", 3)).ok, false, "an evocation spell");
      assert.equal((await ask("Speak with Dead", 7)).ok, false, "seven creatures on a proficiency bonus of 6");
      assert.equal(sheet(who).resources.sub_spirit_session.used, 0, "a refusal spends nothing");
      const out = await ask("Speak with Dead", 3);
      assert.equal(out.ok, true, out.error);
      const lists = () => sheet(who).spellcasting;
      assert.ok(lists().prepared.includes("Speak with Dead"), "the spell is learned");
      assert.ok(!(lists().known ?? []).includes("Speak with Dead"), "it does not count against the spells known");
      assert.equal((await ask("Detect Magic", 3)).ok, false, "a second session before a long rest");
      const spoken = await cast();
      assert.equal(spoken.ok, true, `the learned spell is cast as a bard spell: ${String(spoken.error).slice(0, 200)}`);
      // The rest itself (rig.rest would first wipe every condition, the mark with them).
      const night = await call("take_rest", { kind: "long" });
      assert.equal(night.ok, true, night.error);
      assert.ok(!lists().prepared.includes("Speak with Dead"), "it stays until a long rest");
      assert.ok(!has(who, "spirit session"), JSON.stringify(sheet(who).conditions));
      assert.equal((await cast()).ok, false, "cast after the long rest took it");
      // The Hand's card sends the session with no spell: the use is spent and
      // waits, and the call that names the spell spends nothing more.
      const bare = await ask(undefined);
      assert.equal(bare.ok, true, bare.error);
      assert.equal(sheet(who).resources.sub_spirit_session.used, 1, "the bare session spends the use");
      assert.equal((await ask("Speak with Dead", 2)).ok, false, "a 3rd-level spell from the two who took part");
      const named = await ask("Speak with Dead", 3);
      assert.equal(named.ok, true, named.error);
      assert.equal(sheet(who).resources.sub_spirit_session.used, 1, "naming the spell spends nothing more");
      assert.ok(lists().prepared.includes("Speak with Dead") && !has(who, "spirit session unspoken"), JSON.stringify(sheet(who).conditions));
    },
  };

  const KNOWN = {};
  return { PROBES, KNOWN };
}
