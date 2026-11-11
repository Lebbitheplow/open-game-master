// The wizard clause probes written in the fifth round of the arcane repair,
// for War Magic and Bladesinging: the clauses the ledger had marked "not run" (read_only), each
// now staged and run, and the focused cases of the mechanisms that round built
// (scripts/clauses/arcane.json; run by test-enforce-sweep-clauses-arcane-wizard.mjs).
// The probes a clause already had stay in the file that held them.
import assert from "node:assert/strict";
import { MOD, prof, spellDc } from "./sweep-clauses-arcane.mjs";

export function probes(rig, shared) {
  const PROBES = {};
  const KNOWN = {};
  void [assert, MOD, prof, spellDc, rig, shared];
  return { PROBES, KNOWN };
}
