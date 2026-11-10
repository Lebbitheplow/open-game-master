// One card of one character in one state, in full: the card as dealt, the
// intent it posts, the calls the engine made and what it rolled. For reading
// a row of the Hand sweep by eye.
//
//   node scripts/lib/sweep-hand-probe.mjs <class> "<subclass>" <state> "<card id or name part>" [self|<aim>] [level]
import "./enforce-world.mjs";
import { handRig } from "./sweep-hand.mjs";
import { judge } from "./sweep-hand-run.mjs";

const [classId, subclass, state, wanted, aimAt, level] = process.argv.slice(2);
const rig = await handRig();
const table = await rig.seat({ classId, subclass, level: Number(level ?? 20) });
await rig.inState(table, state, async (reason) => {
  if (reason) return console.log(`STATE SKIPPED: ${reason}`);
  const dealt = rig.deal(table);
  const cards = dealt.cards.filter((card) => card.id === wanted || card.id.includes(wanted) || card.name.toLowerCase().includes(wanted.toLowerCase()));
  if (!cards.length) console.log(`no card matches; the hand holds: ${dealt.cards.map((card) => card.id).join(", ")}`);
  for (const card of cards) {
    const { icon, description, ...face } = card;
    console.log(`CARD ${JSON.stringify(face)}`);
    const aim = aimAt === "self" ? "self" : aimAt ? table[aimAt]?.id : undefined;
    const played = await rig.play(table, dealt, card, aim ? { aimAt: aim } : {});
    const { preview, resources, slots, ...rest } = played;
    console.log(`PLAYED ${JSON.stringify(rest, (key, value) => (key === "terms" ? undefined : value)).slice(0, 2600)}`);
    console.log(`PREVIEW ${JSON.stringify((preview ?? []).map((row) => `${row.key}: ${row.value}`))}`);
    console.log(`VERDICTS ${JSON.stringify(judge({ state, card, played, variant: aimAt === "self" ? ":self" : "", heroId: table.hero.id }))}`);
  }
});
