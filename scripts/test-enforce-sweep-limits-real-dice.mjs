// The named leftovers of the real-dice pull requests (#817 to #825): the
// "Noticed and left alone" lists in /tmp/odm-gapstudy/limits.md. Most say "the
// server's dice do X and dice entered at the table do not", so most rows here
// are one attack run both ways with the same faces and the two tables diffed:
// the creature (hit points, conditions, place, status), the attacker (hit
// points, temporary hit points, conditions), the turn's marks and whether the
// fight still stands. A row with nothing to diff says what it holds instead.
import assert from "node:assert/strict";
import "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { TRAINED } from "./lib/enforce-combat.mjs";
import { limitsSuite } from "./lib/sweep-limits.mjs";
import { limitsTable } from "./lib/sweep-limits-world.mjs";

const { entryDice } = await import("../src/lib/dice.ts");
// One face for every d20 the roll asks for (two with advantage).
const fill = (roll, faces) => (Array.isArray(faces) ? faces : entryDice(roll.expression).map(() => faces));

const KNOWN = {


};
const RULING = {
  "825-damage-lands-after-the-turn": "pull request #825 lists it under \"Already true of an ordinary real-dice hit\"; scripts/test-enforce-physical-feat-bonus.mjs \"a damage roll that lands on the next character's turn opens nothing, whether or not they have acted\" pins that the damage lands and only the turn's bonuses are withheld",
  "822-cover-as-parked": "scripts/test-enforce-real-dice-reactions.mjs \"A roll parked before the creature's own AC was recorded ... keeps the AC it parked with\" asserts \"the 2 of cover stays\"; scripts/test-enforce-parry-in-the-dark.mjs \"the light when the attack is made decides, not the light when the roll lands\" states the same reading for light",
};
const SKIP = {
  "820-feats-skipped:Mage Slayer": "needs a creature holding concentration on a spell for the hit to test; no staging helper puts a creature's concentration on the table. Left to the dice package's differential.",
  "820-feats-skipped:Poisoner": "needs a weapon carrying the feat's poison and a creature that resists it; the feat's own spend was not staged here.",
  "820-curving-shot": "the body's own note is \"read only\": it needs an Arcane Archer's magic arrow to miss and a bonus action to turn it, two calls whose dice differ by path.",
  "825-guard-accepts-the-rolled-total": "the narration guard reads a GM model's prose against the rolls; it needs a scripted narrator turn (scripts/lib/enforce-narrator.mjs) around a parked roll, which this suite does not run. Pinned elsewhere: scripts/test-enforce-real-dice-half-on-miss.mjs \"the GM may say the half that landed: the narration guard finds it, and not a figure no roll made\".",
  "820-same-turn-come-round": "the body says it was seen \"with the test helper only, not a real order edit\": it needs the initiative pointer to leave a turn and come back within one round, which no player or GM door does.",
  "824-large-token-origin-tile": "the body's own note says \"neither was run\" and the second \"may be a rules call\"; a Large token's sight from its far tile needs the same split-lit board.",
  "825-notes-missing-bardic-and-concentration": "the after-roll card (Bardic Inspiration) and a concentrating creature both need a second seat's choice mid-attack; left to the dice package's differential, which diffs notes.",
};

const { row, finish } = limitsSuite("test-enforce-sweep-limits-real-dice", { KNOWN, RULING, SKIP });
const world = await openWorld({ campaign: { maxPlayers: 60 }, gameSettings: { dicePolicy: "real_allowed" } });
const table = await limitsTable(world);
const { kit } = table;
const { resolvePcOpportunityAttacks } = await import("../src/lib/dm/opportunity.ts");

const PARRY = "Reaction: Parry. The captain adds 2 to its AC against one melee attack that would hit it. To do so, the captain must see the attacker and be wielding a melee weapon.";
const SHIELD = { dc: 15, ability: "int", casterLevel: 9, spells: [{ name: "Shield", level: 1 }], slots: { 1: 3 } };

const fighter = (feats = [], equipment = [{ name: "Longsword", qty: 1 }], extra = {}) =>
  world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 16, wis: 12 }, proficiencies: TRAINED, equipment, feats, ...extra });

// One attacker against `count` dummies (AC 13, 400 hit points), toe to toe
// with the first, on the attacker's own fresh turn.
async function stage(hero, { count = 1, stats = {}, enemy: patch = {}, apart = 1 } = {}) {
  await kit.endFight();
  for (const sheet of world.sheets()) {
    world.patch(sheet.id, { currentHp: sheet.maxHp, tempHp: 0, conditions: [], conditionMeta: {}, concentratingOn: null, resources: Object.fromEntries(Object.entries(sheet.resources ?? {}).map(([id, state]) => [id, { ...state, used: 0 }])) });
  }
  await kit.fight(count, { heroFaces: Object.fromEntries(world.sheets().map((sheet) => [sheet.id, sheet.id === hero.id ? 19 : 2])) });
  const board = kit.map();
  for (const sheet of world.sheets()) {
    if (sheet.id !== hero.id) kit.place(sheet.id, board.width - 1, board.height - 1);
  }
  const foes = world.enemies();
  foes.forEach((enemy, at) => {
    kit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400, ...(at === 0 ? { stats, ...patch } : {}) });
    kit.place(enemy.id, 5 + at * 3, 5 + apart);
  });
  kit.place(hero.id, 5, 5);
  assert.equal(kit.current().characterId, hero.id, "the attacker does not hold the turn");
  return foes.map((enemy) => kit.enemy(enemy.id));
}

const state = (hero, enemy) => {
  const foe = kit.enemy(enemy.id);
  const token = world.encounter() ? kit.token(enemy.id) : null;
  const sheet = world.sheet(hero.id);
  return {
    foe: { hp: foe.currentHp, status: foe.status, conditions: [...foe.conditions].sort(), at: token ? [token.x, token.y] : null },
    hero: { hp: sheet.currentHp, tempHp: sheet.tempHp, conditions: [...sheet.conditions].sort() },
    // A mark names the creature it concerns by id (a weapon hit's "weapon-hit:<id>"),
    // which differs between the two worlds compared: read as the role.
    marks: [...(world.encounter()?.turnBudget?.oncePerTurn ?? [])].map((mark) => mark.replace(enemy.id, "<foe>")).sort(),
    fight: world.encounter() ? "on" : "over",
  };
};

