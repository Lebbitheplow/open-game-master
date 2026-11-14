// The steampunk classes' features built in wave 2's fifth round (WAVE2 D5:
// "The genre classes' text is the rule, played on the SRD 5.1 engine"), kept
// apart from authored-effects-genre-b.ts so the mystery and post-apocalyptic
// rounds, which run beside this one, never append to the same array. Rows are
// found by feature name with `classes` naming the class they belong to, as
// that file's are; their text is src/lib/classes/steampunk-features.json.
//
// Pure data; no database.
import type { GenreRow } from "@/lib/srd/authored-effects-genre";
import { GALVANIC } from "@/lib/srd/genre-b-steampunk-conditions";

export const GENRE_B_STEAMPUNK_AUTHORED: GenreRow[] = [
  // "Your acid formulae treat immunity as resistance": a formula is the
  // alchemist's spell (src/lib/dm/genre-b-steampunk-defenses.ts).
  { feature: "Universal Solvent", classes: ["alchemist"], entry: { subclass: "genre", effects: [{ kind: "soften_immune", types: ["acid"], spells: true }] } },
  // "Your lightning arts ignore resistance and treat immunity as resistance":
  // an art is the channeler's spell.
  {
    feature: "Heart of the Storm",
    classes: ["aether_channeler"],
    entry: { subclass: "genre", effects: [{ kind: "ignore_resist", types: ["lightning"], spells: true }, { kind: "soften_immune", types: ["lightning"], spells: true }] },
  },
  // "1/rest, charge your skin for 1 minute: the next creature that touches or
  // melee-hits you takes 1d8 lightning": the charge is a mark the first melee
  // hit spends (src/lib/dm/genre-b-steampunk-ends.ts spendRetaliateMark); a
  // touch that is no attack is the GM's to shock by apply_damage. Lightning
  // Rod's "always active" is that feature's own row.
  {
    feature: "Galvanic Discharge",
    classes: ["aether_channeler"],
    entry: {
      subclass: "genre",
      counter: "steampunk_galvanic_discharge",
      effects: [{ kind: "retaliate", formula: "1d8", type: "lightning", melee: true, spends: GALVANIC, gate: { condition: GALVANIC } }],
      spends: [{ name: "Galvanic Discharge", pool: { id: "steampunk_galvanic_discharge" }, action: "none", does: { kind: "buff", condition: GALVANIC, rounds: 10 } }],
    },
  },
  // "1/long rest, reaction when a lightning or aether effect hits you: absorb
  // it, taking no damage, and regain a 1st-level slot": aether is lightning on
  // the SRD engine, as the channeler's own arts are.
  {
    feature: "Capacitor Soul",
    classes: ["aether_channeler"],
    entry: { subclass: "genre", counter: "steampunk_capacitor_soul", reactions: [{ name: "Capacitor Soul", pool: { id: "steampunk_capacitor_soul" }, does: { kind: "reduce", amount: "half", whole: true, who: "self", types: ["lightning"], regainSlot: 1 } }] },
  },
  // "1/long rest, ignore being disarmed": what the gadgeteer let fall is in
  // their hand again and the disarmed mark is gone, at no cost of the turn;
  // refused, nothing spent, when they are not disarmed
  // (src/lib/dm/genre-b-steampunk-spends.ts rearm).
  {
    feature: "Backup Rig",
    classes: ["gadgeteer"],
    entry: { subclass: "genre", counter: "steampunk_backup_rig", spends: [{ name: "Backup Rig", pool: { id: "steampunk_backup_rig" }, action: "none", does: { kind: "steampunk", what: "rearm" } }] },
  },
];
