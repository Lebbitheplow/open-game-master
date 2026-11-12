// Every clause ledger (scripts/clauses/*.json) names, for a clause it calls
// held or a gap, the probe that runs it: `probe` is a suite file and the id,
// test or row inside it ("scripts/<suite>.mjs :: <id>", "scripts/<suite>.mjs:
// <test title>", "scripts/<suite>.mjs gap <row id> [note]", and several of these
// joined by "; "). A ledger's own suite runs only the clauses that name it, so a
// clause naming a suite file that was never written, or an id that suite does not
// have, was run by nothing while the ledger called it held: 116 arcane clauses
// sat so until wave 2. probeProblems is the one check of that for every ledger;
// scripts/test-clause-probes.mjs runs it, and a ledger's clause suite may too.
//
// What "the id exists" means, read without running the suite: the id, test title
// or row id is written in the suite file or in a scripts/ module it imports (at
// any depth). A sweep's generated row id ("counter:sub_power_surge#GUIDANCE_ONLY",
// "spend:<class>::<feature>::<spend>#HANDS_BACK") is made from the engine's own
// tables, so only its finding kind (the word after "#") can be read in the suite:
// that kind must be one the suite writes. The clause suites built on
// runClauseSuite also refuse, when they run, an id they have no probe for.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: on Windows the pathname is "/D:/a/..." and
// path.resolve turns it into "D:\\D:\\a\\...", so no ledger was found there.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const LEDGER_DIR = path.join(ROOT, "scripts/clauses");

// The ledger files, by their name under scripts/clauses ("arcane.json").
export const ledgerFiles = () => fs.readdirSync(LEDGER_DIR).filter((name) => name.endsWith(".json")).sort();

// Every clause object of a ledger, whatever its shape (a map of features to
// { clauses: [...] }, or features holding clause arrays deeper down), with the
// key of the feature it sits under.
export function ledgerClauses(file) {
  const ledger = JSON.parse(fs.readFileSync(path.join(LEDGER_DIR, file), "utf8"));
  const out = [];
  const walk = (node, key) => {
    if (Array.isArray(node)) return node.forEach((item) => walk(item, key));
    if (!node || typeof node !== "object") return;
    if (typeof node.c === "string" && typeof node.is === "string") out.push({ key, clause: node });
    for (const [name, value] of Object.entries(node)) if (value && typeof value === "object") walk(value, key ?? name);
  };
  for (const [key, value] of Object.entries(ledger)) walk(value, key);
  return out;
}

// A probe string as the suites it names, each { file, kind, id }: kind is
// "::", ":", "gap", "row", "ruling", "test" or "" (the file alone).
const SUITE = /scripts\/[\w./-]+\.mjs/g;
export function parseProbe(probe) {
  const text = String(probe ?? "");
  const found = [...text.matchAll(SUITE)];
  return found.map((match, at) => {
    const end = at + 1 < found.length ? found[at + 1].index : text.length;
    let rest = text.slice(match.index + match[0].length, end).trim();
    let kind = "";
    const lead = /^(::|:|gap\b|row\b|ruling\b|test\b)/.exec(rest);
    if (lead) {
      kind = lead[1];
      rest = rest.slice(lead[0].length).trim();
    }
    // What follows the id is a note for the reader: "[limits finding ...]",
    // "(a table check only ...)", or the "; " before the next suite.
    rest = rest.replace(/;\s*$/, "").replace(/\s*\[[^\]]*\]\s*$/, "").trim();
    if (kind !== "::" && kind !== ":") rest = rest.replace(/\s*\([^)]*\)\s*$/, "").trim();
    rest = rest.replace(/^"(.*)"$/s, "$1").trim();
    return { file: match[0], kind, id: rest };
  });
}

