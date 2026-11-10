// What the dice sweep suites (scripts/test-enforce-sweep-dice*.mjs) share: a
// spy on every die the engine throws that says WHERE it was thrown and for
// whom, a reading of the source for every place a die can be thrown, and
// arguments for a console form filled from the catalog's own field list.
//
// Import scripts/lib/enforce-world.mjs first, as every enforcement suite does.
import fs from "node:fs";
import path from "node:path";

export const repoRoot = path.resolve(import.meta.dirname, "../..");

// ---- the spy ----
//
// src/lib/dice.ts asks globalThis.__odmScriptedDie for every die it rolls
// with its own generator (defaultRng), handing it the roll's frame: what the
// site said it rolls (`purpose`, a RollTag) or null when the site said
// nothing. The spy sits in that seat, keeps whatever hook the server
// registers behind it (src/lib/db/dice-scripts.ts), and records each die with
// the first frame of the stack that is not dice.ts: the roll site.
const seen = [];
let spying = false;
// Faces the spy puts on the dice while a differential runs (forceDice): the
// same face on every d20 of a character's, another on every creature's d20,
// and one face on every other die, so two paths that roll the same dice in a
// different order still roll the same numbers.
let forced = null;

// `record`: also keep each forced die for take(), at the cost of a stack
// read per die. `creatureSites`: files whose untagged d20 is a creature's
// (the creature's side of a contest), which takes the creature's face.
export function forceDice(faces, { record = false, creatureSites = null } = {}) {
  forced = faces ? { ...faces, record, creatureSites } : null;
}

// The roll site, and `via`: the two frames of src/ above it, for a site that
// is a helper many callers roll through (roll-card.ts rollCard).
function siteOf(stack) {
  const frames = [];
  for (const line of String(stack).split("\n").slice(1)) {
    // A Windows frame names a drive (D:\a\... or file:///D:/a/...): the
    // drive is kept and the path read with either slash.
    const frame = line.replace(/file:\/\/\/([A-Za-z]:)/, "$1");
    const match = /^\s*at (?:async )?(?:(.+?) \()?(?:file:\/\/)?((?:[A-Za-z]:)?[\\/][^():]+?):(\d+):\d+\)?$/.exec(frame);
    if (!match) {
      continue;
    }
    const file = path.relative(repoRoot, decodeURI(match[2])).split(path.sep).join("/");
    if (!file.startsWith("src/") || file === "src/lib/dice.ts") {
      continue;
    }
    frames.push({ file, line: Number(match[3]), fn: (match[1] ?? "").replace(/^(Object|Module)\./, "") });
    if (frames.length === 3) {
      break;
    }
  }
  const [site = { file: "?", line: 0, fn: "" }, ...via] = frames;
  return { ...site, via: via.map((frame) => `${frame.file.replace(/^src\//, "")}#${frame.fn || frame.line}`) };
}

export function installDiceSpy() {
  if (!spying) {
    spying = true;
    let inner = globalThis.__odmScriptedDie;
    const spy = (sides, frame) => {
      if (forced) {
        if (forced.record) {
          seen.push({ sides, purpose: frame?.purpose ?? null, ...siteOf(new Error("site").stack) });
        }
        if (sides !== 20) {
          return Math.min(sides, forced.other);
        }
        if (!frame?.purpose && forced.creatureSites && forced.creatureSites.test(siteOf(new Error("site").stack).file)) {
          return forced.enemyD20;
        }
        return frame?.purpose?.roller === "enemy" ? forced.enemyD20 : forced.d20;
      }
      seen.push({ sides, purpose: frame?.purpose ?? null, ...siteOf(new Error("site").stack) });
      return inner ? inner(sides, frame) : null;
    };
    Object.defineProperty(globalThis, "__odmScriptedDie", {
      configurable: true,
      get: () => spy,
      set: (hook) => {
        inner = hook;
      },
    });
  }
  return {
    // Every die thrown since the last take, in order.
    take: () => seen.splice(0, seen.length),
  };
}

// The d20s among spied dice, each with whom its site said it was for.
export function d20sOf(dice) {
  return dice.filter((die) => die.sides === 20);
}

const names = (who) => (who === undefined || who === null ? [] : Array.isArray(who) ? who : [who]);

// Whether a spied die was tagged as this hero's.
export function taggedFor(die, heroName) {
  return die.purpose?.roller === "hero" && names(die.purpose.who).includes(heroName);
}

export const siteKey = (die) => `${die.file}:${die.line}`;

