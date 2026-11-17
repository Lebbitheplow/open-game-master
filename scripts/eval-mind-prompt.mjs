// The mind prompt, evaluated apart from the table (2026-11-18): each first-
// tier mind of a campaign, as the live code briefs it, put before a few
// made-up moments (idle chatter, food eaten in front of it, a snatch at its
// things, a question put to it, nothing new). Writes the requests to a file;
// scripts/eval-mind-prompt.py asks the character model and scores them.
//
//   SQLITE_DB_PATH=<copy of a live db> DB_ENCRYPTION_KEY=... \
//     node scripts/eval-mind-prompt.mjs <campaignId> <out.json>
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);
const [campaignId, out] = process.argv.slice(2);
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { listNpcs } = await import("../src/lib/db/npcs.ts");
const { mindRequest, tierOfNpc } = await import("../src/lib/dm/npc-mind.ts");
const { perceivedLine } = await import("../src/lib/dm/scene-events-logic.ts");
const { stageFrame } = await import("../src/lib/dm/npc-stage-logic.ts");

const campaign = getCampaignById(campaignId);
const cast = listNpcs(campaignId).filter((npc) => !npc.archived && tierOfNpc(npc) === "primary");
const heard = (actor, speech) => perceivedLine({ actor, targets: [], speech, outcome: "", verb: "speak" }, "", ["hearing", "sight"]);
const saw = (actor, outcome, targets = [], covert = false) => perceivedLine({ actor, targets, speech: "", outcome, verb: "other", covert }, targets[0] ?? "", ["sight", "touch"]);
const mood = "Il gelo morde le assi; la neve cade fitta sul mare grigio.";

const scenarios = {
  chatter: (me, [a, b, c]) => [
    heard(a, "Ci sono abbastanza parole qui, o stiamo solo cercando un suono per coprire il vuoto?"),
    heard(b, "Tutti parlano di legami, di direzioni, di cosa ci tiene insieme..."),
    heard(c, "Il silenzio è pesante, lo sentite? Ci sta logorando più del gelo stesso."),
  ],
  food: (me, [a]) => [saw(a, `${a} prende un pesce essiccato dalle assi e lo mangia a morsi, voltando le spalle agli altri.`)],
  snatch: (me, [a]) => [perceivedLine({ actor: a, targets: [me], speech: "", outcome: `${a} allunga la mano e prova a strappare a ${me} la ciotola di legno.`, verb: "steal" }, me, ["sight", "touch"])],
  asked: (me, [a]) => [heard(a, `${me}, mi dai una mano a legare il barile prima che le onde se lo portino via?`)],
  quiet: () => [],
};

const cases = [];
for (const npc of cast) {
  const others = cast.filter((other) => other.id !== npc.id).map((other) => other.name);
  const present = [{ name: "Brakk", description: "a hero; sits motionless on the edge, unresponsive" }, ...others.map((name) => ({ name, description: "a castaway" }))];
  for (const [id, make] of Object.entries(scenarios)) {
    const perceived = make(npc.name, others);
    const perceives = stageFrame({ perceived, elapsed: "1 hour passed", atmosphere: mood }) || "Nothing new.";
    const { instructions, prompt } = mindRequest(campaign, npc, `It is now night. You speak and act at this moment, after everything below has already happened.\n${perceives}`, present);
    cases.push({ npc: npc.name, scenario: id, instructions, prompt });
  }
}
fs.writeFileSync(out, JSON.stringify(cases, null, 1));
console.log(`${cases.length} cases -> ${out}`);
process.exit(0);
