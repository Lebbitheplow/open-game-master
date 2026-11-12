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
  const grower = (origin, level, spells, tag) => {
    const who = holder("sorcerer", origin, level, { spells, cantrips: ["Fire Bolt"] }, tag);
    world.patch(who.id, { xp: 355000 });
    return who;
  };
  const swaps = (who) => sheet(who).features.map((feature) => feature.name).filter((name) => name.startsWith("Spell swap"));
  // A level-up the door must refuse: the reason, with the sheet left as it was.
  async function refusedUp(who, body, why) {
    const before = JSON.stringify([sheet(who).level, sheet(who).spellcasting.known, sheet(who).features.length]);
    const out = await levelUp(who, body);
    assert.equal(out.status, 400, `${JSON.stringify(body)} was to be refused: ${JSON.stringify(out.json).slice(0, 200)}`);
    assert.match(out.json.error, why);
    assert.equal(JSON.stringify([sheet(who).level, sheet(who).spellcasting.known, sheet(who).features.length]), before, "a refused level-up changes nothing");
  }
  async function takenUp(who, body) {
    const out = await levelUp(who, body);
    assert.equal(out.status, 200, `${JSON.stringify(body)}: ${out.json.error}`);
  }
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
    // ---- Divine Soul: Divine Magic
    // "You can learn cleric spells as sorcerer spells": the builder's spell
    // step opens the cleric list to a Divine Soul and to no other origin, the
    // level-up's offer says so and its door takes a cleric spell from the one
    // and refuses it from the other, and the spell is cast with Charisma.
    "divine-cleric-list": async () => {
      const sb = await (await import("./sweep-builder.mjs")).openSweepBuilder({ world, user: world.owner });
      const wider = (origin) => sb.derive(sb.fresh({ level: 3, classId: "sorcerer", subclass: origin, raceId: sb.races[0].id, backgroundId: sb.backgrounds[0].id })).derived.spellWider.lists;
      assert.deepEqual([wider("Divine Soul"), wider("Wild Magic")], [["cleric"], []], "the other lists the builder's spell step draws from, [Divine Soul, Wild Magic]");
      assert.ok((await sb.spellPool("cleric", 2)).some((spell) => spell.name === "Spiritual Weapon"), "the cleric list the step then searches holds Spiritual Weapon");
      // The level-up, 2nd level to 3rd: Spiritual Weapon is on the cleric's list alone.
      const { content } = await routes();
      assert.deepEqual(content.spellFactsFor("Spiritual Weapon", []).classes.map((entry) => entry.toLowerCase()), ["cleric"]);
      const known = ["Magic Missile", "Sleep", "Burning Hands"];
      const [soul, wild] = [grower("Divine Soul", 2, known, "cleric list"), grower("Wild Magic", 2, known, "cleric list")];
      const notes = [(await offered(soul)).json.choices.spells.note, (await offered(wild)).json.choices.spells.note];
      assert.match(notes[0], /new spells may also come from the cleric spell list/);
      assert.doesNotMatch(notes[1], /cleric/);
      await refusedUp(wild, { levelUpSpells: ["Spiritual Weapon"] }, /Spiritual Weapon is not on the sorcerer spell list/);
      await takenUp(soul, { levelUpSpells: ["Spiritual Weapon"] });
      assert.deepEqual([sheet(soul).level, knows(soul, "Spiritual Weapon"), await listProblems(soul)], [3, true, []]);
      // Cast as a sorcerer spell: Guiding Bolt's attack roll is the d20, the
      // proficiency bonus and Charisma (+4), not Wisdom (-1).
      const caster = holder("sorcerer", "Divine Soul", 20, { spells: ["Guiding Bolt"] }, "casts cleric");
      const [enemy] = await stage(caster);
      // 20 feet off: a ranged attack beside its target rolls at disadvantage.
      kit.place(enemy.id, 9, 5);
      const bolt = await call("pc_attack", { characterId: caster.id, targetEnemyId: enemy.id, spell: "Guiding Bolt" }, [10, 3, 3, 3, 3]);
      assert.equal(bolt.ok, true, bolt.error);
      const toHit = (await import("../../src/lib/db/rolls.ts")).listRecentRolls(world.campaignId, 6).find((entry) => entry.kind === "attack");
      assert.equal(toHit?.total, 10 + prof(20) + MOD.cha, `Guiding Bolt's attack roll on a 10: ${JSON.stringify(toHit?.breakdown ?? null).slice(0, 160)}`);
    },
    // "If you replace that spell later, it must become a cleric spell": the
    // affinity spell (Cure Wounds, for Good) given up at a level-up for a
    // sorcerer spell is refused, for a cleric spell above the slots too, and
    // for a cleric spell it is taken, which is then the free one.
    "divine-affinity-swap": async () => {
      const who = grower("Divine Soul", 4, ["Magic Missile", "Sleep", "Burning Hands", "Shield", "Scorching Ray"], "affinity");
      world.patch(who.id, { features: sheet(who).features.map((feature) => (feature.name === "Divine Magic" ? { ...feature, name: "Divine Magic (Good)" } : feature)) });
      assert.ok(sheet(who).features.some((feature) => feature.name === "Divine Magic (Good)"), "the origin's feature, with its affinity chosen");
      assert.deepEqual(await granted(who), ["Cure Wounds"], "the affinity spell");
      assert.match((await offered(who)).json.choices.spells.note, /Divine Magic: levelUpForget may instead name Cure Wounds, to replace it with a cleric spell/);
      await refusedUp(who, { levelUpSpells: ["Mage Armor"], levelUpForget: "Cure Wounds" }, /Mage Armor cannot take the place of Cure Wounds: it is not on the cleric spell list/);
      await refusedUp(who, { levelUpSpells: ["Guardian of Faith"], levelUpForget: "Cure Wounds" }, /Guardian of Faith cannot take the place of Cure Wounds: it is a level 4 spell, above the level 3/);
      await refusedUp(who, { levelUpForget: "Cure Wounds" }, /name the spell that takes its place in levelUpSpells/);
      // Spirit Guardians (cleric, 3rd level) takes its place, and Fireball is the level's own new spell.
      await takenUp(who, { levelUpSpells: ["Spirit Guardians", "Fireball"], levelUpForget: "Cure Wounds" });
      assert.deepEqual(
        [sheet(who).level, swaps(who), await granted(who), knows(who, "Cure Wounds"), knows(who, "Spirit Guardians"), knows(who, "Fireball"), await listProblems(who)],
        [5, ["Spell swap: Cure Wounds > Spirit Guardians"], ["Spirit Guardians"], false, true, true, []],
        "[level, the record, the free spell, knows Cure Wounds, knows Spirit Guardians, knows Fireball, what the tables say is wrong]",
      );
      // The spell that took its place is the one replaced the next time.
      await refusedUp(who, { levelUpSpells: ["Haste"], levelUpForget: "Spirit Guardians" }, /Haste cannot take the place of Spirit Guardians: it is not on the cleric spell list/);
      await takenUp(who, { levelUpSpells: ["Bless", "Haste"], levelUpForget: "Spirit Guardians" });
      assert.deepEqual([swaps(who), await granted(who), knows(who, "Spirit Guardians")], [["Spell swap: Cure Wounds > Bless"], ["Bless"], false]);
    },
    // ---- Aberrant Mind: Psionic Spells
    // "one of them may be replaced with a divination or enchantment spell of
    // the same level from the sorcerer, warlock or wizard list": Calm Emotions
    // (2nd level) given up for an evocation, for a 1st-level enchantment and
    // for an enchantment of the bard's list is refused each time; Suggestion
    // takes its place, free of the spells known, and is paid with sorcery
    // points as a psionic spell is.
    "psionic-swap": async () => {
      const who = grower("Aberrant Mind", 5, ["Magic Missile", "Sleep", "Burning Hands", "Shield", "Scorching Ray", "Mage Armor"], "psionic");
      assert.match((await offered(who)).json.choices.spells.note, /Psionic Spells: levelUpForget may instead name one of Arms of Hadar, Dissonant Whispers, Mind Sliver, Calm Emotions, Detect Thoughts, Hunger of Hadar, Sending, to replace it with a divination or enchantment spell of the same level from the sorcerer, warlock or wizard list/);
      const giveUp = (spell) => ({ levelUpSpells: [spell], levelUpForget: "Calm Emotions" });
      await refusedUp(who, giveUp("Shatter"), /Shatter cannot take the place of Calm Emotions: its school is evocation/);
      await refusedUp(who, giveUp("Charm Person"), /Charm Person cannot take the place of Calm Emotions: it is a level 1 spell, and the spell it replaces is a level 2 spell/);
      await refusedUp(who, giveUp("Zone of Truth"), /Zone of Truth cannot take the place of Calm Emotions: it is not on the sorcerer, warlock or wizard spell list/);
      // Six spells known at 5th level, seven at 6th: Fireball is the seventh, and Suggestion is none of them.
      await takenUp(who, { levelUpSpells: ["Suggestion", "Fireball"], levelUpForget: "Calm Emotions" });
      const free = await granted(who);
      assert.deepEqual(
        [sheet(who).level, swaps(who), free.includes("Suggestion"), free.includes("Calm Emotions"), knows(who, "Calm Emotions"), knows(who, "Suggestion"), knows(who, "Fireball"), await listProblems(who)],
        [6, ["Spell swap: Calm Emotions > Suggestion"], true, false, false, true, true, []],
        "[level, the record, Suggestion free, Calm Emotions free, knows Calm Emotions, knows Suggestion, knows Fireball, what the tables say is wrong]",
      );
      // Psionic Sorcery (6th level): silenced, the spell swapped in is cast for
      // sorcery points equal to its level, and the one given up is offered none.
      const { content } = await routes();
      const offer = await import("../../src/lib/dm/ar-ws-points-offer.ts");
      assert.deepEqual(
        ["Suggestion", "Calm Emotions", "Detect Thoughts"].map((spell) => offer.pointsOfferFor(sheet(who), spell, content.spellFactsFor(spell, []), undefined)?.points ?? null),
        [2, null, 2],
        "sorcery points that pay for [the spell swapped in, the one given up, a psionic spell of the table]",
      );
      await stage(who);
      world.patch(who.id, { conditions: ["silenced"] });
      const [points, slots] = [left(who, "sorcery_points"), JSON.stringify(sheet(who).spellcasting.slots)];
      const cast = await call("use_spell_slot", { characterId: who.id, spell: "Suggestion" });
      assert.equal(cast.ok, true, `silenced, Suggestion: ${String(cast.error).slice(0, 160)}`);
      assert.deepEqual([points - left(who, "sorcery_points"), JSON.stringify(sheet(who).spellcasting.slots) === slots], [2, true], "[sorcery points spent, no slot spent]");
      await kit.endFight();
      rig.refill(who);
      // An edit that rebuilds the lists from the origin's table writes Calm
      // Emotions back among the spells known (the builder does): the door
      // takes the lists without it, where it would refuse them for a spell
      // off the sorcerer's list.
      const [legality, catalog] = [await import("../../src/lib/srd/legality/spells.ts"), await import("../../src/lib/characters/catalog.ts")];
      const now = sheet(who);
      const edited = legality.judgeSpellcasting({
        sent: { ...now.spellcasting, known: [...now.spellcasting.known, "Calm Emotions"] },
        classes: [{ id: "sorcerer", subclass: "Aberrant Mind", level: now.level }],
        classOf: (id) => catalog.classGrantsFor(id, []),
        abilities: now.abilities,
        spellOf: (name) => catalog.spellFactsFor(name, []),
        held: now.spellcasting,
        features: now.features,
        judgeLists: true,
        bookAllowance: false,
      });
      assert.deepEqual([edited.problems, edited.spellcasting.known.includes("Calm Emotions"), edited.spellcasting.known.includes("Suggestion")], [[], false, true], "[problems, Calm Emotions kept, Suggestion kept] for an edit that writes the swapped-out spell back");
      // Replaced again: the spell given up is the one that holds the place now.
      await takenUp(who, { levelUpSpells: ["Hold Person"], levelUpForget: "Suggestion" });
      assert.deepEqual([swaps(who), (await granted(who)).includes("Hold Person"), knows(who, "Suggestion")], [["Spell swap: Calm Emotions > Hold Person"], true, false]);
    },
    // ---- Clockwork Soul: Clockwork Magic
    // The same door with the Clockwork Soul's two schools: Alarm (1st level)
    // gives way to Feather Fall (transmutation), and not to an evocation or a
    // divination.
    "clockwork-swap": async () => {
      const who = grower("Clockwork Soul", 2, ["Magic Missile", "Sleep", "Burning Hands"], "clockwork");
      assert.match((await offered(who)).json.choices.spells.note, /Clockwork Magic: levelUpForget may instead name one of Alarm, Protection from Evil and Good, Aid, Lesser Restoration, to replace it with an abjuration or transmutation spell of the same level from the sorcerer, warlock or wizard list/);
      await refusedUp(who, { levelUpSpells: ["Chromatic Orb"], levelUpForget: "Alarm" }, /Chromatic Orb cannot take the place of Alarm: its school is evocation/);
      await refusedUp(who, { levelUpSpells: ["Detect Magic"], levelUpForget: "Alarm" }, /Detect Magic cannot take the place of Alarm: its school is divination/);
      await refusedUp(who, { levelUpSpells: ["Levitate"], levelUpForget: "Alarm" }, /Levitate cannot take the place of Alarm: it is a level 2 spell/);
      await takenUp(who, { levelUpSpells: ["Feather Fall", "Scorching Ray"], levelUpForget: "Alarm" });
      const free = await granted(who);
      assert.deepEqual(
        [sheet(who).level, swaps(who), free.includes("Feather Fall"), free.includes("Alarm"), knows(who, "Alarm"), knows(who, "Scorching Ray"), await listProblems(who)],
        [3, ["Spell swap: Alarm > Feather Fall"], true, false, false, true, []],
        "[level, the record, Feather Fall free, Alarm free, knows Alarm, knows Scorching Ray, what the tables say is wrong]",
      );
      // An origin with no such feature gives up a spell known the ordinary way only.
      const wild = grower("Wild Magic", 2, ["Magic Missile", "Sleep", "Burning Hands"], "no swap");
      await refusedUp(wild, { levelUpSpells: ["Feather Fall"], levelUpForget: "Alarm" }, /Alarm is not a spell this character knows/);
    },
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
  return { PROBES, KNOWN };
}

// A module loaded on first use and kept.
function lazy(load) {
  let seen = null;
  return () => (seen ??= load());
}
