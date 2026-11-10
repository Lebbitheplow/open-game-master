// The Hand and the engine never disagree: every druid (part 1 of 2 of its subclasses), every state,
// every card (scripts/lib/sweep-hand-run.mjs has the properties).
import { hasPack } from "./lib/enforce-world.mjs";
import { sweepSuite } from "./lib/sweep-hand-run.mjs";
import { KNOWN } from "./lib/sweep-hand-known.mjs";

const NAME = "test-enforce-sweep-hand-druid-a";
// With no content pack the Hand and the engine read a spell's casting time
// and costly component from different records. Recorded as gaps so a fix
// closes them; with the pack both agree.
const NO_PACK = hasPack
  ? {}
  : {
      "P2|Circle of Dreams@20|*|spell:scrying": {
        rule: "The Hand and the engine never disagree (scripts/lib/sweep-hand-run.mjs)",
        where: "Scrying: the Hand reads its 1,000 gp component from the authored spell and shuts the card, while use_spell_slot reads the costly component from the pack's record and takes it",
        severity: "low",
        note: "Only a server with no content pack: the apps and the Docker image carry it.",
      },
    };
await sweepSuite(NAME, "druid", { ...(KNOWN[NAME] ?? {}), ...NO_PACK }, { part: [0, 2] });
