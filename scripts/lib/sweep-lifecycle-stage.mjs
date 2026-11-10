// The table the lifecycle sweep stages for one row: a fighter and a wizard at
// a person-run table, with or without a fight against two dummies, the
// fighter beside the first. A fresh one for every row, so a row's residue is
// never the next row's start.
//
// Import scripts/lib/enforce-world.mjs before this file.
import { openWorld } from "./enforce-world.mjs";
import { combatKit, TRAINED } from "./enforce-combat.mjs";
import { caster } from "./enforce-spell-kit.mjs";

const { setDmMode } = await import("../../src/lib/db/campaigns.ts");

export const WIZARD_SPELLS = [
  "Hold Person", "Fireball", "Shield", "Mage Armor", "Magic Missile", "Web", "Misty Step", "Bless",
  "Blur", "Haste", "Sleep", "Find Familiar", "Detect Thoughts", "Fly", "Invisibility",
];

export async function stage(kind = "fight", { settings = {}, heroes = null } = {}) {
  const world = await openWorld({
    gameSettings: { dmMode: "human", ttsEnabled: false, multiCharacter: "all_active", ...settings },
    campaign: { maxPlayers: 8 },
  });
  setDmMode(world.campaignId, "human", world.owner.id);
  const kit = await combatKit(world);
  const hero = world.addHero(
    heroes?.[0] ?? {
      name: "Kara",
      class: "fighter",
      level: 5,
      maxHp: 44,
      abilities: { str: 16, dex: 14, con: 14 },
      proficiencies: { ...TRAINED, saves: ["str", "con"], skills: ["athletics", "perception"] },
      gold: 50,
      equipment: [
        { name: "Longsword", qty: 1, equipped: true },
        { name: "Longbow", qty: 1 },
        { name: "Arrows (20)", qty: 1 },
        { name: "Potion of Healing", qty: 2 },
        { name: "Rations (1 day)", qty: 5 },
        { name: "Waterskin", qty: 1 },
      ],
    },
  );
  const mage = world.addHero(
    heroes?.[1] ?? {
      name: "Mira",
      user: world.owner,
      maxHp: 38,
      gold: 200,
      ...caster("wizard", "int", WIZARD_SPELLS, ["Fire Bolt", "Light"], 9),
    },
  );
  let enemies = [];
  if (kind === "fight") {
    await kit.fight(2, { heroFaces: { [hero.id]: 20, [mage.id]: 19 } });
    enemies = world.enemies();
    kit.place(hero.id, 5, 5);
    kit.place(mage.id, 4, 5);
    kit.place(enemies[0].id, 6, 5);
    kit.place(enemies[1].id, 12, 5);
    kit.giveTurn(hero.id);
  }
  // A first save normalises a sheet (gear weights and the like): made here,
  // it is not read later as something a tool changed.
  for (const sheet of [hero, mage]) {
    world.patch(sheet.id, { notes: "" });
  }
  // And the first move of the clock writes the calendar itself.
  if (kind !== "fight") {
    await world.invoke("pass_time", { amount: 1, unit: "minutes" });
  }
  world.clearDice();
  world.diceLog();
  return { world, kit, hero, mage, enemies, e1: enemies[0] ?? null, e2: enemies[1] ?? null };
}
