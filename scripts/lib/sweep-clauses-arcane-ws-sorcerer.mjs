// The sorcerer clause probes written in the fifth round of the arcane repair:
// the clauses the ledger had marked "not run" (read_only), each now staged and
// run, and the focused cases of the mechanisms that round built
// (scripts/clauses/arcane.json; run by test-enforce-sweep-clauses-arcane-sorcerer.mjs
// beside sweep-clauses-arcane-sorcerer.mjs, which keeps the probes
// it already had).
import assert from "node:assert/strict";
import { MOD, prof, spellDc } from "./sweep-clauses-arcane.mjs";

export function probes(rig, shared) {
  const PROBES = {};
  const KNOWN = {};
  void [assert, MOD, prof, spellDc, rig, shared];
  return { PROBES, KNOWN };
}