// The same attack on the server's dice and on dice entered at the table.
// `toHit`: the d20 faces; `damage`: the faces the player enters; `after`: what
// the server throws once the blow lands (a creature's save); `serverDamage`:
// the damage faces in the order the server throws them, when a reroll differs.
async function both(hero, { args, toHit, damage = [], after = [], serverDamage = damage, setUp = {} }) {
  const out = {};
  {
    const [enemy] = await stage(hero, setUp);
    const swing = await kit.swing(hero.id, enemy.id, [toHit, ...serverDamage, ...after].flat(), args);
    assert.equal(swing.ok, true, `the server's dice refused the attack: ${swing.error}`);
    out.server = { ...state(hero, enemy), said: JSON.stringify(swing.result) };
  }
  {
    const [enemy] = await stage(hero, setUp);
    await table.withRealDice(hero, async () => {
      const parked = await world.invoke("pc_attack", { characterId: hero.id, targetEnemyId: enemy.id, ...args });
      assert.equal(parked.ok, true, `real dice refused the attack: ${parked.error}`);
      const [roll] = table.openRolls(hero, "attack");
      assert.ok(roll, "no to-hit roll is parked");
      world.clearDice();
      world.dice(...after);
      const hit = await table.enter(hero, roll, [toHit].flat());
      assert.equal(hit.status, 200, JSON.stringify(hit.json));
      const [blow] = table.openRolls(hero, "damage");
      let note = hit.note;
      if (blow) {
        const landed = await table.enter(hero, blow, damage);
        assert.equal(landed.status, 200, `${JSON.stringify(landed.json)} for ${blow.expression}`);
        note += ` ${landed.note}`;
      }
      world.clearDice();
      out.table = { ...state(hero, enemy), said: note, asked: blow?.expression ?? null };
    });
  }
  return out;
}
const sameWorld = (out) => {
  const strip = ({ said, asked, ...rest }) => rest;
  assert.deepEqual(strip(out.table), strip(out.server), `the two dice leave different tables.\n server: ${JSON.stringify(strip(out.server))}\n table:  ${JSON.stringify(strip(out.table))}\n server said: ${out.server.said.slice(0, 300)}\n table said: ${out.table.said.slice(0, 300)}`);
};

// ---- #820: "Other things the digital path does and real dice skip" ----

const master = world.addHero({ class: "fighter", subclass: "battle_master", level: 5, maxHp: 44, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1 }] });
world.patch(master.id, {
  features: [
    ...world.sheet(master.id).features.filter((feature) => !["Combat Superiority", "Maneuvers"].includes(feature.name)),
    { name: "Combat Superiority", source: "subclass" },
    { name: "Maneuver: Trip Attack", source: "choice" },
    { name: "Maneuver: Menacing Attack", source: "choice" },
  ],
  resources: { ...world.sheet(master.id).resources, sub_superiority_dice: { max: 4, used: 0 } },
});
const monk = world.addHero({ class: "monk", subclass: "Way of the Open Hand", level: 6, maxHp: 44, abilities: { dex: 16, wis: 16 }, proficiencies: TRAINED });
const fiend = world.addHero({ class: "warlock", subclass: "The Fiend", level: 14, maxHp: 44, abilities: { cha: 16, dex: 14 }, proficiencies: TRAINED, equipment: [{ name: "Dagger", qty: 1, equipped: true }], spellcasting: { ability: "cha", slots: { 5: { max: 3, used: 0 } }, prepared: [], known: [], cantrips: ["Eldritch Blast"] } });
world.patch(fiend.id, { features: [...world.sheet(fiend.id).features, { name: "Repelling Blast", source: "choice" }] });
const mage = world.addHero({ class: "wizard", level: 9, maxHp: 44, abilities: { int: 16 }, proficiencies: TRAINED, spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 3, used: 0 } }, prepared: ["Vampiric Touch", "Acid Arrow"], known: [], cantrips: ["Fire Bolt"] } });
const thrower = fighter([], [{ name: "Alchemist's Fire (flask)", qty: 3 }, { name: "Acid (vial)", qty: 3 }]);
const weak = world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { str: 1, dex: 1 }, proficiencies: TRAINED, equipment: [{ name: "Club", qty: 1 }] });

