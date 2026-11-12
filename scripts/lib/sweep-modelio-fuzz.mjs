// The argument fuzzer the modelio sweep suites share: a call built from a
// tool's published schema, the slips a model makes applied to it one at a
// time, and the model's door into the engine with the database put back
// after every call.
//
// Import scripts/lib/enforce-world.mjs first.
//
//   const door = await modelDoor(world);
//   const out = await door.call("heal", { characterId, amount: 5 });
//     -> { kind: "ok" | "retry" | "rules" | "limit" | "threw", error, result, state }
//   The call runs inside a savepoint that is rolled back, with the dice
//   seeded, so two calls are compared on equal ground.
//
//   baseArgs(tool, fixtures)   one plausible call from the schema
//   slipsFor(tool, base, fixtures)   [{ slip, field, args, expect }]

// ---- the model's door -------------------------------------------------------

export async function modelDoor(world) {
  const { getDatabase } = await import("../../src/lib/db/core.ts");
  const { createDmTurn } = await import("../../src/lib/db/dm-turns.ts");
  const { listSheets } = await import("../../src/lib/db/sheets.ts");
  const { dispatchAdjudication } = await import("../../src/lib/dm/invoke-dispatch.ts");
  const { applyEncounterCall, ENCOUNTER_TOOL_NAMES } = await import("../../src/lib/dm/encounter-tools.ts");
  const { strictBooleanArgs } = await import("../../src/lib/dm/arg-coerce.ts");
  const { routeToolCall } = await import("../../src/lib/dm/tool-merge.ts");
  const { listedCalls, listRefusal, partsResult, PART_LISTS } = await import("../../src/lib/dm/action-parts-logic.ts");
  const { gateAiCall } = await import("../../src/lib/dm/ai-gate.ts");
  const { modelCallArguments } = await import("../../src/lib/dm/turn.ts");
  const { seedDice, clearDice, diceLog } = await import("./enforce-world.mjs");
  const db = getDatabase();
  const encounterNames = new Set(ENCOUNTER_TOOL_NAMES);

  // What a call can change that a table would notice, for comparing two
  // calls: every sheet but its timestamps, the fight, its enemies.
  const state = () =>
    JSON.stringify({
      sheets: world.sheets().map((sheet) => Object.fromEntries(Object.entries(sheet).filter(([key]) => key !== "updatedAt"))),
      encounter: world.encounter(),
      enemies: world.enemies(),
    });

  // One call as the turn loop resolves it (src/lib/dm/turn.ts
  // resolveModelCall): its arguments through the door, a list of parts split and run in order, "false" sent
  // as a string read as false, a merged or retired name routed, an encounter
  // tool past the AI's gate and run by the encounter engine, the rest
  // dispatched.
  async function resolve(name, rawArguments, turn) {
    const sheets = listSheets(world.campaignId);
    const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
    const campaign = world.campaign();
    const context = { campaign, turn, sheets, sheetsById, realDiceUserIds: new Set() };
    // The argument door the turn loop passes first (turn.ts modelCallArguments).
    const door = modelCallArguments(campaign, name, rawArguments, sheets);
    if ("refusal" in door) return door.refusal;
    rawArguments = door.rawArguments;
    const each = listedCalls(name, rawArguments);
    if (each) {
      const refused = listRefusal(name, each);
      if (refused) return refused;
      const outcomes = [];
      for (const one of each) {
        outcomes.push(await resolve(name, JSON.stringify(one), turn));
      }
      return partsResult(outcomes, PART_LISTS[name].key);
    }
    const routed = routeToolCall(campaign, name, strictBooleanArgs(rawArguments));
    if ("refusal" in routed) return routed.refusal;
    if (encounterNames.has(routed.name)) {
      const gated = gateAiCall(routed.name, routed.rawArguments, { campaign, turn, sheetsById });
      if ("result" in gated) return gated.result;
      return applyEncounterCall(campaign, turn, routed.name, gated.args, sheets, sheetsById, { realDiceUserIds: new Set(), toolCallId: null }).result;
    }
    return dispatchAdjudication(routed.name, routed.rawArguments, context);
  }

  async function call(name, args, { raw = null, keep = false } = {}) {
    const rawArguments = raw ?? JSON.stringify(args);
    const before = state();
    db.exec("SAVEPOINT sweep_fuzz");
    seedDice(0x5eed);
    // Math.random places a fight's tokens (start_encounter) and picks a
    // world tick's choices. enforce-world seeds it once per process, so two
    // calls compared here would read different places from it: the same call
    // with a field omitted and with it null then "differs" by where the
    // goblins stand. Each call starts from the same sequence.
    const sharedRandom = Math.random;
    Math.random = seededRandom(0x5eed);
    // And a new record's id: an enemy told no gender takes one picked from
    // its own id (src/lib/db/encounters.ts pickedGender), so two calls with
    // fresh random ids "differed" by a goblin's gender, about one run in two.
    // A call that is kept keeps real ids, so a later one cannot repeat them.
    const sharedUuid = globalThis.crypto.randomUUID;
    const idRandom = seededRandom(0x1d5eed);
    if (!keep) globalThis.crypto.randomUUID = () => {
      const hex = Array.from({ length: 32 }, () => Math.floor(idRandom() * 16).toString(16)).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    };
    let out;
    try {
      const turn = createDmTurn(world.campaignId, []);
      const result = await Promise.race([
        resolve(name, rawArguments, turn),
        new Promise((_, reject) => setTimeout(() => reject(new Error("the call did not answer in 15 seconds")), 15_000)),
      ]);
      const error = typeof result?.error === "string" ? result.error : null;
      const kind = error === null ? "ok" : result.retry === true ? "retry" : typeof result.refused === "string" ? result.refused : "untyped";
      out = { kind, error, result, changed: state() !== before, after: state() };
    } catch (error) {
      out = { kind: "threw", error: `${error?.name ?? "Error"}: ${error?.message ?? error}`, result: null, changed: state() !== before, after: state(), stack: String(error?.stack ?? "").split("\n").slice(0, 4).join(" | ") };
    } finally {
      Math.random = sharedRandom;
      globalThis.crypto.randomUUID = sharedUuid;
      seedDice(null);
      clearDice();
      // The d20s the call threw, for the suites that ask which tools roll.
      out.d20s = diceLog().filter((die) => die.sides === 20).length;
      if (!keep) {
        db.exec("ROLLBACK TO sweep_fuzz");
      }
      db.exec("RELEASE sweep_fuzz");
    }
    return out;
  }

  return { call, state };
}

