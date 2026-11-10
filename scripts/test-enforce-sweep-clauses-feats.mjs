// The clause ledger's probes for the feats of src/lib/srd/authored-feats.json.
// The clause text and the verdict live in scripts/clauses/feats.json; this
// file holds how each clause that names it is staged.
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const worn = (...names) => names.map((name) => ({ name, qty: 1, equipped: true }));
const P = {};

P["feat.medium-armor-master.ac"] = async () => {
  const t = await rig.table();
  const base = { class: "fighter", level: 4, equipment: worn("Breastplate"), abilities: { dex: 16 } };
  const plain = t.hero(base);
  const master = t.hero({ ...base, feats: ["Medium Armor Master"] });
  assert.equal(t.ac(master) - t.ac(plain), 1, `breastplate with Dexterity 16: ${t.ac(plain)} without the feat, ${t.ac(master)} with it`);
};

P["feat.medium-armor-master.stealth"] = async () => {
  const t = await rig.table();
  const master = t.hero({ class: "fighter", level: 4, equipment: worn("Half Plate"), abilities: { dex: 16 }, feats: ["Medium Armor Master"] });
  const roll = await t.roll(master, { kind: "skill_check", skill: "stealth", dc: 10 }, [15, 3]);
  assert.equal(roll.ok, true, roll.error);
  assert.equal(roll.faces.length, 1, `half plate's Stealth disadvantage stayed on a Medium Armor Master: ${roll.faces.length} d20s`);
};

P["feat.heavy-armor-master.reduce"] = async () => {
  const t = await rig.table();
  const who = t.hero({ class: "fighter", level: 4, equipment: worn("Plate"), feats: ["Heavy Armor Master"] });
  assert.equal(t.ac(who), 18, "the staging: plate is worn heavy armor (AC 18)");
  const [foe] = await t.fight([who]);
  t.foesTurn(foe);
  const before = t.sheet(who).currentHp;
  // The dummy's club: 16 + 4 hits AC 18, a 4 on the d6 + 2 is 6 bludgeoning.
  const out = await t.strike(foe, who, [16, 4]);
  assert.equal(out.ok, true, out.error);
  assert.equal(before - t.sheet(who).currentHp, 3, `a nonmagical club hit of 6 took ${before - t.sheet(who).currentHp} off a Heavy Armor Master in plate`);
};

P["feat.dual-wielder.ac"] = async () => {
  const t = await rig.table();
  const base = { class: "fighter", level: 4, equipment: worn("Shortsword", "Shortsword") };
  const plain = t.hero(base);
  const dual = t.hero({ ...base, feats: ["Dual Wielder"] });
  assert.equal(t.ac(dual) - t.ac(plain), 1, `a weapon in each hand: ${t.ac(plain)} without the feat, ${t.ac(dual)} with it`);
};

P["feat.mobile.no-opportunity-attack"] = async () => {
  const t = await rig.table();
  const who = t.hero({ class: "fighter", level: 4, equipment: worn("Longsword"), feats: ["Mobile"] });
  const [foe] = await t.fight([who]);
  const hit = await t.swing(who, foe, [15, 4]);
  assert.equal(hit.ok, true, hit.error);
  t.world.signIn({ id: t.sheet(who).userId });
  const route = await t.world.route("campaigns/[campaignId]/battle-map/move");
  t.world.clearDice();
  t.world.diceLog();
  t.world.dice(15, 4, 15, 4);
  const moved = await route.POST(new Request(`http://odm.test/api/campaigns/${t.world.campaignId}/battle-map/move`, { method: "POST", body: JSON.stringify({ x: 2, y: 5 }) }), { params: Promise.resolve({ campaignId: t.world.campaignId }) });
  t.world.clearDice();
  assert.equal(moved.status, 200, `the move was refused: ${moved.status}`);
  assert.equal(t.world.diceLog().filter((die) => die.sides === 20).length, 0, "the creature the Mobile fighter attacked made an opportunity attack as they left");
};

await runOrSurvey("scripts/test-enforce-sweep-clauses-feats.mjs", P);