const DIFFS = [
  { id: "820-maneuver-rider-save:Menacing Attack", who: master, run: { args: { weapon: "Longsword", maneuver: "Menacing Attack" }, toHit: 15, damage: [4, 5], after: [1] }, limit: "Maneuvers: rider saves such as Trip and Menacing. The die is spent and no save happens.", rule: "SRD 5.1 Battle Master, Menacing Attack: the target \"must make a Wisdom saving throw. On a failed save, it is frightened of you until the end of your next turn.\"", expect: (side) => side.foe.conditions.includes("frightened") },
  { id: "820-maneuver-rider-save:Trip Attack", who: master, run: { args: { weapon: "Longsword", maneuver: "Trip Attack" }, toHit: 15, damage: [4, 5], after: [1] }, limit: "Maneuvers: rider saves such as Trip and Menacing. The die is spent and no save happens.", rule: "SRD 5.1 Battle Master, Trip Attack: \"On a failed save, you knock the target prone.\"", expect: (side) => side.foe.conditions.includes("prone") },
  { id: "820-open-hand-technique", who: monk, prelude: true, run: { args: { feature: "Flurry of Blows", openHand: "prone" }, toHit: 15, damage: [4], after: [1] }, limit: "Open Hand, Hurl Through Hell and creature riders land before the kill is known.", rule: "SRD 5.1 Open Hand Technique: the target \"must succeed on a Dexterity saving throw or be knocked prone.\"" },
  { id: "820-stunning-strike", who: monk, run: { args: { weapon: "Unarmed Strike", stunningStrike: true }, toHit: 15, damage: [4], after: [1] }, limit: "Other things the digital path does and real dice skip (read only, not run).", rule: "SRD 5.1 Stunning Strike: \"The target must succeed on a Constitution saving throw or be stunned until the end of your next turn.\"", expect: (side) => side.foe.conditions.includes("stunned") },
  { id: "820-hurl-through-hell", who: fiend, run: { args: { weapon: "Dagger", hurlThroughHell: true }, toHit: 15, damage: [3], after: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5] }, limit: "Open Hand, Hurl Through Hell and creature riders land before the kill is known.", rule: "SRD 5.1 Hurl Through Hell: \"If the creature is not a fiend, it takes 10d10 psychic damage as it reels from its horrific experience.\"" },
  { id: "820-repelling-blast", who: fiend, run: { args: { spell: "Eldritch Blast" }, toHit: 15, damage: [6], setUp: { apart: 3 } }, limit: "Features: Repelling Blast, Dark One's Blessing, Curving Shot.", rule: "SRD 5.1 Repelling Blast: \"When you hit a creature with eldritch blast, you can push the creature up to 10 feet away from you in a straight line.\"" },
  { id: "820-heal-half:Vampiric Touch", who: mage, run: { args: { spell: "Vampiric Touch", level: 3 }, toHit: 15, damage: [4, 4, 4] }, before: (hero) => world.patch(hero.id, { currentHp: 10 }), limit: "Spells and gear: Acid Arrow's half damage on a miss, healHalf spells, the net and flasks that deal no immediate damage.", rule: "SRD 5.1 Vampiric Touch: \"On a hit, the target takes 3d6 necrotic damage, and you regain hit points equal to half the amount of necrotic damage dealt.\"", expect: (side) => side.hero.hp > 10 },
  { id: "820-flask:Alchemist's Fire", who: thrower, run: { args: { weapon: "Alchemist's Fire (flask)" }, toHit: 15, damage: [], setUp: { apart: 3 } }, limit: "Spells and gear: ... the net and flasks that deal no immediate damage.", rule: "SRD 5.1 Alchemist's Fire: \"On a hit, the target takes 1d4 fire damage at the start of each of its turns.\"" },
  { id: "820-flask:Acid", who: thrower, run: { args: { weapon: "Acid (vial)" }, toHit: 15, damage: [3, 3], setUp: { apart: 3 } }, limit: "Spells and gear: ... flasks.", rule: "SRD 5.1 Acid: \"On a hit, the target takes 2d6 acid damage.\"" },
  { id: "820-zero-damage-lands-as-1", who: weak, run: { args: { weapon: "Club" }, toHit: 19, damage: [1] }, limit: "Damage of 0 or less lands as 1 on real dice (read only), where digital deals 0. That could turn a harmless hit into a kill.", rule: "SRD 5.1, Damage Rolls: \"With a penalty, it is possible to deal 0 damage, but never negative damage.\"", expect: (side) => side.foe.hp === 400 },
  { id: "820-knockout-note", who: fighter(), run: { args: { weapon: "Longsword", nonlethal: true }, toHit: 15, damage: [4], setUp: { enemy: { currentHp: 1, maxHp: 400 } } }, limit: "Notes on real dice (reproduced): the note says \"now dead\" for a knockout, a regenerating creature that is down, and a turncoat at 0 hit points.", rule: "SRD 5.1, Knocking a Creature Out: \"The attacker can make this choice the instant the damage is dealt. The creature falls unconscious and is stable.\"", expect: (side) => !/now dead/i.test(side.said) },
];
for (const diff of DIFFS) {
  await row(diff.id, { pr: 820, limit: diff.limit, rule: diff.rule }, async () => {
    const run = { ...diff.run };
    if (diff.before) {
      const setUp = run.setUp ?? {};
      run.setUp = setUp;
    }
    const original = stage;
    const out = await (async () => {
      if (!diff.before && !diff.prelude) return both(diff.who, run);
      // The attacker's own state is set after each staging.
      const sides = {};
      for (const real of [false, true]) {
        const [enemy] = await original(diff.who, run.setUp ?? {});
        if (diff.before) diff.before(diff.who);
        if (diff.prelude) {
          // The Attack action first, missed on the server's dice either way.
          const opened = await kit.swing(diff.who.id, enemy.id, [2], { weapon: "Unarmed Strike" });
          assert.equal(opened.ok, true, opened.error);
        }
        if (!real) {
          const swing = await kit.swing(diff.who.id, enemy.id, [run.toHit, ...(run.serverDamage ?? run.damage), ...(run.after ?? [])].flat(), run.args);
          assert.equal(swing.ok, true, `the server's dice refused the attack: ${swing.error}`);
          sides.server = { ...state(diff.who, enemy), said: JSON.stringify(swing.result) };
        } else {
          await table.withRealDice(diff.who, async () => {
            const parked = await world.invoke("pc_attack", { characterId: diff.who.id, targetEnemyId: enemy.id, ...run.args });
            assert.equal(parked.ok, true, parked.error);
            world.clearDice();
            world.dice(...(run.after ?? []));
            const hit = await table.enter(diff.who, table.openRolls(diff.who, "attack")[0], [run.toHit].flat());
            const [blow] = table.openRolls(diff.who, "damage");
            const landed = blow ? await table.enter(diff.who, blow, run.damage) : { note: "" };
            world.clearDice();
            sides.table = { ...state(diff.who, enemy), said: `${hit.note} ${landed.note}`, asked: blow?.expression ?? null };
          });
        }
      }
      return sides;
    })();
    sameWorld(out);
    if (diff.expect) {
      assert.ok(diff.expect(out.server), `the server's dice do not do it either: ${out.server.said.slice(0, 300)}`);
      assert.ok(diff.expect(out.table), `dice entered at the table: ${out.table.said.slice(0, 300)}`);
    }
  });
}

// ---- #817, #820: the feats and features the lists name, both ways ----

