// The creature attack names of the official French SRD 5.1, paired with
// their English ones: how ACTION_NAMES_FR in src/lib/content/names-fr.ts was
// copied from the book (issue #1121), kept so it can be copied again.
//
//   node scripts/pair-action-names-fr.mjs            print the table's lines
//   node scripts/pair-action-names-fr.mjs --report   and what was left out
//
// Both rulebooks are in the repository (src/lib/rulebook/srd-5.1.json and
// srd-5.1-fr.json) and print a creature under the same page id. An attack is
// a paragraph headed by its name, then how it is made ("Melee Weapon
// Attack:", « Attaque d’arme au corps à corps : »), then its numbers. The
// French book lists a creature's attacks in its own alphabetical order, so
// two attacks are paired by what both books print alike: how the attack is
// made, its bonus to hit and the dice of its hit. An attack whose numbers
// meet no French attack's, or more than one's, is left out; so is a name the
// weapons table already carries, which a creature's action reads through
// (src/lib/roll-words.ts ACTION_TABLES). Where a name is printed with more
// than one French name (a dragon's Claw is « Griffe », a giant scorpion's
// « Pince »), the most common one is taken.
//
// names-fr.ts is the source once written: this prints, and changes no file.
// A name with no line reads in English at a French table and fails nothing.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pagesOf = (file) => JSON.parse(readFileSync(join(root, "src", "lib", "rulebook", file), "utf8")).pages;
const { WEAPON_NAMES_FR } = await import(pathToFileURL(join(root, "src", "lib", "content", "names-fr.ts")).href);

const EN = /\*\*\*([^*]+?)\*\*\*\.?\s*\*(Melee or Ranged|Melee|Ranged) (?:Weapon|Spell) Attack:\*([^\n]*)/g;
const FR = /\*\*\*([^*]+?)\*\*\*\.?\s*\*Attaque (?:d[’']arme|de sort)([^*]*?):\*([^\n]*)/g;
const plain = (text) => text.replace(/[−–]/g, "-").replace(/\s/g, "");
const numbers = (text) => {
  const hit = /([+\-−–]\s*\d+)/.exec(text)?.[1] ?? "?";
  const dice = [...text.matchAll(/\((\d+d\d+(?:\s*[+\-−–]\s*\d+)?)\)/g)].map((match) => plain(match[1]));
  return `${plain(hit)}|${dice.join(",")}`;
};
const bare = (name) => name.replace(/\.$/, "").trim();
const englishHow = (how) => (how === "Melee" ? "melee" : how === "Ranged" ? "ranged" : "both");
const frenchHow = (how) => (/corps à corps ou à distance/.test(how) ? "both" : /distance/.test(how) ? "ranged" : "melee");
// The key a creature's action is looked up by (src/lib/content/names.ts slugKey).
const slugKey = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const CROSSBOWS = { "light-crossbow": "crossbow-light", "hand-crossbow": "crossbow-hand", "heavy-crossbow": "crossbow-heavy" };

const french = new Map(pagesOf("srd-5.1-fr.json").map((page) => [page.id, page]));
const tallies = new Map();
const left = [];
for (const page of pagesOf("srd-5.1.json")) {
  const other = french.get(page.id);
  if (page.kind !== "monster" || !other) {
    continue;
  }
  const ours = [...page.md.matchAll(EN)].map((match) => ({ name: bare(match[1]), how: englishHow(match[2]), numbers: numbers(match[3]) }));
  const theirs = [...other.md.matchAll(FR)].map((match) => ({ name: bare(match[1]), how: frenchHow(match[2]), numbers: numbers(match[3]) }));
  const met = new Map();
  for (const attack of ours) {
    // By how it is made and its numbers; by its numbers alone where the two
    // books say how differently.
    for (const same of [(one) => one.numbers === attack.numbers && one.how === attack.how, (one) => one.numbers === attack.numbers]) {
      const found = theirs.filter(same);
      if (found.length === 1 && ours.filter(same).length === 1) {
        met.set(attack, found[0]);
        break;
      }
    }
  }
  // The one attack either side has left is the same attack, where the two
  // books print its numbers differently.
  const unmet = ours.filter((attack) => !met.has(attack));
  const free = theirs.filter((attack) => ![...met.values()].includes(attack));
  if (unmet.length === 1 && free.length === 1 && unmet[0].how === free[0].how) {
    met.set(unmet[0], free[0]);
  }
  for (const attack of ours) {
    const found = met.get(attack);
    // A heading the French page breaks across two lines is read as its last
    // words alone ("uniquement)"): no name.
    if (!found || !/^\p{Lu}/u.test(found.name)) {
      left.push(`${page.id}: ${attack.name}`);
      continue;
    }
    const tally = tallies.get(attack.name) ?? new Map();
    tally.set(found.name, (tally.get(found.name) ?? 0) + 1);
    tallies.set(attack.name, tally);
  }
}

const lines = [];
const several = [];
const weapons = [];
for (const [name, tally] of tallies) {
  const key = slugKey(name);
  const ranked = [...tally].sort((a, b) => b[1] - a[1]);
  if (WEAPON_NAMES_FR[CROSSBOWS[key] ?? key]) {
    weapons.push(name);
    continue;
  }
  if (ranked.length > 1) {
    several.push(`${name}: ${ranked.map(([said, count]) => `${said} (${count})`).join(", ")}`);
  }
  lines.push([key, ranked[0][0]]);
}
lines.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
for (const [key, said] of lines) {
  console.log(`  ${JSON.stringify(key)}: ${JSON.stringify(said)},`);
}
if (process.argv.includes("--report")) {
  console.log(`\n${lines.length} names. Read through the weapons table: ${weapons.sort().join(", ")}.`);
  console.log(`\nPrinted with more than one French name (the first is taken):\n${several.join("\n")}`);
  console.log(`\nLeft out, ${left.length} attacks whose numbers meet no one French attack:\n${left.join("\n")}`);
}
