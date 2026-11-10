// The rows of the Hand sweep that fail today, by suite (scripts/lib/sweep-hand-run.mjs
// sweepSuite): KNOWN[suite][rowId] = { rule, where, severity, note }.
//
// A row id is `${prop}|${character}|${states}|${card.id}${variant}`. The character is
// "*" for a row that fails for every character of the suite holding the card; the
// states are "*" or a list. Each row names its cause in sweep-hand-causes.mjs, which
// holds the rule, where the fix lies and the severity.
//
// WRITTEN, with the per-class files beside it, by
//   node scripts/lib/sweep-hand-triage.mjs <dump> --known scripts/lib/sweep-hand-known.mjs
// from a full run with SWEEP_HAND_DUMP=<dump> set. A gap that closes fails its suite:
// write the files again from a fresh dump (and drop the cause when its last row is gone).
import { CAUSE_BY_ID } from "./sweep-hand-causes.mjs";
import { ROWS as ROWS_0 } from "./sweep-hand-known-artificer.mjs";
import { ROWS as ROWS_1 } from "./sweep-hand-known-barbarian.mjs";
import { ROWS as ROWS_2 } from "./sweep-hand-known-bard.mjs";
import { ROWS as ROWS_3 } from "./sweep-hand-known-cleric.mjs";
import { ROWS as ROWS_4 } from "./sweep-hand-known-druid.mjs";
import { ROWS as ROWS_5 } from "./sweep-hand-known-feats.mjs";
import { ROWS as ROWS_6 } from "./sweep-hand-known-fighter.mjs";
import { ROWS as ROWS_7 } from "./sweep-hand-known-items.mjs";
import { ROWS as ROWS_8 } from "./sweep-hand-known-monk.mjs";
import { ROWS as ROWS_9 } from "./sweep-hand-known-paladin.mjs";
import { ROWS as ROWS_10 } from "./sweep-hand-known-ranger.mjs";
import { ROWS as ROWS_11 } from "./sweep-hand-known-rogue.mjs";
import { ROWS as ROWS_12 } from "./sweep-hand-known-sorcerer.mjs";
import { ROWS as ROWS_13 } from "./sweep-hand-known-species.mjs";
import { ROWS as ROWS_14 } from "./sweep-hand-known-warlock.mjs";
import { ROWS as ROWS_15 } from "./sweep-hand-known-wizard.mjs";

const ROWS = { ...ROWS_0, ...ROWS_1, ...ROWS_2, ...ROWS_3, ...ROWS_4, ...ROWS_5, ...ROWS_6, ...ROWS_7, ...ROWS_8, ...ROWS_9, ...ROWS_10, ...ROWS_11, ...ROWS_12, ...ROWS_13, ...ROWS_14, ...ROWS_15 };

export const KNOWN = Object.fromEntries(
  Object.entries(ROWS).map(([suiteName, list]) => [
    suiteName,
    Object.fromEntries(
      list.map(([key, id]) => {
        const cause = CAUSE_BY_ID[id];
        if (!cause) throw new Error(`sweep-hand-known: no cause "${id}" for ${key}`);
        return [key, { cause: id, rule: cause.rule, where: cause.where, severity: cause.severity, note: cause.note }];
      }),
    ),
  ]),
);
