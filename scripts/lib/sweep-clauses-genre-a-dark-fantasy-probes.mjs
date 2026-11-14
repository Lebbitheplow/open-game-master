// The probes of the dark fantasy clause ledger that its own mechanisms need
// (src/lib/dm/genre-a-dark-fantasy-*.ts); the contract of
// sweep-clauses-genre-a-probes.mjs.
import { must, eq } from "./sweep-clauses-genre-a.mjs";

const CASTING = { ability: "wis", slots: { 1: { max: 4, used: 0 } }, known: ["Bless"], prepared: ["Bless"], cantrips: [] };

export const DARK_FANTASY = {
  // The Litany Unbroken: 20 damage or less asks no concentration save and the
  // litany holds; 21 asks the save.
  async litany(t, run, feature) {
    t.fresh();
    const hero = t.hero(feature.classId, feature.level, { spellcasting: CASTING });
    for (const [amount, saves] of [[20, 0], [21, 1]]) {
      t.world.patch(hero.id, { concentratingOn: "Bless", currentHp: 100 });
      t.world.clearDice();
      t.world.diceLog();
      t.world.dice(1, 1);
      must(await t.world.invoke("apply_damage", { characterId: hero.id, amount, type: "slashing" }), "the damage");
      t.world.clearDice();
      eq(t.world.diceLog().filter((die) => die.sides === 20).length, saves, `concentration saves rolled for ${amount} damage`);
      if (!saves) eq(t.world.sheet(hero.id).concentratingOn, "Bless", `concentration after ${amount} damage`);
    }
  },
};