const PARITY = [
  ["817-physical-dice-open-the-bonus:Great Weapon Master", fighter(["Great Weapon Master"], [{ name: "Greatsword", qty: 1 }]), { args: { weapon: "Greatsword" }, toHit: 20, damage: [3, 3, 3, 3] }, (side) => /great weapon master/i.test(JSON.stringify(side.marks)), "Physical dice never open these bonuses. Only the digital path writes the Great Weapon Master and Tavern Brawler marks."],
  ["817-physical-dice-open-the-bonus:Tavern Brawler", fighter(["Tavern Brawler"], []), { args: { weapon: "Unarmed Strike" }, toHit: 15, damage: [3] }, (side) => /tavern brawler/i.test(JSON.stringify(side.marks)), "Physical dice never open these bonuses."],
  ["820-feats-skipped:Piercer", fighter(["Piercer"], [{ name: "Rapier", qty: 1 }]), { args: { weapon: "Rapier" }, toHit: 20, damage: [6, 8, 8], serverDamage: [1, 8, 8, 6] }, null, "Feats: Brutal Attack, Piercer, Slasher, Crusher, Stunning Sniper, Mage Slayer, and Elemental Adept's and Poisoner's ignored resistance."],
  ["820-feats-skipped:Brutal Attack", fighter(["Brutal Attack"], [{ name: "Greatsword", qty: 1 }]), { args: { weapon: "Greatsword" }, toHit: 15, damage: [6, 6], serverDamage: [1, 1, 6, 6] }, null, "Feats: Brutal Attack, Piercer, Slasher, Crusher, Stunning Sniper ..."],
  ["820-feats-skipped:Slasher", fighter(["Slasher"], [{ name: "Greatsword", qty: 1 }]), { args: { weapon: "Greatsword" }, toHit: 20, damage: [3, 3, 3, 3] }, (side) => side.foe.conditions.includes("hamstrung"), "Feats: Brutal Attack, Piercer, Slasher, Crusher, Stunning Sniper ..."],
  ["820-feats-skipped:Crusher", fighter(["Crusher"], [{ name: "Warhammer", qty: 1 }]), { args: { weapon: "Warhammer" }, toHit: 20, damage: [4, 4] }, (side) => side.marks.includes("crusher:used"), "Feats: Brutal Attack, Piercer, Slasher, Crusher, Stunning Sniper ..."],
  ["820-feats-skipped:Stunning Sniper", fighter(["Stunning Sniper"], [{ name: "Longbow", qty: 1 }, { name: "Arrows", qty: 20 }]), { args: { weapon: "Longbow", stunShot: true }, toHit: 20, damage: [5], setUp: { apart: 3 } }, (side) => side.foe.conditions.includes("stunned"), "Feats: Brutal Attack, Piercer, Slasher, Crusher, Stunning Sniper ..."],
  ["820-dark-ones-blessing", null, { args: { weapon: "Dagger" }, toHit: 15, damage: [3], setUp: { enemy: { currentHp: 1, maxHp: 1 } } }, (side) => side.hero.tempHp > 0, "Features: Repelling Blast, Dark One's Blessing, Curving Shot. Authored subclass features that depend on a kill, because they run at the to-hit stage."],
  ["820-net", fighter([], [{ name: "Net", qty: 2 }]), { args: { weapon: "Net" }, toHit: [18, 18], damage: [] }, (side) => side.foe.conditions.includes("restrained"), "Spells and gear: ... the net and flasks that deal no immediate damage."],
];
for (const [id, who, run, expect, limit] of PARITY) {
  await row(id, { pr: id.slice(0, 3), limit, rule: "The same attack on the server's dice and on dice entered at the table leaves the same table (scripts/test-enforce-real-dice-parity.mjs header)." }, async () => {
    const hero = who ?? world.sheets().find((sheet) => sheet.subclass === "The Fiend");
    if (id === "820-dark-ones-blessing") {
      world.patch(hero.id, { features: [...world.sheet(hero.id).features.filter((feature) => feature.name !== "Dark One's Blessing"), { name: "Dark One's Blessing", source: "class", classId: "warlock" }] });
    }
    const out = await both(hero, run);
    sameWorld(out);
    if (expect) {
      assert.ok(expect(out.server), `the server's dice do not do it either: ${JSON.stringify(out.server).slice(0, 300)}`);
      assert.ok(expect(out.table), `dice entered at the table: ${JSON.stringify(out.table).slice(0, 300)}`);
    }
  });
}
for (const id of ["820-feats-skipped:Mage Slayer", "820-feats-skipped:Poisoner", "820-curving-shot", "825-guard-accepts-the-rolled-total"]) {
  await row(id, { pr: id.slice(0, 3), limit: id, rule: "-" }, async () => {});
}

// ---- #817: the blow that ends the fight, for every once-a-turn feat ----

const FEAT_KILLS = [
  ["Great Weapon Master", "Greatsword", [15], [6, 6]],
  ["Savage Attacker", "Longsword", [15], [6], [6, 6]],
  ["Slasher", "Greatsword", [15], [6, 6]],
  ["Crusher", "Warhammer", [15], [6]],
  ["Piercer", "Rapier", [15], [6]],
  ["Brutal Attack", "Greatsword", [15], [6, 6], [6, 6, 6, 6]],
  ["Tavern Brawler", "Unarmed Strike", [15], [3]],
];
for (const [feat, weapon, toHit, damage, serverDamage] of FEAT_KILLS) {
  const who = fighter([feat], weapon === "Unarmed Strike" ? [] : [{ name: weapon, qty: 1 }]);
  await row(`817-last-foe-stays-dead:${feat}`, {
    pr: 817,
    limit: "Slasher and Crusher erase a failed save. Their stores still write the pre-blow encounter. Foe Slayer's mark gets wiped: any later store of that budget (Brutal Attack, Savage Attacker, Piercer, Slasher, Crusher) drops the mark.",
    rule: "A hit that ends the fight leaves it ended (pull request #817's title), on either dice: a feat's once-a-turn mark is written to the fight as the blow left it.",
  }, async () => {
    const out = await both(who, { args: { weapon }, toHit, damage, serverDamage, setUp: { enemy: { currentHp: 1, maxHp: 400 } } });
    assert.equal(out.server.fight, "over", `on the server's dice the fight stands after its last foe died: ${out.server.said.slice(0, 200)}`);
    assert.equal(out.table.fight, "over", `on dice entered at the table the fight stands after its last foe died: ${out.table.said.slice(0, 200)}`);
    assert.equal(out.table.foe.status, out.server.foe.status);
  });
}

// ---- #817, #818: Foe Slayer once a turn ----

const slayer = (wis, feats = []) => {
  const hero = world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, wis }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1 }], feats });
  world.patch(hero.id, { features: [...world.sheet(hero.id).features, { name: "Foe Slayer", description: "" }, { name: "Favored Enemy: humanoids", description: "" }] });
  return hero;
};
for (const feat of ["Savage Attacker", "Slasher", "Crusher", "Piercer", "Brutal Attack"]) {
  const who = slayer(16, [feat]);
  await row(`817-foe-slayer-twice-a-turn:${feat}`, {
    pr: 817,
    limit: "Foe Slayer's mark gets wiped. Any later store of that budget (Brutal Attack, Savage Attacker, Piercer, Slasher, Crusher) drops the mark. Foe Slayer's bonus can then apply again in the same turn.",
    rule: "SRD 5.1 Foe Slayer: \"Once on each of your turns, you can add your Wisdom modifier to the attack roll or the damage roll of an attack you make against one of your favored enemies.\"",
  }, async () => {
    const [enemy] = await stage(who);
    // +6 to hit against AC 13: a 5 is 11, which Foe Slayer's +3 lifts to a hit.
    const first = await kit.swing(who.id, enemy.id, [5, 4, 4, 4, 4], { weapon: "Longsword" });
    assert.equal(first.ok, true, first.error);
    assert.match(JSON.stringify(first.result), /Foe Slayer/, "the first near miss is not lifted, so this row proves nothing");
    const second = await kit.swing(who.id, enemy.id, [5, 4, 4, 4, 4], { weapon: "Longsword" });
    assert.equal(second.ok, true, second.error);
    assert.equal(second.result.hit, false, `the second near miss of the turn is lifted too: ${JSON.stringify(second.result).slice(0, 240)}`);
  });
}

await row("818-slasher-mark-on-the-hamstrung", {
  pr: 818,
  limit: "Slasher's mark (from reading the code). `unused && leave(\"hamstrung\")` writes no mark when the target is already hamstrung.",
  rule: "Slasher is once a turn: the turn's mark is the same whichever dice rolled it.",
}, async () => {
  const who = fighter(["Slasher"], [{ name: "Greatsword", qty: 1 }]);
  const out = await both(who, { args: { weapon: "Greatsword" }, toHit: 15, damage: [3, 3], setUp: { enemy: { conditions: ["hamstrung"], conditionMeta: { hamstrung: { rounds: 1 } } } } });
  sameWorld(out);
});