// A handler's own failure showing through a refusal: the text of a thrown
// TypeError, a JSON or database error.
export function looksLikeACrash(text) {
  return /Cannot read propert|Cannot destructure|is not a function|is not iterable|is not defined|undefined \(reading|TypeError|ReferenceError|SQLITE_|Unexpected token|in JSON at position|Maximum call stack|\[object Object\]|\bNaN\b/.test(String(text ?? ""));
}

// ---- a call from the schema -------------------------------------------------

const ID_FIELD = /(?:^|[a-z])(?:Id|Ids)$|^(?:id|ids)$/;

// What kind of record an id field names, read from the field's own name and
// description: the fixtures hold one real id for each.
export function idKind(field, schema) {
  if (!ID_FIELD.test(field)) return null;
  const text = `${field} ${schema?.description ?? ""}`.toLowerCase();
  if (/enemy|enemies|attacker|foe/.test(field.toLowerCase())) return "enemy";
  if (/character|caster|healer|helper|target|present|spared|source|owner|rider|holder/.test(field.toLowerCase())) {
    return /enemy/.test(field.toLowerCase()) ? "enemy" : "character";
  }
  if (/enemyid|an enemy/.test(text) && !/character/.test(text)) return "enemy";
  if (/characterid/.test(text)) return "character";
  return "other";
}

const BY_NAME = [
  [/^spell$|spellName/i, "Fire Bolt"],
  [/^weapon$/i, "Longsword"],
  [/^item$|itemName/i, "Rope"],
  [/^condition$/i, "poisoned"],
  [/^skill$/i, "perception"],
  [/ability$/i, "dex"],
  [/^resource$|^feature$/i, "Second Wind"],
  [/^monster$/i, "goblin"],
  [/^damage$|^dice$|^healing$/i, "1d6"],
  [/damageType|^type$/i, "fire"],
  [/^name$/i, "Mira"],
  [/^coins$/i, "5 sp"],
  [/^token$/i, "Hero 1"],
];

function scalarFor(field, schema, fixtures) {
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  const type = schema.type;
  if (type === "boolean") return false;
  if (type === "integer" || type === "number") {
    const low = typeof schema.minimum === "number" ? schema.minimum : 1;
    const high = typeof schema.maximum === "number" ? schema.maximum : low + 10;
    return Math.min(high, Math.max(low, 2));
  }
  if (type === "string") {
    const kind = idKind(field, schema);
    if (kind === "character") return fixtures.characterId;
    if (kind === "enemy") return fixtures.enemyId ?? "no-enemy";
    for (const [pattern, value] of BY_NAME) {
      if (pattern.test(field)) return value;
    }
    return "a quiet word";
  }
  return null;
}

function valueFor(field, schema, fixtures, depth = 0) {
  if (!schema || typeof schema !== "object") return null;
  if (schema.type === "array") {
    const kind = idKind(field, schema.items ?? {}) ?? idKind(field, schema);
    if (schema.items?.type === "string" && kind === "character") return [fixtures.characterId];
    if (schema.items?.type === "string" && kind === "enemy") return [fixtures.enemyId ?? "no-enemy"];
    const entry = valueFor(field.replace(/s$/, ""), schema.items ?? { type: "string" }, fixtures, depth + 1);
    return entry === null ? [] : [entry];
  }
  if (schema.type === "object") {
    if (depth > 2) return {};
    return objectFor(schema, fixtures, depth + 1, true);
  }
  return scalarFor(field, schema, fixtures);
}

function objectFor(schema, fixtures, depth, onlyRequired) {
  const out = {};
  const required = new Set(schema.required ?? []);
  for (const [field, child] of Object.entries(schema.properties ?? {})) {
    if (onlyRequired && !required.has(field)) continue;
    const value = valueFor(field, child, fixtures, depth);
    if (value !== null) out[field] = value;
  }
  return out;
}

// The smallest call the schema calls whole: its required fields, each with a
// plausible value (a real id where the field names one).
export function baseArgs(tool, fixtures) {
  return objectFor(tool.function.parameters ?? {}, fixtures, 0, true);
}

// Every top-level field with a value, for the slips that need a field
// present: the required ones and each optional one, one at a time.
export function fieldValue(tool, field, fixtures) {
  const schema = tool.function.parameters?.properties?.[field];
  return schema ? valueFor(field, schema, fixtures, 0) : null;
}

const garble = {
  "dropped-char": (id) => id.slice(0, -1),
  "case-changed": (id) => (id.toUpperCase() === id ? id.toLowerCase() : id.toUpperCase()),
};

// The slips, one per field they apply to. Each names what the engine may
// answer: "same" (as the call it was made from), "retry" (a refusal of the
// call that names the field), or either.
export function slipsFor(tool, base, fixtures) {
  const properties = tool.function.parameters?.properties ?? {};
  const required = new Set(tool.function.parameters?.required ?? []);
  const slips = [];
  for (const [field, schema] of Object.entries(properties)) {
    // The call the slip is made from: the base, with this field present.
    // An optional field the base leaves out names the other hero, so that a
    // target or a receiver is not the character acting.
    const others = fixtures.otherCharacterId ? { ...fixtures, characterId: fixtures.otherCharacterId, characterName: fixtures.otherCharacterName } : fixtures;
    const value = field in base ? base[field] : fieldValue(tool, field, others);
    if (value === null) continue;
    const withField = { ...base, [field]: value };
    const from = field in base ? "base" : `with:${field}`;
    const add = (slip, args, expect, extra = {}) => slips.push({ slip, field, from, withField, args, expect, ...extra });

    if (schema.type === "boolean") {
      add("bool-as-string", { ...withField, [field]: String(value) }, "same");
      add("bool-as-string-true", { ...withField, [field]: "true" }, "as-true");
    }
    if ((schema.type === "integer" || schema.type === "number") && !Array.isArray(schema.enum)) {
      add("number-as-string", { ...withField, [field]: String(value) }, "same-or-retry");
    }
    if (!required.has(field)) {
      add("null-optional", { ...base, [field]: null }, "as-omitted");
      // An empty text is a value (a background cleared); an empty number or
      // fixed choice is the field left out.
      if (schema.type === "integer" || schema.type === "number" || Array.isArray(schema.enum)) {
        add("empty-optional", { ...base, [field]: "" }, "as-omitted-or-retry");
      }
    }
    if (schema.type === "array" && Array.isArray(value) && value.length === 1) {
      add("one-for-list", { ...withField, [field]: value[0] }, "same-or-retry");
    }
    if (schema.type === "string" && !Array.isArray(schema.enum)) {
      add("list-for-one", { ...withField, [field]: [value] }, "same-or-retry");
    }
    const kind = schema.type === "array" ? idKind(field, schema.items ?? {}) ?? idKind(field, schema) : idKind(field, schema);
    // The id the call this slip is made from sends in the field.
    const sent = Array.isArray(value) ? value[0] : value;
    const real = kind === "character" || kind === "enemy" ? (typeof sent === "string" ? sent : null) : null;
    if (real && (schema.type === "string" || (schema.type === "array" && schema.items?.type === "string"))) {
      const listed = schema.type === "array";
      for (const [how, bend] of Object.entries(garble)) {
        const bent = bend(real);
        if (bent === real) continue;
        add(`id-${how}`, { ...withField, [field]: listed ? [bent] : bent }, "retry-with-candidates", { kind, bent });
        if (listed) {
          // One good id and one bad one: the bad one is never dropped in silence.
          add(`id-${how}-beside-a-good-one`, { ...withField, [field]: [real, bent] }, "retry-with-candidates", { kind, bent });
        }
      }
      const name = kind === "enemy" ? fixtures.enemyName : real === fixtures.otherCharacterId ? fixtures.otherCharacterName : fixtures.characterName;
      if (name) {
        add("name-for-id", { ...withField, [field]: listed ? [name] : name }, "same-or-retry", { kind });
      }
    }
  }
  slips.push({ slip: "extra-key", field: "(none)", from: "base", withField: base, args: { ...base, sweepExtraKey: "x" }, expect: "same" });
  return slips;
}

// ---- judging a slip ---------------------------------------------------------

// Ids and times differ between two runs of the same call (a new record's
// id, a timestamp): each is replaced by its order of appearance.
export function normalised(text) {
  const seen = new Map();
  return String(text ?? "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (id) => {
      const key = id.toLowerCase();
      if (!seen.has(key)) seen.set(key, `<id${seen.size}>`);
      return seen.get(key);
    })
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<time>");
}

