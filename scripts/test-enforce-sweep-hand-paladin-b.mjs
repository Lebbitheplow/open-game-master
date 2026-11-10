// The Hand and the engine never disagree: every paladin (part 2 of 2 of its subclasses), every state,
// every card (scripts/lib/sweep-hand-run.mjs has the properties).
import { hasPack } from "./lib/enforce-world.mjs";
import { sweepSuite } from "./lib/sweep-hand-run.mjs";
import { KNOWN } from "./lib/sweep-hand-known.mjs";

const NAME = "test-enforce-sweep-hand-paladin-b";
// With no content pack the Hand and the engine read a spell's casting time
// and costly component from different records. Recorded as gaps so a fix
// closes them; with the pack both agree.
const NO_PACK = hasPack
  ? {}
  : {
      "P1|Oath of the Crown@20|*|spell:geas": {
        rule: "The Hand and the engine never disagree (scripts/lib/sweep-hand-run.mjs)",
        where: "Geas: the Hand deals it as an action, while cast_at_enemy reads its minute of casting from the pack's record and asks for use_spell_slot",
        severity: "low",
        note: "Only a server with no content pack: the apps and the Docker image carry it.",
      },
      "P5|Oath of the Crown@20|*|spell:geas": {
        rule: "The Hand and the engine never disagree (scripts/lib/sweep-hand-run.mjs)",
        where: "Geas: the Hand deals it as an action, while cast_at_enemy reads its minute of casting from the pack's record and asks for use_spell_slot",
        severity: "low",
        note: "Only a server with no content pack: the apps and the Docker image carry it.",
      },
    };
await sweepSuite(NAME, "paladin", { ...(KNOWN[NAME] ?? {}), ...NO_PACK }, { part: [1, 2] });