// The text of a suite and of every scripts/ module it imports, at any depth.
const texts = new Map();
function suiteText(file) {
  if (texts.has(file)) return texts.get(file);
  const seen = new Set();
  const parts = [];
  const read = (abs) => {
    if (seen.has(abs) || !fs.existsSync(abs)) return;
    seen.add(abs);
    const body = fs.readFileSync(abs, "utf8");
    parts.push(body);
    for (const match of body.matchAll(/["'`](\.{1,2}\/[\w./-]+\.mjs)["'`]/g)) {
      const next = path.resolve(path.dirname(abs), match[1]);
      if (next.startsWith(path.join(ROOT, "scripts"))) read(next);
    }
  };
  read(path.join(ROOT, file));
  const joined = parts.join("\n");
  texts.set(file, joined);
  return joined;
}

// A sweep's generated row id: "<what>:<subject>#<KIND>".
const GENERATED = /^[a-z]+:.+#([A-Z][A-Z_]+)$/;

// The id a template literal of a suite makes, as a pattern: `take_action.hero_${action}`
// stands for every row it writes. A template whose fixed words are too few to
// tell one row from another (`${key}#${id}`) stands for none.
const patterns = new Map();
function templatesOf(file) {
  if (patterns.has(file)) return patterns.get(file);
  const out = [];
  for (const match of suiteText(file).matchAll(/`([^`]*\$\{[^`]*)`/g)) {
    const pieces = match[1].split(/\$\{[^}]*\}/);
    if (pieces.join("").replace(/[^A-Za-z]/g, "").length < 4) continue;
    out.push(new RegExp(pieces.map((piece) => piece.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&")).join(".+")));
  }
  patterns.set(file, out);
  return out;
}

// Why one named probe does not exist, or null when it does. `keys` are the
// ledger's feature keys: a suite that walks its ledger names a row by a key and
// a local part ("cleric::Blessings of Knowledge#languages", "esper::Ascendant
// Mind#0", "uses:fighter::Combat Superiority", "detective::Keen Deduction#0:uses"),
// so the key is the ledger's and every word of the local part (an index aside)
// must be written in the suite.
export function probeMissing({ file, id }, keys = []) {
  if (!fs.existsSync(path.join(ROOT, file))) return `${file} does not exist`;
  if (!id) return null;
  const text = suiteText(file);
  if (text.includes(id)) return null;
  const generated = GENERATED.exec(id);
  if (generated && text.includes(generated[1])) return null;
  if (templatesOf(file).some((pattern) => pattern.test(id))) return null;
  const own = keys.filter((key) => id.includes(key)).sort((a, b) => b.length - a.length)[0];
  if (own) {
    const words = id.split(own).join(" ").split(/[#:/]+/).map((word) => word.trim()).filter((word) => word && !/^\d+$/.test(word));
    if (words.every((word) => text.includes(word))) return null;
  }
  // A title written across a string join or with escaped quotes.
  const flat = (value) => value.replace(/\\(["'`])/g, "$1").replace(/["'`]\s*\+\s*["'`]/g, "").replace(/\s+/g, " ");
  if (flat(text).includes(flat(id))) return null;
  return `${file} has no probe "${id.slice(0, 90)}"`;
}

// Every clause of one ledger whose probe file or probe id does not exist, as
// { key, c, is, probe, why }. A clause that names no probe is the ledger's own
// check's business (a held clause needs one), not this one's.
export function probeProblems(file) {
  const out = [];
  const clauses = ledgerClauses(file);
  const keys = [...new Set(clauses.flatMap(({ key }) => [key, key.split("@")[0]]))];
  for (const { key, clause } of clauses) {
    if (!clause.probe) continue;
    const named = parseProbe(clause.probe);
    // A read_only gap may carry, in place of a probe, what stopped the run
    // ("not run: the scratch board has no surface to climb").
    if (!named.length && clause.is === "gap" && clause.read_only) continue;
    if (!named.length) {
      out.push({ key, c: clause.c, is: clause.is, probe: clause.probe, why: "the probe names no scripts/ suite file" });
      continue;
    }
    const why = named.map((one) => probeMissing(one, keys)).filter(Boolean);
    if (why.length) out.push({ key, c: clause.c, is: clause.is, probe: clause.probe, why: why.join("; ") });
  }
  return out;
}
