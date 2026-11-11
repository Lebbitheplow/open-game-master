// The clause ledger, sorcerer: every clause of scripts/clauses/arcane.json
// whose probe names this file is run against the engine. A held clause is a
// test; a clause the engine does not keep is a gap() that fails the day it is
// kept (scripts/lib/sweep-clauses-arcane.mjs runClauseSuite). The probes are
// in scripts/lib/sweep-clauses-arcane-sorcerer.mjs and
// sweep-clauses-arcane-ws-sorcerer.mjs, -b and -c (the clauses first run in the fifth round),
// and Lunar Phenomenon's phases in sweep-clauses-arcane-lunar.mjs.
import "./lib/enforce-world.mjs";
import { runClauseSuite } from "./lib/sweep-clauses-arcane.mjs";
import { probes } from "./lib/sweep-clauses-arcane-sorcerer.mjs";
import { probes as fifth } from "./lib/sweep-clauses-arcane-ws-sorcerer.mjs";
import { probes as fifthB } from "./lib/sweep-clauses-arcane-ws-sorcerer-b.mjs";
import { probes as fifthC } from "./lib/sweep-clauses-arcane-ws-sorcerer-c.mjs";
import { probes as lunarPhenomenon } from "./lib/sweep-clauses-arcane-lunar.mjs";

await runClauseSuite("test-enforce-sweep-clauses-arcane-sorcerer.mjs", [probes, fifth, fifthB, fifthC, lunarPhenomenon]);
