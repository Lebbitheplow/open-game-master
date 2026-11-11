// The cleric rows the divine clause ledger's second wave built
// (scripts/clauses/divine.json): each a feature whose words state a save, a
// condition, a range or what the board shows, and whose spend before this
// moved its counter and handed the rest to the GM. Resolved by
// src/lib/dm/authored-spend-effects.ts like every authored spend; the kinds of
// this file's own live in src/lib/dm/authored-spend-divine-clr.ts.
//
// Only keys no other table holds: AUTHORED_TABLE spreads the tables into one,
// so a key repeated here would replace the older row whole.
import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

const CHANNEL = { id: "channel_divinity" };

export const AUTHORED_DATA_W2_DIVINE_CLR: Record<string, AuthoredEntry> = {
  // "Read a creature's surface thoughts for a minute and cast suggestion on
  // it without a slot": a creature within 60 feet makes a Wisdom save; one
  // that fails is read for a minute, and the cleric's next Suggestion at it
  // costs no slot and is not saved against (src/lib/dm/read-thoughts.ts).
  "cleric::Channel Divinity: Read Thoughts": {
    subclass: "Knowledge Domain",
    spends: [{ name: "Read Thoughts", pool: CHANNEL, action: "action", does: { kind: "read_thoughts", rangeFt: 60 } }],
  },
  // "Create an illusory double for a minute that you can move, cast spells
  // through, and use to gain attack advantage": the double stands beside the
  // creature the cleric fights, so the cleric's attacks on a creature within
  // 5 feet of them that can see it have advantage (authored-hooks.ts).
  // Improved Duplicity (17th) makes it four.
  "cleric::Channel Divinity: Invoke Duplicity": {
    subclass: "Trickery Domain",
    spends: [{ name: "Invoke Duplicity", pool: CHANNEL, action: "action", does: { kind: "duplicity", condition: "invoke duplicity", rounds: 10 } }],
    effects: [{ kind: "attack_adv", vs: "beside_illusion", gate: { condition: "invoke duplicity" } }],
  },
  // "An hour of ritual smithing creates a simple metal item worth up to 100
  // gp": the item the call names (the variant, or the reason) goes onto the
  // cleric's equipment. Out of a fight only: it takes an hour.
  "cleric::Channel Divinity: Artisan's Blessing": {
    subclass: "Forge Domain",
    spends: [{ name: "Artisan's Blessing", pool: CHANNEL, fight: "out", outOfFightWhy: "is an hour-long ritual, not something done in a fight", does: { kind: "forge_item" } }],
  },
  // "Detect undead within 60 feet": each undead within 60 feet, not behind
  // total cover, is found (its hiding ends), a Wisdom-modifier number of
  // times a long rest.
  "cleric::Eyes of the Grave": {
    subclass: "Grave Domain",
    counter: "sub_eyes_of_the_grave",
    spends: [{ name: "Eyes of the Grave", pool: { id: "sub_eyes_of_the_grave" }, action: "action", does: { kind: "sense_undead", rangeFt: 60 } }],
  },
};
