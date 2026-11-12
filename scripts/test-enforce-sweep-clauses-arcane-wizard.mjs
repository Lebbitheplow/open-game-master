// The clause ledger, wizard: every clause of scripts/clauses/arcane.json whose
// probe names this file is run against the engine. A held clause is a test;
// a clause the engine does not keep is a gap() that fails the day it is kept
// (scripts/lib/sweep-clauses-arcane.mjs runClauseSuite). The probes are in
// scripts/lib/sweep-clauses-arcane-wizard-a.mjs (the seven schools) and -b
// (War Magic, Bladesinging, Chronurgy, Graviturgy, Scribes), and
// sweep-clauses-arcane-ws-wizard.mjs, -c and -d (the clauses first run in the fifth round).
import "./lib/enforce-world.mjs";
import { runClauseSuite } from "./lib/sweep-clauses-arcane.mjs";
import { probes as schools } from "./lib/sweep-clauses-arcane-wizard-a.mjs";
import { probes as traditions } from "./lib/sweep-clauses-arcane-wizard-b.mjs";
import { probes as fifth } from "./lib/sweep-clauses-arcane-ws-wizard.mjs";
import { probes as fifthC } from "./lib/sweep-clauses-arcane-ws-wizard-c.mjs";
import { probes as fifthD } from "./lib/sweep-clauses-arcane-ws-wizard-d.mjs";

await runClauseSuite("test-enforce-sweep-clauses-arcane-wizard.mjs", [schools, traditions, fifth, fifthC, fifthD]);
