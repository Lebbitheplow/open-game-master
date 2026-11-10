// The four-path attack differential behind
// scripts/test-enforce-sweep-dice-paths*.mjs (see the first of them for what
// it holds). One function, so the feats' rows and the rest run as two suites
// inside the time a suite is given.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { call } from "./enforce-campaign.mjs";
import { openWorld } from "./enforce-world.mjs";
import { suite } from "./enforce-harness.mjs";
import { combatKit, TRAINED } from "./enforce-combat.mjs";
import { diffState, forceDice, installDiceSpy, repoRoot, tableState } from "./sweep-dice.mjs";


// Rows the four paths leave differently today, by row id. None: a blow with
// no dice (a Blowgun, Contagion, Ray of Enfeeblement) lands at the to-hit
// stage on entered dice too (src/lib/dm/pc-attack-parked.ts noDiceIn).
const KNOWN_ROWS = {};
// Why pc_attack alone cannot play a row: the call needs something this sweep
// does not stage. A row refused for one of these on the server's dice is
// counted under it; a row refused for any other reason fails.
const UNPLAYABLE = [
  [/Spell attacks need the spell's damage dice/, "a pack spell whose damage the tables do not know: pc_attack asks the GM for the dice"],
  [/needs an? .* worth at least/i, "a costly material component"],
  [/is cast as a reaction/, "a reaction spell"],
  [/takes 1 minute to cast|takes \d+ (minutes?|hours?) to cast/, "a long casting time"],
];

export async function runPaths(suiteName, kinds) {
  const { test, gap, finish } = suite(suiteName);
  installDiceSpy();
  const world = await openWorld({ campaign: { maxPlayers: 16 }, gameSettings: { dicePolicy: "real_allowed" } });
  const kit = await combatKit(world);
  const { setMemberHoldRolls, setMemberRealDice } = await import("../../src/lib/db/campaigns.ts");
  const { listOpenPendingRolls } = await import("../../src/lib/db/dm-turns.ts");
  const { getDatabase } = await import("../../src/lib/db/core.ts");
  const { entryDice } = await import("../../src/lib/dice.ts");
  const { SRD_WEAPONS } = await import("../../src/lib/srd/weapons.ts");
  const { ammoKindForWeapon } = await import("../../src/lib/srd/ammunition.ts");
  const { optionsOfKind } = await import("../../src/lib/srd/options.ts");
  const { spellMechanicsFor, spellRowsOnList } = await import("../../src/lib/content/index.ts");
  // How the engine itself reads a spell: its authored block, else the pack's
  // prose (content/index.ts spellMechanicsFor).
  const mechOf = (name) => spellMechanicsFor({ spell: name })?.mech ?? null;
  const { adjudication } = await import("../../src/lib/dm/invoke-catalog.ts");
  const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");
  const DEBUG = Boolean(process.env.ODM_SWEEP_DEBUG);
  const ONLY = process.env.ODM_SWEEP_ONLY ? new RegExp(process.env.ODM_SWEEP_ONLY) : null;

  const PATHS = ["server", "entered", "digital", "held"];
  const FACES = { hit: 15, crit: 20, miss: 2 };
  const OTHER = 3;

  // ---- the table ----

  const AMMO = [{ name: "Arrows", qty: 20 }, { name: "Crossbow bolts", qty: 20 }, { name: "Sling bullets", qty: 20 }, { name: "Blowgun needles", qty: 20 }];
  const SLOTS = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => [level, { max: 2, used: 0 }]));
  const STATS = { str: 16, dex: 16, con: 14, int: 16, wis: 14, cha: 16 };
  const make = (name, extra) => world.addHero({ name, level: 9, maxHp: 80, abilities: STATS, proficiencies: TRAINED, ...extra });
  const HEROES = {
    fighter: make("Fen", { class: "fighter" }),
    master: make("Mara", { class: "fighter", subclass: "battle_master" }),
    barbarian: make("Bru", { class: "barbarian" }),
    paladin: make("Pell", { class: "paladin", spellcasting: { ability: "cha", slots: SLOTS, prepared: ["Bless"], known: [], cantrips: [] } }),
    monk: make("Moe", { class: "monk" }),
    mage: make("Wil", { class: "wizard", spellcasting: { ability: "int", slots: SLOTS, prepared: [], known: [], cantrips: [] } }),
  };
  const BASE = Object.fromEntries(Object.entries(HEROES).map(([key, hero]) => [key, world.sheet(hero.id)]));
  await kit.fight(1, { heroFaces: Object.fromEntries(Object.values(HEROES).map((hero, index) => [hero.id, 19 - index])) });
  const [enemy] = world.enemies();
  const ENEMY_BASE = kit.enemy(enemy.id);

  function gearFor(weapon) {
    return [{ name: weapon, qty: 3, equipped: true }, ...AMMO];
  }

  function reset(key, sheetPatch, ranged) {
    const hero = HEROES[key];
    getDatabase().prepare("DELETE FROM pending_rolls WHERE campaign_id = ?").run(world.campaignId);
    setMemberRealDice(world.campaignId, hero.userId, false);
    setMemberHoldRolls(world.campaignId, hero.userId, false);
    const base = BASE[key];
    world.patch(hero.id, {
      currentHp: 80, tempHp: 0, conditions: [], conditionMeta: {}, concentration: null, inspiration: false,
      feats: base.feats, features: base.features, resources: base.resources, equipment: base.equipment, spellcasting: base.spellcasting,
      ...sheetPatch,
    });
    kit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400, conditions: [], conditionMeta: {}, stats: { ...ENEMY_BASE.stats } });
    getDatabase().prepare("UPDATE encounter_enemies SET status = 'alive' WHERE id = ?").run(enemy.id);
    kit.giveTurn(hero.id);
    kit.place(hero.id, 5, 5);
    kit.place(enemy.id, 5, ranged ? 9 : 6);
    world.clearDice();
    return hero;
  }

  // One attack by one path. What it left, or why it could not be made.
  async function attackBy(dicePath, key, { sheetPatch = {}, args, ranged = false }, face) {
    const hero = reset(key, sheetPatch, ranged);
    if (dicePath === "entered" || dicePath === "digital") setMemberRealDice(world.campaignId, hero.userId, true);
    if (dicePath === "held") setMemberHoldRolls(world.campaignId, hero.userId, true);
    forceDice({ d20: face, enemyD20: 1, other: OTHER });
    try {
      const out = await world.invoke("pc_attack", { characterId: hero.id, targetEnemyId: enemy.id, ...args });
      if (!out.ok) {
        return { refused: String(out.error).slice(0, 160) };
      }
      const asked = [];
      for (let step = 0; step < 8; step += 1) {
        const pending = listOpenPendingRolls(world.campaignId).filter((entry) => entry.userId === hero.userId).at(-1);
        if (!pending) break;
        asked.push(`${pending.kind} ${pending.expression}`);
        world.signIn({ id: hero.userId });
        const body = dicePath === "entered" ? { dice: entryDice(pending.expression).map((sides) => (sides === 20 ? face : Math.min(sides, OTHER))) } : { fallback: "digital" };
        const landed = await call(submitRoute, "POST", body, { campaignId: world.campaignId, pendingRollId: pending.id });
        if (landed.status !== 200) {
          return { error: `${pending.kind} ${pending.expression} was not taken (${landed.status} ${JSON.stringify(landed.json).slice(0, 140)})`, asked };
        }
      }
      const struck = (world.encounter()?.turnBudget?.struck ?? []).map((swing) => ({ hit: swing.hit, crit: swing.crit ?? false }));
      return { state: { ...tableState(world, { heroIds: [hero.id] }), struck }, asked };
    } finally {
      forceDice(null);
      setMemberRealDice(world.campaignId, hero.userId, false);
      setMemberHoldRolls(world.campaignId, hero.userId, false);
    }
  }

  // Every way the four paths disagree over a row's cases.
  async function differences(entry) {
    const found = [];
    let made = 0;
    for (const variant of entry.cases) {
      for (const [faceName, face] of Object.entries(FACES)) {
        if (variant.faces && !variant.faces.includes(faceName)) continue;
        const server = await attackBy("server", entry.hero, variant, face);
        if (server.refused) {
          found.push({ setup: `${variant.label} (${faceName}): refused on the server's dice: ${server.refused}` });
          continue;
        }
        made += 1;
        for (const dicePath of PATHS.slice(1)) {
          const other = await attackBy(dicePath, entry.hero, variant, face);
          const where = `${variant.label}, ${faceName}, ${dicePath}`;
          if (other.refused || other.error) {
            found.push({ diff: `${where}: ${other.refused ?? other.error}` });
            continue;
          }
          const diff = diffState(server.state, other.state);
          if (diff.length) {
            found.push({ diff: `${where}: ${diff.slice(0, 3).join("; ")} [asked ${other.asked.join(" then ")}]` });
          }
        }
      }
    }
    return { found, made };
  }

  // ---- the rows ----

  const rows = [];
  const SKIP = {};
  const weaponCase = (weapon) => {
    const row = SRD_WEAPONS.find((entry) => entry.name === weapon);
    // A net's whole range is 15 feet: it is thrown from beside the creature.
    return { label: weapon, args: { weapon }, ranged: row?.kind === "ranged" && (row.longRangeFt ?? row.rangeFt ?? 0) >= 20, sheetPatch: { equipment: gearFor(weapon) } };
  };

  // Every feat, on a heavy blade, a finesse blade, a hammer and a bow.
  const featsFile = JSON.parse(fs.readFileSync(path.join(repoRoot, "src/lib/srd/authored-feats.json"), "utf8"));
  const FEATS = (Array.isArray(featsFile) ? featsFile : Object.values(featsFile).flat()).map((feat) => feat?.name).filter(Boolean);
  for (const feat of FEATS) {
    rows.push({
      id: `feat.${feat}`,
      hero: "fighter",
      cases: ["Greatsword", "Rapier", "Warhammer", "Longbow"].map((weapon) => {
        const base = weaponCase(weapon);
        return { ...base, sheetPatch: { ...base.sheetPatch, feats: [feat] } };
      }),
    });
  }

  // Every weapon.
  for (const weapon of SRD_WEAPONS) {
    rows.push({ id: `weapon.${weapon.name}`, hero: "fighter", cases: [weaponCase(weapon.name)] });
  }

  // Every maneuver, as a Battle Master who picked it.
  for (const option of optionsOfKind("maneuver")) {
    const name = option.name;
    rows.push({
      id: `maneuver.${name}`,
      hero: "master",
      cases: [{
        ...weaponCase("Longsword"),
        label: name,
        args: { weapon: "Longsword", maneuver: name },
        sheetPatch: {
          equipment: gearFor("Longsword"),
          features: [...BASE.master.features.filter((feature) => !/^maneuver/i.test(feature.name)), { name: "Combat Superiority", source: "subclass" }, { name: `Maneuver: ${name}`, source: "choice" }],
          resources: { ...BASE.master.resources, sub_superiority_dice: { max: 5, used: 0 } },
        },
      }],
    });
  }

  // Every attack-roll spell the tables know.
  const SPELLS = [...new Set(["wizard", "sorcerer", "warlock", "cleric", "druid", "bard", "paladin", "ranger"].flatMap((list) => spellRowsOnList(list, []).map((entry) => entry.name)))]
    .filter((name) => mechOf(name)?.resolution === "attack")
    .sort();
  for (const spell of SPELLS) {
    rows.push({
      id: `spell.${spell}`,
      hero: "mage",
      cases: [{ label: spell, args: { spell }, ranged: mechOf(spell).attack !== "melee" && !/touch|grasp|inflict|contagion|primal savagery|thorn whip/i.test(spell), sheetPatch: { spellcasting: { ...BASE.mage.spellcasting, prepared: [spell], known: [spell], cantrips: [spell] } } }],
    });
  }

  // The options of the pc_attack form: one row for each field that changes the
  // attack, on a hero who can use it. A field with no hero here is in SKIP.
  const OPTION = {
    twoHanded: { hero: "fighter", ...weaponCase("Longsword"), args: { weapon: "Longsword", twoHanded: true } },
    improvised: { hero: "fighter", label: "a chair leg", args: { weapon: "chair leg", improvised: true }, sheetPatch: {} },
    nonlethal: { hero: "fighter", ...weaponCase("Longsword"), args: { weapon: "Longsword", nonlethal: true } },
    advantage: { hero: "fighter", ...weaponCase("Longsword"), args: { weapon: "Longsword", advantage: "advantage", advantageReason: "the creature is distracted" } },
    powerAttack: { hero: "fighter", ...weaponCase("Greatsword"), args: { weapon: "Greatsword", powerAttack: true }, sheetPatch: { equipment: gearFor("Greatsword"), feats: ["Great Weapon Master"] } },
    reckless: { hero: "barbarian", ...weaponCase("Greataxe"), args: { weapon: "Greataxe", reckless: true } },
    smite: { hero: "paladin", ...weaponCase("Longsword"), args: { weapon: "Longsword", smite: 1 } },
    stunningStrike: { hero: "monk", ...weaponCase("Quarterstaff"), args: { weapon: "Quarterstaff", stunningStrike: true } },
    damage: { hero: "fighter", label: "a named blow", args: { weapon: "Longsword", damage: "2d6+1", damageType: "fire" }, sheetPatch: { equipment: gearFor("Longsword") } },
  };
  Object.assign(SKIP, {
    "spell.Plane Shift": "needs a forked rod worth 250 gp attuned to a plane",
    "spell.Green-Flame Blade": "a weapon attack the spell rides: pc_attack asks for its damage dice",
    "spell.Magic Stone": "the stones are thrown as weapons: pc_attack asks for the damage dice",
    "spell.Vampiric Touch": "its later attacks within the spell's minute cost no slot, so of four paths run inside one minute only the first pays: an artifact of this harness (checked by hand: with the clock moved on, each path pays). test-enforce-real-dice-parity.mjs holds its healing by hand",
    "option.weapon": "every weapon is a row above",
    "option.spell": "every attack-roll spell is a row above",
    "option.maneuver": "every maneuver is a row above",
    "option.damageType": "rides the damage row",
    "option.advantageReason": "rides the advantage row",
    "option.level": "a spell's slot level: the spell rows cast at the lowest",
    "option.characterId": "the attacker", "option.targetEnemyId": "the target",
    "option.luck": "the Lucky feat before the roll: the windows suite holds the after-the-roll card",
    "option.useInspiration": "needs Inspiration granted; the die is the same d20 at advantage",
    "option.strokeOfLuck": "needs a rogue of level 20",
    "option.stunShot": "test-enforce-real-dice-parity.mjs holds Stunning Sniper by hand",
    "option.charged": "needs a Dash earlier in the turn",
    "option.openHand": "needs Flurry of Blows opened first",
    "option.hurlThroughHell": "needs a Fiend warlock of level 14",
    "option.rapidStrike": "needs an Assassin of level 17 with advantage",
    "option.feature": "a workshop feature by name: none in this world",
  });
  for (const field of adjudication("pc_attack").fields) {
    const option = OPTION[field.name];
    if (option) {
      rows.push({ id: `option.${field.name}`, hero: option.hero, cases: [option] });
    } else if (!SKIP[`option.${field.name}`]) {
      rows.push({ id: `option.${field.name}`, hero: "fighter", cases: [], unplaced: true });
    }
  }

  // ---- what is known ----

  const ONE_PATH = '"Every die a player\'s character rolls goes through one path, whichever dice the seat uses": the attack\'s stages are shared by both dice paths (src/lib/dm/attack-swing.ts, attack-blow.ts, attack-record.ts, pull request #836), so the table is left the same whoever threw the dice';
  const KNOWN = KNOWN_ROWS;

  let attacks = 0;
  const unplayable = {};
  for (const entry of rows) {
    if (!kinds.includes(entry.id.split(".")[0]) || (ONLY && !ONLY.test(entry.id))) continue;
    if (SKIP[entry.id]) continue;
    const known = KNOWN[entry.id];
    const run = async () => {
      if (entry.unplaced) throw new Error(`${entry.id}: a pc_attack field with no row and no reason in SKIP`);
      const got = await differences(entry);
      attacks += got.made;
      if (DEBUG && got.found.length) {
        for (const line of got.found) console.log(`  DIFF ${entry.id}: ${line.diff ?? line.setup}`);
      }
      const broken = got.found.filter((line) => line.setup);
      if (!got.made && entry.cases.length) {
        const why = UNPLAYABLE.find(([pattern]) => pattern.test(broken[0]?.setup ?? ""));
        if (!why) {
          throw new Error(`${entry.id}: no case could be made on the server's dice: ${broken[0]?.setup}`);
        }
        unplayable[why[1]] = (unplayable[why[1]] ?? 0) + 1;
      }
      return got.found.filter((line) => line.diff).map((line) => line.diff);
    };
    if (known) {
      await gap(`paths.${entry.id}`, { rule: ONE_PATH, where: known.where, severity: known.severity, note: known.note }, async () => {
        const diffs = await run();
        assert.deepEqual(diffs, [], diffs.slice(0, 2).join(" | "));
      });
    } else {
      await test(`${entry.id}: the same on the server's dice, entered dice, Roll digitally and a held roll let go`, async () => {
        const diffs = await run();
        assert.deepEqual(diffs, [], `${diffs.length} difference(s): ${diffs.slice(0, 3).join(" | ")}`);
      });
    }
  }

  console.log(`${kinds.join(", ")} rows of ${rows.length} (${FEATS.length} feats, ${SRD_WEAPONS.length} weapons, ${optionsOfKind("maneuver").length} maneuvers, ${SPELLS.length} attack spells, ${Object.keys(OPTION).length} form options); attacks compared on four paths: ${attacks}; skipped with a reason: ${Object.keys(SKIP).length}; rows pc_attack alone cannot play: ${JSON.stringify(unplayable)}`);
  world.close();
  finish();
}