// mulberry32, as enforce-world.mjs seeds Math.random with.
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sameOutcome(a, b) {
  return a.kind === b.kind && normalised(a.error) === normalised(b.error) && normalised(a.after) === normalised(b.after);
}

const namesField = (error, field) => new RegExp(`(^|[^A-Za-z])${field}([^A-Za-z]|$)`).test(String(error ?? ""));

// The verdict on one slip: { verdict: "pass" | "fail" | "indeterminate", why }.
//   got      the slip's outcome
//   from     the outcome of the call the slip was made from
//   omitted  the outcome of that call without the field (optional fields)
//   asTrue   the outcome with the boolean true (bool-as-string-true)
export function judge(slip, { got, from, omitted, asTrue, inert = false }, fixtures) {
  if (got.kind === "threw") return { verdict: "fail", code: "threw", why: got.error };
  if (looksLikeACrash(got.error)) return { verdict: "fail", code: "crash-text", why: got.error };
  if (got.kind === "untyped") return { verdict: "fail", code: "untyped", why: `an error with no kind: ${got.error}` };
  const retryNamingIt = got.kind === "retry" && namesField(got.error, slip.field);
  switch (slip.expect) {
    case "same":
      return sameOutcome(got, from) ? { verdict: "pass" } : { verdict: "fail", code: "differs", why: `was ${from.kind} (${from.error ?? "ok"}), became ${got.kind} (${got.error ?? "ok"})` };
    case "as-true":
      return sameOutcome(got, asTrue) ? { verdict: "pass" } : { verdict: "fail", code: "differs", why: `true gave ${asTrue.kind} (${asTrue.error ?? "ok"}), "true" gave ${got.kind} (${got.error ?? "ok"})` };
    case "same-or-retry":
      if (sameOutcome(got, from) || retryNamingIt) return { verdict: "pass" };
      if (got.kind === "retry") return { verdict: from.kind === "ok" ? "fail" : "indeterminate", code: "retry-unnamed", why: `a retry that does not name ${slip.field}: ${got.error}` };
      return { verdict: "fail", code: "differs", why: `was ${from.kind} (${from.error ?? "ok"}), became ${got.kind} (${got.error ?? "ok"})` };
    case "as-omitted":
    case "as-omitted-or-retry":
      if (sameOutcome(got, omitted) || retryNamingIt) return { verdict: "pass" };
      if (got.kind === "retry") return { verdict: omitted.kind === "ok" ? "fail" : "indeterminate", code: "retry-unnamed", why: `a retry that does not name ${slip.field}: ${got.error}` };
      return { verdict: "fail", code: "differs", why: `omitted gave ${omitted.kind} (${omitted.error ?? "ok"}), this gave ${got.kind} (${got.error ?? "ok"})` };
    case "retry-with-candidates": {
      // The field does nothing in this call (a teleport's caster on a walk):
      // the row says nothing about how its id is read.
      if (inert) return { verdict: "indeterminate", code: "inert-field", why: `${slip.field} changes nothing in this call` };
      if (got.kind === "ok") {
        // An id in another case that reaches the same record is the same id.
        if (slip.slip.startsWith("id-case-changed") && sameOutcome(got, from)) return { verdict: "pass" };
        // The result says which id matched nobody (aoe_damage's
        // unmatchedTargets, #742): dropped, but not in silence.
        if (slip.bent && JSON.stringify(got.result ?? "").includes(`"${slip.bent}"`)) return { verdict: "pass" };
        return { verdict: "fail", code: "bad-id-accepted", why: `${slip.field} ${JSON.stringify(slip.args[slip.field])} names nobody and the call went through${got.changed ? ", changing the table" : ""}` };
      }
      // The call is refused the same way with the right id: the handler
      // never reached this one, and the row says nothing about it.
      if (normalised(got.error) === normalised(from.error)) return { verdict: "indeterminate", code: "base-refused", why: from.error };
      if (got.kind !== "retry") return { verdict: from.kind === "ok" ? "fail" : "indeterminate", code: "bad-id-not-retry", why: `a wrong id answered as "${got.kind}", not a retry: ${got.error}` };
      const candidates = [fixtures.characterId, fixtures.otherCharacterId, fixtures.enemyId, fixtures.characterName, fixtures.otherCharacterName, fixtures.enemyName].filter(Boolean);
      const listed = candidates.some((candidate) => String(got.error).includes(candidate));
      return listed || namesField(got.error, slip.field)
        ? { verdict: "pass" }
        : { verdict: from.kind === "ok" ? "fail" : "indeterminate", code: "bad-id-no-candidates", why: `the refusal neither names ${slip.field} nor lists who there is: ${got.error}` };
    }
    default:
      return { verdict: "fail", code: "unknown-expectation", why: slip.expect };
  }
}