// ---- the source's roll sites ----
//
// Every call in src/ that throws dice with the engine's own generator. The
// sweep's registry of sites is checked against this, so a roll added to the
// engine next month has to be classified before the suite passes again.
const ROLL_CALL = /\b(rollExpression|rollD20)\(/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

export function staticRollSites() {
  const sites = [];
  for (const full of walk(path.join(repoRoot, "src"))) {
    // Forward slashes on every platform: the ids are written that way.
    const file = path.relative(repoRoot, full).split(path.sep).join("/");
    if (file === "src/lib/dice.ts") {
      continue;
    }
    const lines = fs.readFileSync(full, "utf8").split("\n");
    lines.forEach((text, index) => {
      if (!ROLL_CALL.test(text) || /^\s*(\/\/|\*|import )/.test(text)) {
        return;
      }
      // The function the call sits in: the nearest line above that opens one
      // at the file's left edge.
      let fn = "";
      for (let at = index; at >= 0; at -= 1) {
        const opened = /^(?:export )?(?:async )?function\*? (\w+)|^(?:export )?const (\w+) = (?:async )?\(/.exec(lines[at]);
        if (opened) {
          fn = opened[1] ?? opened[2];
          break;
        }
      }
      const window = lines.slice(index, index + 4).join(" ");
      sites.push({
        file,
        line: index + 1,
        fn,
        id: `${file.replace(/^src\//, "")}#${fn || "top"}`,
        // What the call itself says of the roll, read from its text.
        tagged: /purpose/.test(window),
        d20: /d20|resolved\.expression|toHitExpression|pending\.expression|characterInitiativeExpression/.test(window),
        text: text.trim().slice(0, 160),
      });
    });
  }
  return sites;
}

// ---- a console form filled from the catalog ----
//
// One value for each field of a catalog entry, by the field's kind and name:
// the actors come from `ctx` ({ heroId, allyId, enemyId }), a select takes
// `pick[name]` or its first option, and anything in `set` wins outright.
// Optional fields are left empty unless they name an actor the form needs to
// have a roller at all (`fill`), so a form is sent as a person would send it
// with the least they could type.
const TEXT_BY_NAME = [
  [/^(skill|contestSkill)$/, "perception"],
  [/^ability$/, "dex"],
  [/weapon/i, "Longsword"],
  [/spell/i, "Fire Bolt"],
  [/^(item|itemName)$/, "Rope"],
  [/reason|note|summary|text|description|why/i, "the sweep asks"],
  [/name|title|label/i, "Sweep"],
];

export function valueFor(field, ctx, pick = {}) {
  if (pick[field.name] !== undefined) {
    return pick[field.name];
  }
  switch (field.kind) {
    case "character":
    case "combatant":
      return ctx.heroId;
    case "characters":
      return [ctx.heroId];
    case "enemy":
      return ctx.enemyId;
    case "enemies":
      return ctx.enemyId ? [ctx.enemyId] : [];
    case "select":
      return field.options?.[0]?.value;
    case "number":
      return /dc/i.test(field.name) ? 10 : Math.max(field.min ?? 1, Math.min(field.max ?? 5, 5));
    case "boolean":
      return undefined;
    case "dice":
      return "1d6";
    case "list":
      return ["sweep"];
    case "text":
    case "longtext": {
      const known = TEXT_BY_NAME.find(([pattern]) => pattern.test(field.name));
      return known ? known[1] : field.placeholder ?? "sweep";
    }
    default:
      return undefined;
  }
}

export function formArgs(entry, ctx, { pick = {}, set = {}, fill = [] } = {}) {
  const args = {};
  for (const field of entry.fields) {
    const wanted = field.required || fill.includes(field.name) || pick[field.name] !== undefined;
    if (!wanted) {
      continue;
    }
    const value = valueFor(field, ctx, pick);
    if (value !== undefined && value !== null) {
      args[field.name] = value;
    }
  }
  return { ...args, ...set };
}

// ---- what a call left behind ----

// A table's state as a differential compares it: every sheet's vitals and
// counters, every creature of the fight, the turn's budget and marks.
export function tableState(world, { heroIds = null } = {}) {
  const sheets = world.sheets().filter((sheet) => !heroIds || heroIds.includes(sheet.id));
  const encounter = world.encounter();
  return {
    sheets: Object.fromEntries(
      sheets.map((sheet) => [
        sheet.name,
        {
          hp: sheet.currentHp,
          temp: sheet.tempHp ?? 0,
          conditions: [...(sheet.conditions ?? [])].sort(),
          resources: Object.fromEntries(Object.entries(sheet.resources ?? {}).map(([id, value]) => [id, value?.used ?? 0]).filter(([, used]) => used)),
          slots: Object.fromEntries(Object.entries(sheet.spellcasting?.slots ?? {}).map(([level, slot]) => [level, slot.used]).filter(([, used]) => used)),
          concentration: sheet.concentration?.spell ?? null,
          inspiration: sheet.inspiration ?? false,
        },
      ]),
    ),
    enemies: world.enemies().map((enemy) => ({ name: enemy.displayName, hp: enemy.currentHp, status: enemy.status, conditions: [...enemy.conditions].sort() })),
    marks: [...(encounter?.turnBudget?.oncePerTurn ?? [])].sort(),
    budget: encounter?.turnBudget
      ? { action: encounter.turnBudget.actionUsed ?? null, bonus: encounter.turnBudget.bonusUsed ?? null, attacks: encounter.turnBudget.attacksMade ?? null }
      : null,
    reactions: [...(encounter?.reactionsUsed ?? [])].sort(),
  };
}

// The first few differences between two plain values, as "path: a != b".
export function diffState(left, right, at = "", out = []) {
  if (out.length >= 8) {
    return out;
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      diffState(left[key], right[key], at ? `${at}.${key}` : key, out);
    }
    return out;
  }
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    out.push(`${at}: ${JSON.stringify(left)} != ${JSON.stringify(right)}`);
  }
  return out;
}

// One finding, appended to the study's file as a JSON line, once per id.
export function recordFinding(file, finding) {
  if (!process.env.ODM_SWEEP_FINDINGS) {
    return;
  }
  const have = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (have.split("\n").some((line) => line.includes(`"id":"${finding.id}"`))) {
    return;
  }
  fs.appendFileSync(file, `${JSON.stringify(finding)}\n`);
}
