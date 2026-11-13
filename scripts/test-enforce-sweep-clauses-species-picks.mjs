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
import { plain, same } from "./lib/sweep-clauses-species-rig.mjs";

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
  const of = (build = {}) => ({ class: "fighter", level: 5, race: row.id, equipment: [], ...build });
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
}

// The probes above by name, for the ledger's probe check (it finds a probe
// by its name in this file); the run holds the table to the list.
const NAMES = [
  "species.satyr.mirthful-leaps",
];
assert.deepEqual(Object.keys(P).sort(), [...NAMES].sort(), "the table makes other probes than NAMES lists: a row of races.json was added or changed");

await runOrSurvey("scripts/test-enforce-sweep-clauses-species-picks.mjs", P);
