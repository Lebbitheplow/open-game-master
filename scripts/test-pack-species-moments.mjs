// A content pack species' traits that act at a moment of play, run through
// a hero the sheet door made with the lines its pick writes (the pack rows
// are scripts/fixtures/pack-species-rows.json, read by
// src/lib/content/species-prose-logic.ts), by the tools a table uses.
import fs from "node:fs";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clauseRig } from "./lib/sweep-clauses-srd-rig.mjs";
import { plain, same } from "./lib/sweep-clauses-species-rig.mjs";

const { test, finish } = suite("test-pack-species-moments");
const rig = await clauseRig();
const { packRaceOptions } = await import("../src/lib/content/race-options.ts");
const { races } = JSON.parse(fs.readFileSync(new URL("./fixtures/pack-species-rows.json", import.meta.url), "utf8"));
const options = packRaceOptions(races);

// A hero of a pack option, with the lines of the pick named written as the
// builder writes them (submit.ts variantFeatureNames).
function heroOf(t, optionId, pickId, build = {}) {
  const race = options.find((option) => option.id === optionId);
  const pick = race.variants.options.find((entry) => entry.id === pickId);
  const lines = [`${race.variants.label} (${pick.name})`, ...(pick.lines ?? [])];
  return {
    lines,
    who: t.hero({ class: "fighter", level: 5, race: optionId, equipment: [], features: lines.map((name) => ({ name, source: "race" })), racialChoices: { variant: pick.id }, ...build }),
  };
}

// A derro of the mutated caste whose Otherworldly Influence is Tainted Blood:
// after piercing or slashing damage, the reaction and the one use a short
// rest deal necrotic damage equal to the derro's level to the derro and each
// creature within 5 feet, and nobody farther.
await test("Tainted Blood answers a cut with the derro's level in necrotic damage to all within 5 feet", async () => {
  const t = await rig.table();
  const { who, lines } = heroOf(t, "mutated", "tainted-blood");
  const ally = t.hero(plain());
  const [foe, far] = await t.fight([who, ally], { foes: 2 });
  t.foesTurn(foe);
  const hp = () => [t.sheet(who).currentHp, t.sheet(ally).currentHp, t.enemy(foe).currentHp, t.enemy(far).currentHp];
  const early = await t.invoke("use_reaction", { characterId: who.id, feature: "Tainted Blood" });
  await t.damage(who, 6, "slashing");
  const before = hp();
  const spray = await t.invoke("use_reaction", { characterId: who.id, feature: "Tainted Blood" });
  const after = hp();
  same(
    [Boolean(early.error), lines.length > 1, spray.ok, before.map((value, at) => value - after[at]), t.used(who, "race_tainted_blood"), t.world.encounter().reactionsUsed.includes(who.id)],
    [true, true, true, [5, 5, 5, 0], 1, true],
    `before any blow, then after 6 slashing: the derro, the ally and the foe beside them, and the far foe (${early.error ?? ""} | ${spray.error ?? ""} | ${lines.join(" / ")})`,
  );
});

// A gearforged on a human chassis: Inspired Ingenuity turns a check's d20 of
// 9 or lower into a 10 for the reaction, once a short rest, offered on the
// card the check waits on where the 10 carries it.
await test("Inspired Ingenuity makes a low d20 on a check a 10", async () => {
  const { allyChoicesFor, spendAfterRoll } = await import("../src/lib/dm/after-roll.ts");
  const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
  const { rollExpression } = await import("../src/lib/dice.ts");
  const t = await rig.table();
  const race = options.find((option) => option.id === "human-chassis");
  const who = t.hero({ class: "fighter", level: 5, race: race.id, equipment: [], features: race.traitNames.map((name) => ({ name, source: "race" })) });
  await t.fight([who]);
  const thrown = (face) => {
    t.world.clearDice();
    t.world.dice(face);
    const out = rollExpression("1d20+3");
    t.world.clearDice();
    return out;
  };
  const offered = (face, dc) => allyChoicesFor(t.world.campaignId, t.sheet(who), { kind: "skill_check", outcome: thrown(face), dc, detail: "athletics" }).filter((option) => option.id === "inspired_ingenuity").length;
  const seen = [offered(6, 12), offered(6, 14), offered(12, 16)];
  const paid = spendAfterRoll(getCampaignById(t.world.campaignId), t.sheet(who), "inspired_ingenuity", thrown(6));
  same(
    [seen, paid?.outcome.total, paid?.outcome.natural, t.used(who, "race_inspired_ingenuity"), t.world.encounter().reactionsUsed.includes(who.id), offered(6, 12)],
    [[1, 0, 0], 13, 10, 1, true, 0],
    "a 6 (+3) against DC 12 and DC 14, a 12 against DC 16; the 6 made a 10; then again",
  );
});

finish();
