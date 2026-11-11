// The clause ledger, warlock: every clause of scripts/clauses/arcane.json
// whose probe names this file is run against the engine. A held clause is a
// test; a clause the engine does not keep is a gap() that fails the day it is
// kept (scripts/lib/sweep-clauses-arcane.mjs runClauseSuite). The probes are
// in scripts/lib/sweep-clauses-arcane-warlock.mjs and, for the clauses wave 2
// staged, scripts/lib/sweep-clauses-arcane-warlock-wbf.mjs and
// scripts/lib/sweep-clauses-arcane-warlock-places.mjs.
import "./lib/enforce-world.mjs";
import { runClauseSuite } from "./lib/sweep-clauses-arcane.mjs";
import { probes } from "./lib/sweep-clauses-arcane-warlock.mjs";
import { probes as wbfProbes } from "./lib/sweep-clauses-arcane-warlock-wbf.mjs";
import { probes as placeProbes } from "./lib/sweep-clauses-arcane-warlock-places.mjs";

await runClauseSuite("test-enforce-sweep-clauses-arcane-warlock.mjs", [probes, wbfProbes, placeProbes]);
