// The clause ledger, sorcerer: every clause of scripts/clauses/arcane.json
// whose probe names this file is run against the engine. A held clause is a
// test; a clause the engine does not keep is a gap() that fails the day it is
// kept (scripts/lib/sweep-clauses-arcane.mjs runClauseSuite). The probes are
// in scripts/lib/sweep-clauses-arcane-sorcerer.mjs.
import "./lib/enforce-world.mjs";
import { runClauseSuite } from "./lib/sweep-clauses-arcane.mjs";
import { probes } from "./lib/sweep-clauses-arcane-sorcerer.mjs";

await runClauseSuite("test-enforce-sweep-clauses-arcane-sorcerer.mjs", [probes]);
