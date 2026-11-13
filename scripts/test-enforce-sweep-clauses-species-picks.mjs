// The clause ledger's probes for the lineage traits that act at a moment of
// play rather than all the time: a jump's die, a charge's hooves, a bonus
// after a roll that fell short, a shifter's form by subtype, a save against
// an illusion. Each trait of src/lib/srd/races.json is run through a hero the
// sheet door made of that lineage, by the doors a table uses, beside a human
// who holds none of it.
//
// scripts/clauses/species.json names each probe, "species.<id>.<trait>".
import fs from "node:fs";
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig } from "./lib/sweep-clauses-srd-rig.mjs";
import { plain, same, walkTo } from "./lib/sweep-clauses-species-rig.mjs";

const rig = await clauseRig();
const RACES = JSON.parse(fs.readFileSync(new URL("../src/lib/srd/races.json", import.meta.url), "utf8")).races;
const holds = (row, trait) => row.traits.some((line) => line.toLowerCase().startsWith(trait));

let moveRoute = null;
// The board's move route, as a player's tap sends it.
async function moveTo(t, who, body) {
  moveRoute ??= await t.world.route("campaigns/[campaignId]/battle-map/move");
  t.world.signIn({ id: t.sheet(who).userId });
  const response = await moveRoute.POST(
    new Request(`http://odm.test/api/campaigns/${t.world.campaignId}/battle-map/move`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: t.world.campaignId }) },
  );
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
const at = (t, who) => {
  const token = t.kit.token(who.id);
  return [token.x, token.y];
};

