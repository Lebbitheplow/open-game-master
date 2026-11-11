// The barbarian clauses the engine does not hold today, by probe id
// (scripts/test-enforce-sweep-clauses-martial-barbarian.mjs).
const ROWS = "src/lib/srd/authored-effects-data.ts";
const ROWS_4 = "src/lib/srd/authored-effects-data4.ts";

export const KNOWN = {
};

export const SKIP = {
  "totem-spirit-tiger-jump": "the jump helpers take a Strength score alone (src/lib/srd/jump.ts longJumpFeet(strength, runningStart)): there is no sheet to hand them, so a run cannot show the Tiger's 10 feet missing; read from the signature",
  "aspect-of-the-beast-elk-travel": "the travel tool walks a prepared route's legs with the weather rolled; a doubled pace could only be read off a staged journey, which this suite does not build",
};