// ---- #819, #822: a creature's Shield and Parry against entered dice ----

const swordAndBow = fighter([], [{ name: "Longsword", qty: 1 }, { name: "Longbow", qty: 1 }, { name: "Arrows", qty: 20 }]);
const reactionSpent = (enemy) => world.encounter().reactionsUsed.includes(enemy.id);
const shieldUp = (enemy) => kit.enemy(enemy.id).conditions.includes("shielded");
async function tableSwing(hero, enemy, faces, args) {
  return table.withRealDice(hero, async () => {
    const earlier = new Set(table.openRolls(hero).map((entry) => entry.id));
    const parked = await world.invoke("pc_attack", { characterId: hero.id, targetEnemyId: enemy.id, ...args });
    assert.equal(parked.ok, true, parked.error);
    const roll = table.openRolls(hero, "attack").find((entry) => !earlier.has(entry.id));
    assert.ok(roll, "the to-hit roll is parked");
    const out = await table.enter(hero, roll, fill(roll, faces));
    assert.equal(out.status, 200, JSON.stringify(out.json));
    return out.note;
  });
}
async function twoParts(hero, parts, firstFaces, secondFaces, between = () => {}) {
  return table.withRealDice(hero, async () => {
    const parked = await world.invoke("pc_attack", { characterId: hero.id, attacks: parts });
    assert.equal(parked.ok, true, parked.error);
    // The second part waits behind the first, made once the first has landed
    // with its damage (pc-attack-parts.ts afterToHitLanded), as on the server's dice.
    const [first, early] = table.openRolls(hero, "attack");
    assert.ok(first && !early, "the second part is parked before the first has landed");
    const one = await table.enter(hero, first, fill(first, firstFaces));
    assert.equal(one.status, 200, JSON.stringify(one.json));
    const [blow] = table.openRolls(hero, "damage");
    if (blow) {
      const landed = await table.enter(hero, blow, entryDice(blow.expression).map(() => 1));
      assert.equal(landed.status, 200, JSON.stringify(landed.json));
    }
    await between();
    const [second] = table.openRolls(hero, "attack");
    assert.ok(second, "the second part was not made once the first had landed");
    const two = await table.enter(hero, second, fill(second, secondFaces));
    assert.equal(two.status, 200, JSON.stringify(two.json));
    return [one.note, two.note];
  });
}

await row("819-standing-shield-missed", {
  pr: 819,
  limit: "A standing Shield is missed on real dice. targetAc is frozen when the roll parks, so the next part of the same attack reads the old AC.",
  rule: "SRD 5.1 Shield: \"Until the start of your next turn, you have a +5 bonus to AC, including against the triggering attack\".",
}, async () => {
  const [enemy] = await stage(swordAndBow, { stats: { spellcasting: SHIELD } });
  const part = { targetEnemyId: enemy.id, weapon: "Longsword" };
  const [first, second] = await twoParts(swordAndBow, [part, part], 7, 7);
  assert.match(first, /casts Shield/, first);
  assert.match(second, /vs AC 18: MISS/, second);
});

await row("819-ranged-never-triggers-shield", {
  pr: 819,
  limit: "A ranged attack on real dice never triggers Shield. pc-attack-parked.ts checks `melee` before all of tryParry, not only Parry.",
  rule: "SRD 5.1 Shield: a reaction \"which you take when you are hit by an attack\": near or far.",
}, async () => {
  const [enemy] = await stage(swordAndBow, { stats: { spellcasting: SHIELD }, apart: 4 });
  const note = await tableSwing(swordAndBow, enemy, 7, { weapon: "Longbow" });
  assert.match(note, /casts Shield/, note);
  assert.ok(shieldUp(enemy));
});

for (const condition of ["invisible", "hidden"]) {
  await row(`819-unseen-attacker-parried:${condition}`, {
    pr: 819,
    limit: "An invisible attacker can be parried on real dice. That path passes attackerUnseen: false. opportunity-strike.ts does the same (read only).",
    rule: "SRD 5.1 Bandit Captain, Parry: \"To do so, the captain must see the attacker\".",
  }, async () => {
    const [enemy] = await stage(swordAndBow, { stats: { traits: [PARRY] } });
    world.patch(swordAndBow.id, { conditions: [condition] });
    const note = await tableSwing(swordAndBow, enemy, [7, 7], { weapon: "Longsword" });
    assert.match(note, /HIT/, note);
    assert.ok(!reactionSpent(enemy), "entered dice: the creature parried an attacker it cannot see");
    const [other] = await stage(swordAndBow, { stats: { traits: [PARRY] } });
    world.patch(swordAndBow.id, { conditions: [condition] });
    world.clearDice();
    world.dice(7, 7, 5);
    resolvePcOpportunityAttacks(world.campaign(), other.id, { x: 5, y: 6 }, { x: 5, y: 8 }, [{ x: 5, y: 7 }, { x: 5, y: 8 }]);
    world.clearDice();
    assert.ok(!reactionSpent(other), "an opportunity attack: the creature parried an attacker it cannot see");
  });
}

for (const real of [false, true]) {
  await row(`819-parry-and-shield-not-steady:${real ? "entered dice" : "server's dice"}`, {
    pr: 819,
    limit: "A creature holding both Parry and Shield isn't steady. With Foe Slayer +1, a d8 hits, d9 and d10 miss, and a d11 hits.",
    rule: "A better roll never misses where a worse one hits (scripts/test-enforce-foe-slayer-parry.mjs states it for Parry alone).",
  }, async () => {
    const keen = slayer(12);
    const results = [];
    for (let face = 4; face <= 14; face += 1) {
      const [enemy] = await stage(keen, { stats: { traits: [PARRY], spellcasting: SHIELD } });
      let hit;
      if (real) {
        hit = /\bHIT\b/.test(await tableSwing(keen, enemy, face, { weapon: "Longsword" }));
        for (const open of table.openRolls(keen)) await table.enter(keen, open, { fallback: "digital" });
      } else {
        const swing = await kit.swing(keen.id, enemy.id, [face, 4], { weapon: "Longsword" });
        assert.equal(swing.ok, true, swing.error);
        hit = swing.result.hit === true;
      }
      results.push([face, hit]);
    }
    const firstHit = results.findIndex(([, hit]) => hit);
    const later = results.slice(firstHit).filter(([, hit]) => !hit).map(([face]) => face);
    assert.ok(firstHit >= 0, `nothing hits: ${JSON.stringify(results)}`);
    assert.deepEqual(later, [], `a d${results[firstHit][0]} hits and better rolls miss: ${JSON.stringify(results)}`);
  });
}

