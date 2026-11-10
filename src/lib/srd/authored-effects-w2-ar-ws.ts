// The wizard subclasses' rows built in the fifth round of the arcane repair
// (the "ws" part of the clause ledger, scripts/clauses/arcane.json): features
// whose text states a mechanic no row held, or held only in part. Registered
// in AUTHORED_TABLE (src/lib/srd/authored-effects.ts) with one line.
//
// AUTHORED_TABLE takes the last row written for a key, whole: a row here for a
// feature an earlier table already holds spreads that row first and adds to
// it, so nothing the earlier rounds built is dropped.
//
// Pure.
import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

export const AUTHORED_DATA_W2_AR_WS: Record<string, AuthoredEntry> = {
  // "Add your proficiency bonus to ability checks made as part of an
  // abjuration spell, such as counterspell and dispel magic": the server rolls
  // both checks, so it adds the bonus (src/lib/dm/ar-ws-spell-check.ts). The
  // earlier row left it to the GM, who has no roll to add it to.
  "wizard::Improved Abjuration": {
    subclass: "School of Abjuration",
    effects: [{ kind: "spell_check_prof", school: "abjuration" }],
  },
};
