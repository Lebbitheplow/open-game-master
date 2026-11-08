// A spell a workshop species gives, aimed at an enemy: an attack-roll spell
// through pc_attack and a saving-throw spell through cast_at_enemy, both for
// a spell of the whole species and for one its player's choice gives.
//
// The bug (play-test 2026-11-07, W1): a workshop species "Mistkin" whose
// choice gave Fire Bolt or Ray of Frost dealt the cantrip to the Hand, and
// playing it was refused: "Fire Bolt is not on W Ember Hexbinder's spell
// list; they cannot cast it." pc_attack read only the class lists
// (src/lib/dm/pc-attack-profile.ts), where the cast guard and cast_at_enemy
// read the species' grant too (src/lib/srd/granted-casts.ts). A fighter,
// with no Spellcasting feature at all, was refused as one who "cannot cast
// spells".
//
//   - a Mistkin fighter (Ember mist) makes Fire Bolt (the option's) and
//     Chill Touch (the species') spell attacks with Charisma, and casts
//     Sacred Flame (the option's) and Poison Spray (the species') at an
//     enemy's save;
//   - a Mistkin wizard (Frost mist) makes Ray of Frost, with Charisma and not
//     Intelligence;
//   - a spell of the option they did not pick is still refused, by the
//     reason it always was.
import assert from "node:assert/strict";
import { suite, abilityMod, proficiencyBonus } from "./lib/enforce-harness.mjs";
import { openCreation, PORTRAIT } from "./lib/enforce-creation.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { openBuilder } from "./lib/enforce-builder.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-species-spell-attacks");
const { world, call, libraryRoute, characters } = await openCreation();
const builder = await openBuilder();
const homebrewRoute = await world.route("homebrew");
const { packRaceOptions } = await import("../src/lib/content/race-options.ts");
const { withSpeciesVariant } = await import("../src/lib/content/species-variants.ts");
const { spellSaveDcFor } = await import("../src/lib/srd/index.ts");

const owner = world.owner;
// The play-test's Mistkin, with a spell of each kind on the species and on
// each option. Cantrips only: they arrive at 1st level and cost nothing.
const MISTKIN = {
  desc: "Folk born of the morning fog.",
  size: "Medium",
  speed: { walk: 30 },
  asi: [{ attributes: ["Dexterity"], value: 2 }],
  languages: ["Common"],
  traits: "**_Fog Born._** You are at home in the mist.",
  spells: { ability: "cha", spells: [{ spell: "Misty Step", level: 1 }, { spell: "Chill Touch", level: 1 }, { spell: "Poison Spray", level: 1 }] },
  variants: {
    label: "Mist heritage",
    options: [
      { name: "Ember mist", spells: { ability: "cha", spells: [{ spell: "Fire Bolt", level: 1 }, { spell: "Sacred Flame", level: 1 }] } },
      { name: "Frost mist", spells: { ability: "cha", spells: [{ spell: "Ray of Frost", level: 1 }] } },
    ],
  },
};
// The standard array, Charisma well above Intelligence, so the species'
// ability is told from the wizard's.
const FIGHTER = { str: 15, dex: 12, con: 13, int: 8, wis: 10, cha: 14 };
const WIZARD = { str: 8, dex: 14, con: 12, int: 13, wis: 10, cha: 15 };

const raceOf = (entry) => {
  const id = `homebrew:${entry.id}`;
  return packRaceOptions([{ slug: id, name: entry.name, documentSlug: "homebrew", document: "Homebrew", data: entry.data }], [id])[0];
};
function built(entry, variant, klass) {
  const wizard = klass === "wizard";
  const result = builder.build({
    race: withSpeciesVariant(raceOf(entry), variant),
    class: klass,
    background: "soldier",
    scores: wizard ? WIZARD : FIGHTER,
    chosenSkills: wizard ? ["arcana", "history"] : ["acrobatics", "perception"],
    // None of the species' spells on the wizard's own list.
    ...(wizard
      ? { cantrips: ["Mage Hand", "Light", "Prestidigitation"], spells: ["Magic Missile", "Shield", "Sleep", "Burning Hands", "Thunderwave", "Mage Armor"], bookPrepared: ["Magic Missile", "Shield"] }
      : { stylePicks: ["defense"] }),
    racialVariant: variant,
  });
  assert.equal(result.blocker, null, result.blocker?.message);
  return { ...result.sheet, portrait: PORTRAIT };
}
async function made(entry, variant, klass) {
  world.signIn(owner);
  const out = await call(libraryRoute, "POST", { level: 1, sheet: built(entry, variant, klass) });
  assert.equal(out.status, 201, JSON.stringify(out.json));
  return out.json.character;
}

