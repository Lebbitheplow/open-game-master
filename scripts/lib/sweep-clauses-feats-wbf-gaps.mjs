// The feat clauses nobody had staged (wave 2, part wbf): each is run at the
// table's own door, for a holder of the feat and for a character without it
// (scripts/clauses/feats.json; run by test-enforce-sweep-clauses-feats.mjs).
import { assert } from "./sweep-clauses-srd-rig.mjs";
import { d20s, tableKit, worn } from "./sweep-clauses-feats-wbf-table.mjs";

// A corridor along row 5, walled above and below, so a walk cannot go round
// what is painted in it.
const corridor = () => Array.from({ length: 20 }, (_, x) => [[x, 4, "#"], [x, 6, "#"]]).flat();

export function gapProbes(rig, P) {
  const { walk, each } = tableKit(rig);

  // Three squares of cliff between the climber and the far side: 5 squares
  // walked, 3 of them climbed at double cost (8) on 6 squares of speed.
  P["feat.athlete.climb"] = async () => {
    const seen = await each("Athlete", {}, async (t, hero) => {
      const [foe] = await t.fight([hero]);
      t.kit.openField([...corridor(), [6, 5, "^"], [7, 5, "^"], [8, 5, "^"]]);
      t.kit.place(hero.id, 5, 5);
      t.kit.place(foe.id, 17, 12);
      const out = await walk(t, hero, { x: 10, y: 5 });
      return { status: out.status, moved: t.kit.token(hero.id).movedThisRound };
    });
    assert.ok(seen.plain.status >= 400, `three climbed squares cost a fighter nothing extra: ${JSON.stringify(seen)}`);
    assert.deepEqual(seen.holder, { status: 200, moved: 5 }, `an Athlete climbs at no extra cost: ${JSON.stringify(seen)}`);
  };

  // A 15-foot chasm, Strength 16: a running long jump clears 16 feet, a
  // standing one 8. The run-up is 10 feet, an Athlete's 5.
  P["feat.athlete.jump"] = async () => {
    const seen = await each("Athlete", {}, async (t, hero) => {
      const [foe] = await t.fight([hero]);
      t.kit.openField(Array.from({ length: t.kit.map().width }, (_, x) => [x, 4, "|"]));
      t.kit.place(foe.id, 15, 1);
      const tried = {};
      for (const run of [0, 1]) {
        t.kit.place(hero.id, 5, 6, run);
        tried[run] = (await walk(t, hero, { x: 5, y: 3, jump: true })).status;
      }
      return tried;
    });
    assert.deepEqual(seen.plain, { 0: 400, 1: 400 }, `a fighter cleared 15 feet with less than a 10-foot run: ${JSON.stringify(seen)}`);
    assert.deepEqual(seen.holder, { 0: 400, 1: 200 }, `an Athlete's running jump follows 5 feet of movement, not none: ${JSON.stringify(seen)}`);
  };

  P["feat.actor.disguise"] = async () => {
    const seen = await each("Actor", {}, async (t, hero) => {
      const faces = {};
      for (const [label, args] of [["disguise", { skill: "deception", about: "disguise" }], ["performance", { skill: "performance", about: "disguise" }], ["plain lie", { skill: "deception" }]]) {
        const roll = await t.roll(hero, { kind: "skill_check", dc: 10, ...args }, [15, 3]);
        assert.equal(roll.ok, true, roll.error);
        faces[label] = roll.faces.length;
      }
      return faces;
    });
    assert.deepEqual(seen.plain, { disguise: 1, performance: 1, "plain lie": 1 });
    assert.deepEqual(seen.holder, { disguise: 2, performance: 2, "plain lie": 1 }, "d20s an Actor throws passing as someone else, and for a lie that is no disguise");
  };

  // The run is read off the walk: 10 feet on one heading, then the Dash and
  // the bonus attack (a 4 on the longsword's d8 + 3, and 5 more); a walk that
  // turns on its last step is no run; the caller's own word still counts.
  P["feat.charger.run"] = async () => {
    const charge = async (steps, args = {}, how = "attack") => {
      const t = await rig.table();
      const hero = t.hero({ class: "fighter", level: 4, equipment: worn("Longsword"), feats: ["Charger"] });
      const [foe] = await t.fight([hero]);
      t.kit.openField(corridor().filter(([, y]) => y === 4));
      t.kit.place(hero.id, 3, 5);
      t.kit.place(foe.id, 6, 5);
      for (const step of steps) {
        const out = await walk(t, hero, step);
        assert.equal(out.status, 200, JSON.stringify(out.body).slice(0, 200));
      }
      const here = t.kit.token(hero.id);
      t.kit.place(foe.id, here.x + 1, here.y);
      assert.equal((await t.act(hero, "dash")).ok, true);
      const before = t.enemy(foe).currentHp;
      const from = t.kit.token(foe.id).x;
      const out = how === "attack"
        ? await t.invoke("pc_attack", { characterId: hero.id, targetEnemyId: foe.id, weapon: "Longsword", feature: "Charger", ...args }, [15, 4])
        : await t.invoke("take_action", { characterId: hero.id, action: "shove", shove: "push", bonus: true, targetEnemyId: foe.id }, [15, 5]);
      assert.equal(out.ok, true, out.error);
      return how === "attack" ? before - t.enemy(foe).currentHp : (t.kit.token(foe.id).x - from) * 5;
    };
    const straight = [{ x: 5, y: 5 }];
    const twoDrags = [{ x: 4, y: 5 }, { x: 5, y: 5 }];
    const turned = [{ x: 5, y: 5 }, { x: 5, y: 6 }];
    assert.deepEqual(
      { none: await charge([]), straight: await charge(straight), twoDrags: await charge(twoDrags), turned: await charge(turned), said: await charge([], { charged: true }) },
      { none: 7, straight: 12, twoDrags: 12, turned: 7, said: 12 },
      "Charger's attack: with no run, after 10 feet straight (in one walk or two), after a walk that turned, and on the caller's word",
    );
    assert.deepEqual(
      { none: await charge([], {}, "shove"), straight: await charge(straight, {}, "shove"), turned: await charge(turned, {}, "shove") },
      { none: 5, straight: 15, turned: 5 },
      "feet Charger's shove pushes",
    );
  };

  // Taken twice, for fire and for cold: a resisting creature takes each whole.
  P["feat.elemental-adept.twice"] = async () => {
    const t = await rig.table();
    const dealt = {};
    for (const [label, features] of [["fire only", ["Elemental Adept: fire"]], ["fire and cold", ["Elemental Adept: fire", "Elemental Adept: cold"]]]) {
      const hero = t.hero({
        class: "wizard", level: 4, feats: features.map(() => "Elemental Adept"), features: features.map((name) => ({ name, source: "feat" })),
        spells: ["Ray of Frost", "Fire Bolt"], cantrips: ["Ray of Frost", "Fire Bolt"],
      });
      const [foe] = await t.fight([hero], { foe: { resist: "fire, cold" } });
      t.kit.place(foe.id, 9, 5);
      const row = [];
      for (const spell of ["Fire Bolt", "Ray of Frost"]) {
        t.freshTurn();
        const before = t.enemy(foe).currentHp;
        const out = await t.invoke("pc_attack", { characterId: hero.id, targetEnemyId: foe.id, spell }, [15, 6]);
        assert.equal(out.ok, true, out.error);
        row.push(before - t.enemy(foe).currentHp);
      }
      dealt[label] = row;
    }
    assert.deepEqual(dealt, { "fire only": [6, 3], "fire and cold": [6, 6] }, "a 6 of fire, then a 6 of cold, against a creature resisting both");
  };

  // A use of the kit as an action: 1d6 (a 3) + 4 + the creature's 4 Hit Dice,
  // once for each creature until it rests.
  P["feat.healer.kit"] = async () => {
    const seen = await each("Healer", { equipment: [{ name: "Healer's Kit", qty: 1 }] }, async (t, hero) => {
      const friend = t.hero({ class: "fighter", level: 4 });
      const [foe] = await t.fight([hero, friend]);
      t.kit.place(foe.id, 17, 12);
      t.patch(friend, { currentHp: 20 });
      const tend = () => t.invoke("use_item", { characterId: hero.id, item: "Healer's Kit", targetCharacterId: friend.id }, [3]);
      const first = await tend();
      const healed = t.sheet(friend).currentHp - 20;
      const action = t.budget()?.actionUsed === true;
      t.freshTurn();
      const again = await tend();
      // The fight ends as the table ends it (the rig's endFight wipes every
      // condition, the mark with them), then a short rest.
      const over = await t.invoke("end_encounter", { outcome: "truce" });
      assert.equal(over.ok, true, over.error);
      const marked = t.sheet(friend).conditions.length;
      const rest = await t.rest("short");
      assert.equal(rest.ok, true, rest.error);
      t.patch(friend, { currentHp: 20 });
      const rested = await tend();
      return { first: first.ok, healed, action, again: again.ok, marked, afterRest: rested.ok ? t.sheet(friend).currentHp - 20 : String(rested.error).slice(0, 80) };
    });
    assert.equal(seen.plain.healed, 0, `a kit with no Healer feat restored hit points: ${JSON.stringify(seen.plain)}`);
    assert.deepEqual(seen.holder, { first: true, healed: 11, action: true, again: false, marked: 1, afterRest: 11 }, JSON.stringify(seen.holder));
  };

  // Ten minutes of rallying: level 4 + Charisma 14's +2 in temporary hit
  // points for each of up to six creatures within 30 feet, once until a rest.
  P["feat.inspiring-leader.rally"] = async () => {
    const t = await rig.table();
    const leader = t.hero({ class: "fighter", level: 4, abilities: { cha: 14 }, feats: ["Inspiring Leader"] });
    const friends = Array.from({ length: 7 }, (_, at) => t.hero({ class: "fighter", level: 4, name: `Friend ${at + 1}` }));
    assert.equal(t.max(leader, "inspiring_leader"), 6, "a rally reaches six creatures");
    const [foe] = await t.fight([leader, ...friends]);
    t.kit.place(foe.id, 17, 12);
    const inFight = await t.use(leader, "Inspiring Leader", { targetCharacterId: friends[0].id });
    assert.equal(inFight.ok, false, "ten minutes of rallying in the middle of a fight");
    assert.equal(t.used(leader, "inspiring_leader"), 0, "the refusal spent a use");
    await t.kit.endFight();
    const rallied = [];
    for (const friend of friends) rallied.push((await t.use(leader, "Inspiring Leader", { targetCharacterId: friend.id })).ok);
    assert.deepEqual(rallied, [true, true, true, true, true, true, false], "the seventh creature of one rally");
  };

  P["feat.inspiring-leader.temp"] = async () => {
    const t = await rig.table();
    const leader = t.hero({ class: "fighter", level: 4, abilities: { cha: 14 }, feats: ["Inspiring Leader"] });
    const friend = t.hero({ class: "fighter", level: 4 });
    await t.kit.endFight();
    const out = await t.use(leader, "Inspiring Leader", { targetCharacterId: friend.id });
    assert.equal(out.ok, true, out.error);
    assert.equal(t.sheet(friend).tempHp, 6, "level 4 + Charisma modifier 2");
    t.patch(friend, { tempHp: 0 });
    const again = await t.use(leader, "Inspiring Leader", { targetCharacterId: friend.id });
    assert.equal(again.ok, false, "the same creature rallied twice before a rest");
    assert.equal(t.sheet(friend).tempHp, 0);
    assert.equal(t.used(leader, "inspiring_leader"), 1, "the refusal spent a use");
    await t.rest("short");
    const rested = await t.use(leader, "Inspiring Leader", { targetCharacterId: friend.id });
    assert.equal(rested.ok, true, `after a rest: ${rested.error}`);
    assert.equal(t.sheet(friend).tempHp, 6);
  };

  // A hit on the Lucky character: the point throws the attacker's d20 again
  // (a 2 misses AC 18) and the damage comes back.
  P["feat.lucky.attacked"] = async () => {
    const seen = await each("Lucky", { equipment: worn("Plate") }, async (t, hero) => {
      const [foe] = await t.fight([hero]);
      t.foesTurn(foe);
      const hit = await t.strike(foe, hero, [16, 4]);
      assert.equal(hit.ok, true, hit.error);
      const hurt = t.sheet(hero).currentHp;
      const out = await t.invoke("use_reaction", { characterId: hero.id, feature: "Lucky" }, [2]);
      return { ok: out.ok, back: t.sheet(hero).currentHp - hurt, points: t.used(hero, "luck_points"), reaction: t.world.encounter().reactionsUsed.includes(hero.id) };
    });
    assert.equal(seen.plain.ok, false, "a luck point with no Lucky feat");
    assert.deepEqual(seen.holder, { ok: true, back: 6, points: 1, reaction: false }, JSON.stringify(seen.holder));
  };

  // Four squares of rough ground on the way: 8 squares walked cost 12 without
  // the feat, 8 for a Mobile character who Dashed, 12 for one who did not.
  P["feat.mobile.dash-terrain"] = async () => {
    const run = async (feats, dash) => {
      const t = await rig.table();
      const hero = t.hero({ class: "fighter", level: 4, feats });
      const [foe] = await t.fight([hero]);
      t.kit.openField([...corridor(), [6, 5, ","], [7, 5, ","], [8, 5, ","], [9, 5, ","]]);
      t.kit.place(hero.id, 5, 5);
      t.kit.place(foe.id, 17, 12);
      if (dash) assert.equal((await t.act(hero, "dash")).ok, true);
      const out = await walk(t, hero, { x: 11, y: 5 });
      return out.status === 200 ? t.kit.token(hero.id).movedThisRound : out.status;
    };
    // Six squares, four of them rough.
    assert.deepEqual(
      { plainDash: await run([], true), mobileDash: await run(["Mobile"], true), mobileWalk: await run(["Mobile"], false) },
      { plainDash: 10, mobileDash: 6, mobileWalk: 400 },
      "squares of movement six squares cost, four of them difficult terrain (a Mobile walk has 8)",
    );
  };

  // The creature a Sentinel's opportunity attack hits stops where it is.
  P["feat.sentinel.stop"] = async () => {
    const seen = await each("Sentinel", { equipment: worn("Longsword") }, async (t, hero) => {
      const [foe] = await t.fight([hero]);
      t.foesTurn(foe);
      const out = await t.invoke("move_token", { token: foe.id, x: 8, y: 5 }, [15, 4]);
      const at = t.kit.token(foe.id);
      const more = await t.invoke("move_token", { token: foe.id, x: at.x + 1, y: at.y });
      return { swung: d20s(out), stopped: t.foeHas(foe, "stopped"), more: more.ok };
    });
    assert.deepEqual(seen.plain, { swung: 1, stopped: false, more: true }, JSON.stringify(seen));
    assert.deepEqual(seen.holder, { swung: 1, stopped: true, more: false }, `speed 0 for the rest of the turn: ${JSON.stringify(seen)}`);
  };

  // A creature that Disengaged walks away: only the Sentinel still swings.
  P["feat.sentinel.disengage"] = async () => {
    const seen = await each("Sentinel", { equipment: worn("Longsword") }, async (t, hero) => {
      const [foe] = await t.fight([hero]);
      t.foesTurn(foe);
      const out = await t.invoke("move_token", { token: foe.id, x: 9, y: 5, disengage: true }, [15, 4]);
      assert.equal(out.ok, true, out.error);
      return d20s(out);
    });
    assert.deepEqual(seen, { plain: 0, holder: 1 }, "opportunity attacks on a creature that Disengaged");
  };

  // The creature beside the Sentinel attacks a friend: the reaction is one
  // melee attack on it.
  P["feat.sentinel.guard"] = async () => {
    const seen = await each("Sentinel", { equipment: worn("Longsword") }, async (t, hero) => {
      const friend = t.hero({ class: "fighter", level: 4 });
      const [foe] = await t.fight([hero, friend]);
      t.kit.place(friend.id, 6, 4);
      t.foesTurn(foe);
      const early = await t.invoke("use_reaction", { characterId: hero.id, feature: "Sentinel", targetEnemyId: foe.id }, [15, 4]);
      const hit = await t.strike(foe, friend, [16, 4]);
      assert.equal(hit.ok, true, hit.error);
      const before = t.enemy(foe).currentHp;
      const out = await t.invoke("use_reaction", { characterId: hero.id, feature: "Sentinel", targetEnemyId: foe.id }, [15, 4]);
      return { early: early.ok, ok: out.ok, dealt: before - t.enemy(foe).currentHp, reaction: t.world.encounter().reactionsUsed.includes(hero.id) };
    });
    assert.equal(seen.plain.ok, false, "Sentinel's attack with no feat");
    assert.deepEqual(seen.holder, { early: false, ok: true, dealt: 7, reaction: true }, JSON.stringify(seen.holder));
  };

  // A Dexterity save for the character alone, DC 14: a 10 + 2 fails, and the
  // shield's 2 makes it; the reaction then turns half of 7 into nothing.
  P["feat.shield-master.save"] = async () => {
    const seen = await each("Shield Master", { equipment: worn("Longsword", "Shield") }, async (t, hero) => {
      const [foe] = await t.fight([hero]);
      t.foesTurn(foe);
      const before = t.sheet(hero).currentHp;
      const out = await t.invoke("cast_at_player", { characterId: hero.id, casterEnemyId: foe.id, source: "a jet of flame", saveAbility: "dex", dc: 14, damage: "2d6", damageType: "fire", halfOnSave: true }, [10, 3, 4]);
      assert.equal(out.ok, true, out.error);
      return { took: before - t.sheet(hero).currentHp, reaction: t.world.encounter().reactionsUsed.includes(hero.id) };
    });
    assert.deepEqual(seen, { plain: { took: 7, reaction: false }, holder: { took: 0, reaction: true } }, "a Dexterity save of 12 against DC 14, shield in hand");
  };

  // The meal: every creature that spends a Hit Die regains 1d8 more.
  P["feat.chef.meal"] = async () => {
    const seen = await each("Chef", {}, async (t) => {
      const friend = t.hero({ class: "fighter", level: 4 });
      await t.kit.endFight();
      t.patch(friend, { currentHp: 10 });
      const out = await t.invoke("take_rest", { kind: "short", spend: [{ characterId: friend.id, dice: 1 }] }, [5, 6]);
      assert.equal(out.ok, true, out.error);
      return t.sheet(friend).currentHp - 10;
    });
    assert.deepEqual(seen, { plain: 7, holder: 13 }, "a friend's Hit Die of 5 + 2, and the cook's d8 (a 6)");
  };

  // Magic Initiate's 1st-level spell: once with no slot at its lowest level
  // (three darts: 2 + 1 each), refused with the cast spent and no slot to pay,
  // back after a long rest. Named at 2nd level, a slot pays and the free cast
  // is kept.
  P["feat.magic-initiate.free-cast"] = async () => {
    const initiate = (t, extra = {}) => t.hero({
      class: "fighter", level: 4, feats: ["Magic Initiate"],
      featChoices: { "magic initiate": { list: "wizard", cantrips: ["Fire Bolt", "Light"], spells: ["Magic Missile"] } },
      spellcasting: { ability: "int", slots: {}, known: ["Magic Missile"], prepared: [], cantrips: ["Fire Bolt", "Light"] },
      features: [{ name: "Free cast: Magic Missile (Magic Initiate)", source: "story" }],
      ...extra,
    });
    const free = (t, hero) => t.sheet(hero).resources.free_cast_magic_missile;
    const t = await rig.table();
    const hero = initiate(t);
    assert.deepEqual(free(t, hero), { max: 1, used: 0 }, "the free cast's counter");
    const [foe] = await t.fight([hero]);
    const cast = (at, who, target, args = {}) => at.invoke("cast_at_enemy", { characterId: who.id, targetEnemyId: target.id, spell: "Magic Missile", ...args }, [2, 2, 2, 2]);
    const before = t.enemy(foe).currentHp;
    const first = await cast(t, hero, foe);
    assert.equal(first.ok, true, first.error);
    assert.equal(before - t.enemy(foe).currentHp, 9, "three darts: the spell's lowest level");
    assert.equal(free(t, hero).used, 1, "the free cast is spent");
    t.freshTurn();
    const again = await cast(t, hero, foe);
    assert.equal(again.ok, false, "a second casting with the free cast spent and no slot");
    await t.kit.endFight();
    await t.rest("short");
    assert.equal(free(t, hero).used, 1, "a short rest gave the free cast back");
    await t.rest("long");
    assert.equal(free(t, hero).used, 0, "the long rest gives it back");
    // With slots of their own: named at 2nd level a slot pays, and the free cast stays.
    const t2 = await rig.table();
    const caster = initiate(t2, { spellcasting: { ability: "int", slots: { 1: { max: 2, used: 0 }, 2: { max: 2, used: 0 } }, known: ["Magic Missile"], prepared: ["Magic Missile"], cantrips: ["Fire Bolt", "Light"] } });
    const [other] = await t2.fight([caster]);
    const up = await cast(t2, caster, other, { level: 2 });
    assert.equal(up.ok, true, up.error);
    assert.deepEqual([free(t2, caster).used, t2.sheet(caster).spellcasting.slots[2].used], [0, 1], "cast at 2nd level: [free cast used, 2nd-level slots used]");
  };

  // Eldritch Adept: one invocation whose prerequisites the character meets,
  // taken on the sheet's owed pick (POST /sheet/owed), and no second.
  // "You can replace it when you gain a level": the level-up gives up the
  // invocation for another whose prerequisites are met, and refuses one unmet.
  P["feat.eldritch-adept.replace"] = async () => {
    const t = await rig.table();
    const hero = t.hero({ class: "fighter", level: 4, feats: ["Eldritch Adept"] });
    t.patch(hero, { xp: 6500, features: [...t.sheet(hero).features, { name: "Invocation: Devil's Sight", source: "choice" }] });
    const route = await t.world.route("campaigns/[campaignId]/sheet");
    const level = async (changes) => {
      t.world.signIn({ id: t.sheet(hero).userId });
      const res = await route.PATCH(
        new Request(`http://test/api/campaigns/${t.world.campaignId}/sheet`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ characterId: hero.id, level: 5, levelUpChanges: changes }) }),
        { params: Promise.resolve({ campaignId: t.world.campaignId }) },
      );
      return { status: res.status, body: await res.json() };
    };
    const unmet = await level([{ from: "Invocation: Devil's Sight", to: "Invocation: Thirsting Blade" }]);
    assert.equal(unmet.status, 400, `an invocation whose prerequisites are unmet was taken: ${JSON.stringify(unmet.body).slice(0, 200)}`);
    const done = await level([{ from: "Invocation: Devil's Sight", to: "Invocation: Armor of Shadows" }]);
    assert.equal(done.status, 200, JSON.stringify(done.body).slice(0, 300));
    assert.deepEqual(t.sheet(hero).features.filter((feature) => feature.name.startsWith("Invocation:")).map((feature) => feature.name), ["Invocation: Armor of Shadows"]);
  };

  P["feat.eldritch-adept.invocation"] = async () => {
    const tried = {};
    for (const [label, feats] of [["plain", []], ["holder", ["Eldritch Adept"]]]) {
      const t = await rig.table();
      const hero = t.hero({ class: "wizard", level: 4, feats, spells: ["Magic Missile"], cantrips: ["Fire Bolt"] });
      const route = await t.world.route("campaigns/[campaignId]/sheet/owed");
      const pick = async (name) => {
        t.world.signIn({ id: t.sheet(hero).userId });
        const res = await route.POST(
          new Request("http://odm.test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ characterId: hero.id, features: [name] }) }),
          { params: Promise.resolve({ campaignId: t.world.campaignId }) },
        );
        return res.status;
      };
      // Thirsting Blade asks for warlock level 5 and Pact of the Blade; Agonizing
      // Blast for the Eldritch Blast cantrip: neither is met.
      tried[label] = { blade: await pick("Invocation: Thirsting Blade"), blast: await pick("Invocation: Agonizing Blast"), sight: await pick("Invocation: Devil's Sight"), second: await pick("Invocation: Armor of Shadows") };
      tried[label].held = t.sheet(hero).features.filter((feature) => feature.name.startsWith("Invocation:")).map((feature) => feature.name);
    }
    assert.deepEqual(tried.plain, { blade: 400, blast: 400, sight: 400, second: 400, held: [] }, "a wizard without the feat owes no invocation");
    assert.deepEqual(tried.holder, { blade: 400, blast: 400, sight: 200, second: 400, held: ["Invocation: Devil's Sight"] }, "Eldritch Adept: one invocation, its prerequisites met");
  };

  // Chef's treats: as many as the proficiency bonus (+3 at 5th level), each
  // 3 temporary hit points for the eater's own bonus action, made by a long
  // rest and spoiled 8 hours after it.
  P["feat.chef.treats"] = async () => {
    const { getClock, setClock } = await import("../../src/lib/db/clock.ts");
    const t = await rig.table();
    const cook = t.hero({ class: "fighter", level: 5, feats: ["Chef"] });
    const friend = t.hero({ class: "fighter", level: 5 });
    const treats = () => t.sheet(cook).resources.chef_treats;
    assert.deepEqual(treats(), { max: 3, used: 0 }, "treats at 5th level: the proficiency bonus");
    assert.equal(t.sheet(friend).resources.chef_treats, undefined, "a fighter without the feat holds none");
    const eat = (who) => t.invoke("use_resource", { characterId: cook.id, resource: "Chef's Treats", ...(who ? { targetCharacterId: who.id } : {}) });
    const temp = (who) => t.sheet(who).tempHp ?? 0;
    // Out of a fight nothing times a bonus action: the friend eats one.
    const calm = await eat(friend);
    assert.equal(calm.ok, true, calm.error);
    assert.deepEqual([temp(friend), treats().used], [3, 1], "[the friend's temporary hit points, treats eaten]");
    t.patch(friend, { tempHp: 0 });
    // In a fight, on the cook's turn: the friend's bonus action is not theirs to take.
    await t.fight([cook, friend]);
    const off = await eat(friend);
    assert.equal(off.ok, false, "a friend ate a treat on the cook's turn");
    assert.deepEqual([temp(friend), treats().used], [0, 1], "the refusal gave hit points or spent a treat");
    assert.equal(t.budget()?.bonusUsed ?? false, false, "the refusal spent the cook's bonus action");
    const own = await eat(null);
    assert.equal(own.ok, true, own.error);
    assert.deepEqual([temp(cook), t.budget().bonusUsed], [3, true], "the cook eats one for their own bonus action");
    // On the friend's own turn their bonus action pays.
    t.kit.giveTurn(friend.id);
    t.freshTurn();
    const theirs = await eat(friend);
    assert.equal(theirs.ok, true, theirs.error);
    assert.deepEqual([temp(friend), t.budget().bonusUsed, treats().used], [3, true, 3], "[the friend's temporary hit points, their bonus action spent, treats eaten]");
    t.freshTurn();
    const none = await eat(friend);
    assert.equal(none.ok, false, "a fourth treat of three");
    // A short rest makes none; a long rest makes them all again.
    await t.kit.endFight();
    await t.rest("short");
    assert.equal(treats().used, 3, "a short rest made treats");
    await t.rest("long");
    assert.equal(treats().used, 0, "the long rest makes the treats");
    // 8 hours on the clock from the end of that rest.
    const clock = getClock(t.world.campaignId);
    const made = clock.longRests?.[cook.id];
    assert.equal(typeof made, "number", "the staging: the clock holds the end of the cook's long rest");
    t.patch(friend, { tempHp: 0 });
    setClock(t.world.campaignId, { ...clock, instant: made + 9 * 60 });
    const late = await eat(friend);
    assert.equal(late.ok, false, "a treat eaten 9 hours after it was made");
    assert.match(String(late.error), /spoiled/);
    assert.deepEqual([temp(friend), treats().used], [0, 0], "the spoiled treat gave hit points or was spent");
    setClock(t.world.campaignId, { ...getClock(t.world.campaignId), instant: made + 7 * 60 });
    const fresh = await eat(friend);
    assert.equal(fresh.ok, true, `7 hours after it was made: ${fresh.error}`);
    assert.equal(temp(friend), 3);
  };
}