const P = {};
for (const row of RACES) {
  // The walking speed the builder stores on the sheet with the lineage.
  const of = (build = {}) => ({ class: "fighter", level: 5, race: row.id, speed: row.speed, equipment: [], ...build });
  const probe = (name, fn) => {
    P[`species.${row.id}.${name}`] = fn;
  };

  // Mirthful Leaps: a d8 more feet on a jump that needs them. Strength 16
  // from a standing start is an 8-foot long jump: 10 feet takes the die, and
  // a die too small lands the jumper short, on the line, where it reaches.
  if (holds(row, "mirthful leaps")) {
    probe("mirthful-leaps", async () => {
      const t = await rig.table();
      const who = t.hero(of());
      const other = t.hero(plain());
      await t.fight([who, other]);
      t.kit.openField();
      t.kit.place(who.id, 5, 5);
      t.kit.place(other.id, 15, 15);
      t.world.enemies().forEach((enemy) => t.kit.place(enemy.id, 18, 2));
      t.world.clearDice();
      t.world.dice(5);
      const leap = await moveTo(t, who, { x: 5, y: 7, jump: true });
      const first = [leap.status, ...at(t, who)];
      // A new turn, standing where the first jump came down.
      t.kit.freshTurn();
      t.kit.place(who.id, 5, 7);
      t.world.clearDice();
      t.world.dice(1);
      const short = await moveTo(t, who, { x: 5, y: 10, jump: true });
      const second = [short.status, ...at(t, who)];
      t.world.clearDice();
      await t.fight([other, who]);
      t.kit.openField();
      t.kit.place(other.id, 5, 5);
      t.world.enemies().forEach((enemy) => t.kit.place(enemy.id, 18, 2));
      t.world.dice(5);
      const human = await moveTo(t, other, { x: 5, y: 7, jump: true });
      t.world.clearDice();
      same([first, second, human.status, ...at(t, other)], [[200, 5, 7], [200, 5, 8], 400, 5, 5], `${row.name}: a 10-foot standing jump on a d8 of 5, a 15-foot one on a d8 of 1 (lands 5 feet on), and a human's 10-foot standing jump (${JSON.stringify(leap.body.error ?? short.body.error ?? "")})`);
    });
  }
  // Charge: a run of 30 feet straight at a creature, a melee weapon hit on
  // it, then the hooves as a bonus action; with no run first, no hooves.
  if (holds(row, "charge (")) {
    probe("charge", async () => {
      const t = await rig.table();
      const who = t.hero(of({ equipment: [{ name: "Longsword", equipped: true }] }));
      const [foe] = await t.fight([who]);
      t.kit.openField();
      t.kit.place(who.id, 2, 10);
      t.kit.place(foe.id, 10, 10);
      const run = await walkTo(t, who, 9, 10);
      const blade = await t.swing(who, foe, [15, 4], { weapon: "Longsword" });
      const hooves = await t.swing(who, foe, [15, 2], { weapon: "Hooves", bonusAttack: "feature" });
      const charged = [run.status, blade.ok, hooves.ok, t.budget()?.bonusUsed];
      t.freshTurn();
      t.kit.place(who.id, 9, 10);
      const still = await t.swing(who, foe, [15, 4], { weapon: "Longsword" });
      const refused = await t.swing(who, foe, [15, 2], { weapon: "Hooves", bonusAttack: "feature" });
      same([charged, still.ok, refused.ok], [[200, true, true, true], true, false], `${row.name}: hooves after a 35-foot run and a longsword hit, then after a hit with no run (${run.body.error ?? ""} ${hooves.error ?? ""})`);
    });
  }
  // Saving Face: a save that fell short gains +1 for each ally seen within
  // 30 feet, offered only where that carries it, once a short rest.
  if (holds(row, "saving face")) {
    probe("saving-face", async () => {
      const { allyChoicesFor, spendAfterRoll } = await import("../src/lib/dm/after-roll.ts");
      const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
      const { rollExpression } = await import("../src/lib/dice.ts");
      const t = await rig.table();
      const who = t.hero(of());
      const near = t.hero(plain());
      const far = t.hero(plain());
      await t.fight([who, near, far]);
      t.kit.openField();
      t.kit.place(who.id, 5, 5);
      t.kit.place(near.id, 7, 5);
      t.kit.place(far.id, 18, 12);
      // An 8 on the die, +3: a Wisdom save of 11.
      const thrown = () => {
        t.world.clearDice();
        t.world.dice(8);
        const out = rollExpression("1d20+3");
        t.world.clearDice();
        return out;
      };
      const offered = (roller, dc) => allyChoicesFor(t.world.campaignId, t.sheet(roller), { kind: "saving_throw", outcome: thrown(), dc, detail: "wis" }).filter((option) => option.id === "saving_face").length;
      const short = offered(who, 13);
      const carries = offered(who, 12);
      const paid = spendAfterRoll(getCampaignById(t.world.campaignId), t.sheet(who), "saving_face", thrown());
      const spent = [paid?.outcome.total, t.used(who, "race_saving_face")];
      same([short, carries, spent, offered(who, 12), offered(near, 12)], [0, 1, [12, 1], 0, 0], `${row.name}: one ally within 30 feet against DC 13 and DC 12, the use spent, then again, and a human's`);
    });
  }
  // Lucky Footwork: a failed Dexterity save, the reaction, a d4 added, where
  // a 4 could carry it; never another save, nor a prone rabbitfolk.
  if (holds(row, "lucky footwork")) {
    probe("lucky-footwork", async () => {
      const { allyChoicesFor, spendAfterRoll } = await import("../src/lib/dm/after-roll.ts");
      const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
      const { rollExpression } = await import("../src/lib/dice.ts");
      const t = await rig.table();
      const who = t.hero(of());
      const down = t.hero(of());
      const other = t.hero(plain());
      await t.fight([who, down, other]);
      t.patch(down, { conditions: ["prone"] });
      // An 8 on the die, +3: a save of 11.
      const thrown = () => {
        t.world.clearDice();
        t.world.dice(8);
        const out = rollExpression("1d20+3");
        t.world.clearDice();
        return out;
      };
      const offered = (roller, detail, dc = 14) => allyChoicesFor(t.world.campaignId, t.sheet(roller), { kind: "saving_throw", outcome: thrown(), dc, detail }).filter((option) => option.id === "lucky_footwork").length;
      const seen = [offered(who, "DEX save against Fireball"), offered(who, "wis"), offered(who, "dex", 16), offered(down, "dex"), offered(other, "dex")];
      const out = thrown();
      t.world.dice(3);
      const paid = spendAfterRoll(getCampaignById(t.world.campaignId), t.sheet(who), "lucky_footwork", out);
      t.world.clearDice();
      const spent = [paid?.outcome.total, t.world.encounter().reactionsUsed.includes(who.id)];
      same([seen, spent, offered(who, "dex")], [[1, 0, 0, 0, 0], [14, true], 0], `${row.name}: a Dexterity save of 11 against DC 14, a Wisdom save, DC 16, a prone rabbitfolk, a human; the d4 of 3 and the reaction; then again`);
    });
  }
}

// The probes above by name, for the ledger's probe check (it finds a probe
// by its name in this file); the run holds the table to the list.
const NAMES = [
  "species.satyr.mirthful-leaps", "species.centaur.charge", "species.hobgoblin.saving-face",
  "species.rabbitfolk.lucky-footwork",
];
assert.deepEqual(Object.keys(P).sort(), [...NAMES].sort(), "the table makes other probes than NAMES lists: a row of races.json was added or changed");

await runOrSurvey("scripts/test-enforce-sweep-clauses-species-picks.mjs", P);