for (const real of [false, true]) {
  await row(`818-foe-slayer-beats-every-parry:${real ? "entered dice" : "server's dice"}`, {
    pr: 818,
    limit: "Parry and Foe Slayer (read only, not run). A hit Parry turned into a miss still has a total at or above the AC, so rescueMiss always answers \"foe slayer\". Foe Slayer then beats any Parry, with the enemy's reaction already spent.",
    rule: "SRD 5.1 Bandit Captain, Parry: \"The captain adds 2 to its AC against one melee attack that would hit it.\" Foe Slayer's bonus has to reach the raised AC.",
  }, async () => {
    const keen = slayer(12);
    const results = [];
    for (let face = 5; face <= 12; face += 1) {
      const [enemy] = await stage(keen, { stats: { traits: [PARRY] } });
      let hit;
      if (real) {
        hit = /\bHIT\b/.test(await tableSwing(keen, enemy, face, { weapon: "Longsword" }));
        for (const open of table.openRolls(keen)) await table.enter(keen, open, { fallback: "digital" });
      } else {
        const swing = await kit.swing(keen.id, enemy.id, [face, 4], { weapon: "Longsword" });
        assert.equal(swing.ok, true, swing.error);
        hit = swing.result.hit === true;
      }
      results.push([face, hit]);
    }
    // +6, Foe Slayer +1, AC 13 and 15 with the Parry: a d8 (14, 15 lifted) is the first to land.
    const firstHit = results.findIndex(([, hit]) => hit);
    assert.deepEqual(results.slice(firstHit).filter(([, hit]) => !hit), [], JSON.stringify(results));
    assert.equal(results.find(([face]) => face === 7)?.[1], false, `a 13 lifted to 14 beats a Parry that makes the AC 15: ${JSON.stringify(results)}`);
  });
}

await row("819-foe-slayer-widened-critical", {
  pr: 819,
  limit: "Foe Slayer on a widened critical range. A natural 19 lifted by Foe Slayer isn't treated as a critical.",
  rule: "SRD 5.1 Champion, Improved Critical: \"your weapon attacks score a critical hit on a roll of 19 or 20.\"",
}, async () => {
  const champion = world.addHero({ class: "fighter", subclass: "Champion", level: 5, maxHp: 44, abilities: { str: 16, wis: 16 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1 }] });
  world.patch(champion.id, { features: [...world.sheet(champion.id).features, { name: "Foe Slayer", description: "" }, { name: "Favored Enemy: humanoids", description: "" }] });
  // 19 + 6 = 25 against AC 27: a miss that Foe Slayer's +3 lifts.
  const [enemy] = await stage(champion, { enemy: { ac: 27 } });
  const swing = await kit.swing(champion.id, enemy.id, [19, 4, 4], { weapon: "Longsword" });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.hit, true, JSON.stringify(swing.result).slice(0, 240));
  // A 19 is in the Champion's range whatever made it hit (WAVE1 R2: "A
  // natural 19 for a Champion that hits because of Foe Slayer is a critical
  // hit"), overturning #819's reading.
  assert.ok(swing.result.crit || swing.result.critical, `the lifted 19 is a critical hit: ${JSON.stringify(swing.result).slice(0, 240)}`);
});

// ---- #820 ----

await row("820-critical-target-dies-before-damage", {
  pr: 820,
  limit: "A critical whose target dies before its damage is entered opens nothing (reproduced). The digital path has no such window.",
  rule: "SRD 5.1 Great Weapon Master: \"On your turn, when you score a critical hit with a melee weapon or reduce a creature to 0 hit points with one, you can make one melee weapon attack as a bonus action.\"",
}, async () => {
  const great = fighter(["Great Weapon Master"], [{ name: "Greatsword", qty: 1 }]);
  const opened = () => JSON.stringify(world.encounter()?.turnBudget ?? {});
  const [target] = await stage(great, { count: 2 });
  const server = await kit.swing(great.id, target.id, [20, 3, 3, 3, 3], { weapon: "Greatsword" });
  assert.equal(server.ok, true, server.error);
  const onServer = opened();
  assert.match(onServer, /great weapon master/i, "the server's dice open no bonus attack on a critical, so this row proves nothing");
  const [enemy] = await stage(great, { count: 2 });
  await table.withRealDice(great, async () => {
    const parked = await world.invoke("pc_attack", { characterId: great.id, targetEnemyId: enemy.id, weapon: "Greatsword" });
    assert.equal(parked.ok, true, parked.error);
    const hit = await table.enter(great, table.openRolls(great, "attack")[0], [20]);
    assert.equal(hit.status, 200, JSON.stringify(hit.json));
    // Something else kills it before the damage dice are entered.
    kit.setEnemy(enemy.id, { currentHp: 1 });
    const fell = await world.invoke("apply_damage", { enemyId: enemy.id, amount: 20, type: "fire", reason: "the brazier tips" });
    assert.equal(fell.ok, true, fell.error);
    for (const open of table.openRolls(great, "damage")) await table.enter(great, open, [3, 3, 3, 3]);
  });
  assert.match(opened(), /great weapon master/i, `the critical was scored, and no bonus attack is open: ${opened()}`);
});

await row("820-end-turn-on-a-parked-attack", {
  pr: 820,
  limit: "`endTurn: true` on a parked attack doesn't end the turn on the console path (reproduced).",
  rule: "One declaration, one result, whichever dice: an attack sent with endTurn ends the turn once it has landed.",
}, async () => {
  const who = fighter();
  const [enemy] = await stage(who);
  const server = await kit.swing(who.id, enemy.id, [2], { weapon: "Longsword", endTurn: true });
  assert.equal(server.ok, true, server.error);
  const serverMoved = kit.current()?.characterId !== who.id;
  const [again] = await stage(who);
  await table.withRealDice(who, async () => {
    const parked = await world.invoke("pc_attack", { characterId: who.id, targetEnemyId: again.id, weapon: "Longsword", endTurn: true });
    assert.equal(parked.ok, true, parked.error);
    const out = await table.enter(who, table.openRolls(who, "attack")[0], [2]);
    assert.equal(out.status, 200, JSON.stringify(out.json));
  });
  const tableMoved = kit.current()?.characterId !== who.id;
  assert.equal(tableMoved, serverMoved, `the server's dice ${serverMoved ? "end" : "keep"} the turn and entered dice ${tableMoved ? "end" : "keep"} it`);
});

await row("820-same-turn-come-round", { pr: 820, limit: "The same turn, come round again.", rule: "-" }, async () => {});

// ---- #822 ----

await row("822-cover-as-parked", {
  pr: 822,
  limit: "Cover stays as it was when the roll parked. If the creature giving cover moves off the line between parts, real dice still count the cover.",
  rule: "SRD 5.1, Cover: \"A target with half cover has a +2 bonus to AC\" while the obstacle stands between.",
}, async () => {
  const [enemy, between] = await stage(swordAndBow, { count: 2, apart: 4 });
  kit.place(between.id, 5, 7);
  const part = { targetEnemyId: enemy.id, weapon: "Longbow" };
  const [first, second] = await twoParts(swordAndBow, [part, part], 2, 8, () => kit.place(between.id, 15, 12));
  assert.match(first, /vs AC 15/, first);
  // As ruled: the shot was loosed with the creature in the way.
  assert.match(second, /vs AC 15/, second);
});