world.signIn(owner);
const saved = await call(homebrewRoute, "POST", { kind: "race", name: "Mistkin", data: MISTKIN });
assert.equal(saved.status, 201, JSON.stringify(saved.json));
const species = saved.json.entry;

const table = await openWorld();
const kit = await combatKit(table);
const seat = (character, extra) => {
  const admitted = characters.admitLibraryCharacter(character, table.campaign(), owner.id, 3);
  assert.equal(admitted.ok, true, admitted.problems?.join(" | "));
  return table.addHero({ ...admitted.sheet, level: 3, equipment: [...admitted.sheet.equipment, { name: "Component pouch", qty: 1 }], ...extra });
};
const ember = seat(await made(species, "ember-mist", "fighter"), { name: "Ember" });
const frost = seat(await made(species, "frost-mist", "wizard"), { name: "Rime" });
await kit.fight(1);
const [enemy] = table.enemies();
kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
// Ten feet away: in reach of Poison Spray, not beside them.
kit.place(ember.id, 4, 4);
kit.place(frost.id, 4, 6);
kit.place(enemy.id, 6, 4);

// The species' to-hit at 3rd level: proficiency and Charisma.
const chaToHit = (scores) => proficiencyBonus(3) + abilityMod(scores.cha);

// A spell attack on the hero's own fresh turn, a 15 on the d20 and the
// damage rolled for real.
async function spellAttack(hero, spell) {
  kit.giveTurn(hero.id);
  return kit.swing(hero.id, enemy.id, [15], { spell });
}

await test("bug: a Mistkin fighter's Fire Bolt, from the Ember mist option, is a spell attack with Charisma", async () => {
  const shot = await spellAttack(ember, "Fire Bolt");
  assert.equal(shot.ok, true, shot.error);
  assert.ok(shot.toHit, "no attack roll was made");
  assert.equal(shot.toHit.total, 15 + chaToHit(FIGHTER), `to-hit ${shot.toHit.expression}`);
  assert.ok(shot.damage, "a hit dealt no damage");
  assert.match(shot.damage.expression, /^1d10\b/);
});

await test("bug: the species' own Chill Touch is a spell attack too", async () => {
  const shot = await spellAttack(ember, "Chill Touch");
  assert.equal(shot.ok, true, shot.error);
  assert.equal(shot.toHit?.total, 15 + chaToHit(FIGHTER), `to-hit ${shot.toHit?.expression}`);
});

await test("the option's Sacred Flame and the species' Poison Spray are cast at the enemy's save, at the species' DC", async () => {
  const dc = 8 + proficiencyBonus(3) + abilityMod(FIGHTER.cha);
  assert.equal(spellSaveDcFor(table.sheet(ember.id), "Sacred Flame"), dc);
  for (const [spell, saveAbility] of [["Sacred Flame", "dex"], ["Poison Spray", "con"]]) {
    kit.giveTurn(ember.id);
    const out = await table.invoke("cast_at_enemy", { characterId: ember.id, targetEnemyId: enemy.id, spell, saveAbility });
    assert.equal(out.ok, true, `${spell}: ${out.error}`);
    assert.equal(out.result.dc, dc, `${spell}: ${JSON.stringify(out.result)}`);
  }
});

await test("bug: a Mistkin wizard's Ray of Frost, from the Frost mist option, is cast with Charisma, not Intelligence", async () => {
  const shot = await spellAttack(frost, "Ray of Frost");
  assert.equal(shot.ok, true, shot.error);
  assert.equal(shot.toHit?.total, 15 + chaToHit(WIZARD), `to-hit ${shot.toHit?.expression}`);
});

await test("a spell of the option not picked is still refused, and nothing is rolled", async () => {
  const wizard = await spellAttack(frost, "Fire Bolt");
  assert.equal(wizard.ok, false, "the wizard cast the Ember option's Fire Bolt");
  assert.match(wizard.error, /Fire Bolt is not on Rime's spell list; they cannot cast it\./);
  assert.equal(wizard.toHit, null);
  const fighter = await spellAttack(ember, "Ray of Frost");
  assert.equal(fighter.ok, false, "the fighter cast the Frost option's Ray of Frost");
  assert.match(fighter.error, /Ember cannot cast spells\./);
  assert.equal(fighter.toHit, null);
});

await kit.endFight();
finish();