await row("822-skulker-second-part-unseen", {
  pr: 822,
  limit: "A hidden Skulker's second part stays unseen. With a bow part then a sword part, the bow's hit clears hiding, but the sword still draws no Parry.",
  rule: "SRD 5.1, Unseen Attackers: \"If you are hidden ... when you make an attack, you give away your location when the attack hits or misses.\" Parry: \"the captain must see the attacker\".",
}, async () => {
  const skulker = fighter(["Skulker"], [{ name: "Longsword", qty: 1 }, { name: "Longbow", qty: 1 }, { name: "Arrows", qty: 20 }]);
  const [enemy] = await stage(skulker, { stats: { traits: [PARRY] } });
  world.patch(skulker.id, { conditions: ["hidden"] });
  // The bow beside the creature: advantage for hiding against disadvantage for the reach.
  const parts = [{ targetEnemyId: enemy.id, weapon: "Longbow" }, { targetEnemyId: enemy.id, weapon: "Longsword" }];
  // The server's dice first: the bow's hit, its damage, then the sword's 13.
  world.clearDice();
  // Hidden, the bow rolls two d20s; then its damage, then the sword's d20.
  world.dice(15, 15, 4, 7, 4);
  const server = await world.invoke("pc_attack", { characterId: skulker.id, attacks: parts });
  world.clearDice();
  if (!server.ok) throw new Error(`the rig: ${server.error}`);
  if (!reactionSpent(enemy)) throw new Error(`the rig: on the server's dice the sword part draws no Parry either: ${JSON.stringify(server.result).slice(0, 400)}`);
  const [again] = await stage(skulker, { stats: { traits: [PARRY] } });
  world.patch(skulker.id, { conditions: ["hidden"] });
  parts.forEach((part) => { part.targetEnemyId = again.id; });
  const notes = await twoParts(skulker, parts, 15, 7);
  assert.ok(!world.sheet(skulker.id).conditions.includes("hidden"), "the bow's hit gave the attacker away");
  assert.match(notes[1], /MISS/, `the sword's 13 should meet the Parry of a creature that now sees its attacker: ${notes[1]}`);
  assert.ok(reactionSpent(again));
});

for (const real of [false, true]) {
  await row(`822-ten-conditions-shield:${real ? "entered dice" : "server's dice"}`, {
    pr: 822,
    limit: "A creature already holding 10 conditions spends its reaction on a Shield that doesn't stick, because only 10 are kept.",
    rule: "SRD 5.1 Shield: \"Until the start of your next turn, you have a +5 bonus to AC, including against the triggering attack\".",
  }, async () => {
    // Ten marks that change no roll.
    const ten = ["muddy", "singed", "ringing ears", "soaked", "ink-stained", "winded", "dusty", "chilled to the bone", "itching", "smelling of smoke"];
    const [enemy] = await stage(swordAndBow, { stats: { spellcasting: SHIELD }, enemy: { conditions: ten } });
    if (real) {
      const part = { targetEnemyId: enemy.id, weapon: "Longsword" };
      const [, second] = await twoParts(swordAndBow, [part, part], 7, 7);
      assert.ok(!reactionSpent(enemy) || /vs AC 18/.test(second), `the reaction went on a Shield that did not stand against the next part: ${second}`);
    } else {
      const swing = await kit.swing(swordAndBow.id, enemy.id, [7, 4], { weapon: "Longsword" });
      assert.equal(swing.ok, true, swing.error);
      assert.ok(!reactionSpent(enemy) || shieldUp(enemy), `the reaction is spent and no Shield stands: ${JSON.stringify(kit.enemy(enemy.id).conditions)}`);
    }
  });
}

await row("822-invisible-by-another-name", {
  pr: 822,
  limit: "From reading, a condition spelled \"Invisible (potion)\" now counts as unseen for Parry, while the advantage check matches only the exact word. Not run.",
  rule: "SRD 5.1, Invisible: \"Attack rolls against the creature have disadvantage, and the creature's attack rolls have advantage.\" One reading of who is unseen for both.",
}, async () => {
  const [enemy] = await stage(swordAndBow, { stats: { traits: [PARRY] } });
  world.patch(swordAndBow.id, { conditions: ["invisible (potion)"] });
  const swing = await kit.swing(swordAndBow.id, enemy.id, [7, 7, 4], { weapon: "Longsword" });
  assert.equal(swing.ok, true, swing.error);
  const d20s = swing.toHit?.breakdown?.terms?.find((term) => term.sides === 20)?.dice?.length;
  const parried = reactionSpent(enemy);
  assert.equal(d20s === 2, !parried, `the attack rolled ${d20s} d20 (advantage for being unseen: ${d20s === 2}) and the creature ${parried ? "parried, so it saw them" : "did not parry, so it did not"}`);
});

const lightsOut = () => table.lightBoard([]);
for (const real of [false, true]) {
  await row(`822-parry-in-the-dark:${real ? "entered dice" : "server's dice"}`, {
    pr: 822,
    limit: "A creature that can't see in the dark still Parries. A dark board and a creature with no darkvision: the attack gets advantage for it, and the creature parries anyway, on both dice paths and on an opportunity attack.",
    rule: "SRD 5.1 Bandit Captain, Parry: \"To do so, the captain must see the attacker\".",
  }, async () => {
    // The attacker sees in the dark and the creature does not.
    const owl = fighter([], [{ name: "Longsword", qty: 1 }], { race: "elf" });
    world.patch(owl.id, { features: [...world.sheet(owl.id).features, { name: "Darkvision (60 ft)", source: "race" }] });
    // In the light the same creature parries the same 13: the rig's own check.
    const [lit] = await stage(owl, { stats: { traits: [PARRY], senses: { passivePerception: 10 } } });
    const seen = await kit.swing(owl.id, lit.id, [7, 4], { weapon: "Longsword" });
    if (!seen.ok || !reactionSpent(lit)) throw new Error(`the rig: in the light the creature does not parry: ${JSON.stringify(seen.result).slice(0, 240)}`);
    const [enemy] = await stage(owl, { stats: { traits: [PARRY], senses: { passivePerception: 10 } } });
    lightsOut();
    if (real) {
      const note = await tableSwing(owl, enemy, 7, { weapon: "Longsword" });
      assert.match(note, /HIT/, note);
    } else {
      const swing = await kit.swing(owl.id, enemy.id, [7, 7, 4], { weapon: "Longsword" });
      assert.equal(swing.ok, true, swing.error);
      assert.equal(swing.result.hit, true, JSON.stringify(swing.result).slice(0, 240));
    }
    assert.ok(!reactionSpent(enemy), "blind in the dark, the creature parried an attacker it cannot see");
  });
}

// ---- #824 ----

await row("824-opportunity-light-at-landing", {
  pr: 824,
  limit: "An opportunity attack reads the light where the creature ends its move.",
  rule: "SRD 5.1, Opportunity Attacks: \"You can make an opportunity attack when a hostile creature that you can see moves out of your reach ... the attack occurs right before the creature leaves your reach.\"",
}, async () => {
  const { resolveOpportunityAttacks } = await import("../src/lib/dm/opportunity.ts");
  const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
  const walk = [{ x: 5, y: 4 }, { x: 5, y: 3 }, { x: 5, y: 2 }];
  // A lamp over the square the walker stands on, and dark three squares on:
  // the watcher, with no darkvision, sees the walker go and not where it lands.
  const blind = { stats: { senses: { passivePerception: 10 } } };
  {
    // A character walking off a creature (the move route, token-rules.ts).
    const human = fighter();
    const [watcher] = await stage(human, blind);
    table.lightBoard([{ x: 5, y: 5, bright: 1 }]);
    kit.place(human.id, 5, 2);
    world.clearDice();
    world.dice(15, 4);
    const out = resolveOpportunityAttacks(getCampaignById(world.campaignId), human.id, { x: 5, y: 5 }, { x: 5, y: 2 }, false, walk);
    world.clearDice();
    assert.ok(reactionSpent(watcher), `a creature that saw the character leave its reach in the lamplight made no opportunity attack: ${JSON.stringify(out.notes)}`);
  }
  {
    // A creature walking off a character (move_token, opportunity.ts resolvePcOpportunityAttacks).
    const human = fighter();
    const [walker] = await stage(human, blind);
    table.lightBoard([{ x: 5, y: 6, bright: 1 }]);
    kit.place(walker.id, 5, 9);
    world.clearDice();
    world.dice(15, 4);
    const notes = resolvePcOpportunityAttacks(world.campaign(), walker.id, { x: 5, y: 6 }, { x: 5, y: 9 }, [{ x: 5, y: 7 }, { x: 5, y: 8 }, { x: 5, y: 9 }]);
    world.clearDice();
    assert.ok(world.encounter().reactionsUsed.some((key) => key.includes(human.id)), `a character who saw the creature leave their reach in the lamplight made no opportunity attack: ${JSON.stringify(notes)}`);
  }
});
await row("824-large-token-origin-tile", { pr: 824, limit: "Large tokens read only their origin tile, and conjured melee such as Spiritual Weapon reads the caster's token.", rule: "-" }, async () => {});

// ---- #825 ----

const acidArrow = async (faces, damage) => {
  const [enemy] = await stage(mage, { apart: 3 });
  let note = "";
  await table.withRealDice(mage, async () => {
    const parked = await world.invoke("pc_attack", { characterId: mage.id, targetEnemyId: enemy.id, spell: "Acid Arrow", level: 2 });
    assert.equal(parked.ok, true, parked.error);
    const hit = await table.enter(mage, table.openRolls(mage, "attack")[0], faces);
    note = hit.note;
    const [blow] = table.openRolls(mage, "damage");
    if (blow) note += ` ${(await table.enter(mage, blow, damage)).note}`;
  });
  return { enemy: kit.enemy(enemy.id), note };
};
await row("825-half-on-a-miss", {
  pr: 822,
  limit: "Acid Arrow's half damage on a miss is missing on real dice. Curving Shot has no real-dice equivalent either (read only).",
  rule: "SRD 5.1 Acid Arrow: \"On a miss, the arrow splashes the target with acid for half as much of the initial damage and no damage at the end of its next turn.\"",
}, async () => {
  // +7 to hit: a 2 is 9 against AC 13. 4d4 = 12, and half of it lands.
  const out = await acidArrow([2], [3, 3, 3, 3]);
  assert.equal(out.enemy.currentHp, 394, out.note);
});
await row("825-natural-1-no-half", {
  pr: 825,
  limit: "A natural 1 gets no half, on either dice.",
  rule: "SRD 5.1 Acid Arrow: \"On a miss, the arrow splashes the target with acid for half as much of the initial damage\"; Attack Rolls: \"If the d20 roll for an attack is a 1, the attack misses regardless of any modifiers or the target's AC.\"",
}, async () => {
  // A natural 1 is a miss, and the miss deals half (WAVE1 R1): 12 of acid
  // makes 6.
  const out = await acidArrow([1], [3, 3, 3, 3]);
  assert.equal(out.enemy.currentHp, 394, out.note);
});
await row("825-spell-resistance-ignored", {
  pr: 825,
  limit: "Elemental Adept and \"damage from spells\" resistance are ignored (on an ordinary real-dice hit).",
  rule: "A creature's resistance halves the damage of the type it resists, whichever dice rolled it (SRD 5.1, Damage Resistance and Vulnerability).",
}, async () => {
  const out = await both(mage, { args: { spell: "Fire Bolt" }, toHit: 18, damage: [5, 5], setUp: { stats: { resist: "fire" }, apart: 3 } });
  sameWorld(out);
  assert.equal(out.table.foe.hp, 395, "2d10 of 10 fire against resistance is 5");
});
await row("825-damage-lands-after-the-turn", {
  pr: 825,
  limit: "A damage roll still lands after the turn has moved on.",
  rule: "A hit entered on real dice has landed; its damage is the same blow, whenever the dice are entered.",
}, async () => {
  const who = fighter();
  const [enemy] = await stage(who);
  await table.withRealDice(who, async () => {
    const parked = await world.invoke("pc_attack", { characterId: who.id, targetEnemyId: enemy.id, weapon: "Longsword" });
    assert.equal(parked.ok, true, parked.error);
    const hit = await table.enter(who, table.openRolls(who, "attack")[0], [15]);
    assert.equal(hit.status, 200, JSON.stringify(hit.json));
    kit.giveTurn(world.sheets().find((sheet) => sheet.id !== who.id).id);
    const landed = await table.enter(who, table.openRolls(who, "damage")[0], [5]);
    assert.equal(landed.status, 200, JSON.stringify(landed.json));
  });
  // As ruled: 5 + 3 lands though the turn is another's.
  assert.equal(kit.enemy(enemy.id).currentHp, 392);
});
await row("825-notes-missing-bardic-and-concentration", { pr: 825, limit: "A Bardic Inspiration die spent on the to-hit roll is missing from the note. Concentration results are missing from the note. No last-hit record is kept.", rule: "-" }, async () => {});

await kit.endFight();
world.close();
finish();
