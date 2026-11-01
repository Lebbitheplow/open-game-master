// Shapes for the adjudication catalog: the declarative description of every
// action the engine can be asked to perform, whether the asker is the AI DM
// (through a tool call) or a person (through the DM console).
//
// The catalog describes ARGUMENTS FOR RENDERING, not validation. Every
// handler already parses its own arguments with zod and returns
// `{ error }` on bad input, and that stays the single source of truth; a
// second schema here would be exactly the drift the catalog exists to
// prevent. What the catalog adds is the console's form and a name list the
// guard test (scripts/test-invoke-catalog.mjs) checks against the tool
// lists the model is offered, so a tool added for the AI cannot silently
// stay missing from the human's console.
//
// Pure by design: no "@/" imports of anything with I/O, so the guard test
// can load it directly.

import { containsPhrase, findNamed, namesHolding, textKey } from "@/lib/language/text-logic";

export type AdjudicationCategory =
  | "combat"
  | "party"
  | "world"
  | "social"
  | "story"
  | "table";

export const CATEGORY_LABELS: Record<AdjudicationCategory, string> = {
  combat: "Combat",
  party: "Party",
  world: "World",
  social: "Social",
  story: "Story",
  table: "Table",
};

// How the console renders one argument. "character" and "enemy" become
// pickers filled from live game state; the rest are ordinary inputs.
//
// - "enemies": several live enemies, sent as an id list.
// - "combatant": one character or enemy on the board, sent as its id, for
//   the map tools that take a token by name or id.
// - "shares": apply_damage's targets, one creature and its share each, sent
//   as the handler's own [{ enemyId | characterId, share }].
// - "hitDice": take_rest's per-character hit dice, sent as the handler's
//   own [{ characterId, dice }].
// - "list": several words typed in one box (a companion's spells), sent as
//   a list.
export type FieldKind =
  | "character"
  | "characters"
  | "enemy"
  | "enemies"
  | "combatant"
  | "shares"
  | "hitDice"
  | "list"
  | "text"
  | "longtext"
  | "number"
  | "boolean"
  | "select"
  | "dice";

export type CatalogField = {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  // Required unless one of these other fields is filled (damage, or the
  // dice the server rolls for it; a character, or an enemy instead).
  requiredUnless?: string | string[];
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  placeholder?: string;
  // What a checkbox starts as. Booleans are off by default, which is right
  // for a flag like "forced" and wrong for one like "they can see it": the
  // engine reads an absent visionClear as darkness, so a console that
  // started it unticked would quietly stop drawing maps.
  default?: boolean;
  // One line under the input. Says what the server does with the value,
  // not what the value is.
  help?: string;
  // A one-line text field a DM would rather say than type (a milestone's
  // sentence), so the console pins a microphone on it the way it does on
  // every longtext.
  dictate?: boolean;
  // A select that also takes a typed value: the options are the ones the
  // engine knows (the SRD conditions), and the typed one is for a story
  // condition it tracks by name only.
  other?: { label: string; placeholder?: string };
  // A column whose row is the field named here: the console offers a
  // "pick on the board" button beside it, and one tap on the battle map
  // fills both. `role` says which square of a spell's area it is (its centre
  // or first square, or the square a wall or line runs toward), so the board
  // can preview the area the pick would lay.
  square?: { row: string; role: "at" | "toward" };
  // Shown, and sent, only while another field holds one of these values: a
  // drake's essence only for a drake, a story pet's numbers only for one.
  onlyWhen?: { field: string; equals: string[] };
  // An empty input here is an answer, not a field left blank: the facade
  // passes "" on to the handler instead of dropping it (src/lib/dm/invoke.ts
  // normalizeArgs), and the handler decides what an empty answer means. A
  // value left out altogether is still no answer, and this is no way past
  // `required`: checkArgs reads "" as missing all the same. Only
  // update_sheet's Becomes says it, where an empty Conditions clears them.
  keepsEmpty?: boolean;
  // Read this way only on a host that offers this server feature
  // (src/lib/capabilities.ts SERVER_FEATURES): the console is compiled into
  // the apps, which can open an older server. There the field reads as
  // `older` says (what that server does with it), or is not shown. `name`
  // there is the key that server reads the value under, when it was renamed
  // since (take_action's enemyId was escapingEnemyId before issue #621).
  host?: { feature: string; older?: { label: string; help?: string; name?: string } };
};

// The field as this host should show it, or null when it cannot use it.
export function fieldForHost(field: CatalogField, offers: (feature: string) => boolean): CatalogField | null {
  if (!field.host || offers(field.host.feature)) {
    return field;
  }
  return field.host.older ? { ...field, ...field.host.older } : null;
}

// Whether a field can matter with the values the form holds now.
export function fieldShown(field: CatalogField, values: Record<string, unknown>): boolean {
  return !field.onlyWhen || field.onlyWhen.equals.includes(String(values[field.onlyWhen.field] ?? ""));
}

export type CatalogEntry = {
  // The tool name the engine dispatches on. Identical to the name the model
  // calls, which is the whole point: one engine, two callers.
  name: string;
  label: string;
  category: AdjudicationCategory;
  // One line for the console list. Written for a person running a table,
  // not for a model.
  summary: string;
  fields: CatalogField[];
  // Greyed out with a reason when no fight is running.
  needsEncounter?: boolean;
  // An action that cannot be taken back asks first. With `when`, only when
  // that field holds that value (a relationship ended by death).
  confirm?: { message: string; when?: { field: string; equals: string | boolean } };
};

// Whether running these arguments needs the person to confirm first.
export function needsConfirm(entry: CatalogEntry, args: Record<string, unknown>): string | null {
  if (!entry.confirm) {
    return null;
  }
  const when = entry.confirm.when;
  if (when && args[when.field] !== when.equals) {
    return null;
  }
  return entry.confirm.message;
}

export function findAdjudication(
  entries: CatalogEntry[],
  name: string,
): CatalogEntry | null {
  const wanted = (name ?? "").trim();
  return entries.find((entry) => entry.name === wanted) ?? null;
}

// Whether a select takes a value. A person picks from the list, so the
// value is exact; the delegated AI and connected agents reach the same
// check through the façade and write "Fire" or "fire damage", which every
// handler reads as fire. Those pass here and the handler's own schema has
// the last word, as it always has.
function selectAccepts(allowed: string[], value: string): boolean {
  if (allowed.includes(value)) {
    return true;
  }
  // An option also without its apostrophes: "Asps Kiss" is Asp's Kiss.
  return allowed.some((option) => containsPhrase(value, option) || containsPhrase(value, option.replace(/['‘’ʼ´`]/g, "")));
}

const labelOf = (option: { label: string }) => [option.label] as const;

const valueOf = (option: { value: string }) => [option.value] as const;

// The run of whole words two keyed texts both start with: "medicine check"
// for "medicine check dc 15" and "medicine check dc 10".
function sharedLead(a: string, b: string): string {
  const left = a.split(" ");
  const right = b.split(" ");
  let count = 0;
  while (count < left.length && count < right.length && left[count] === right[count]) {
    count += 1;
  }
  return left.slice(0, count).join(" ");
}

// The options whose label starts with the words sent, which reach as far as
// the option's own value: "Medicine check" is the leading words of
// "Medicine check, DC 10" up to its value "check". One word of a label short
// of the value ("medicine") leads to no option here; checkArgs answers it.
function optionsLed(field: CatalogField, value: string): Array<{ value: string; label: string }> {
  const sent = textKey(value);
  return (field.options ?? []).filter(
    (option) => sent !== "" && sharedLead(textKey(option.label), sent) === sent && containsPhrase(sent, option.value),
  );
}

// A label's leading words that reach its option's value and go on past what
// the label says: "Medicine check DC 15" for "Medicine check, DC 10".
function pastValue(option: { value: string; label: string }, sent: string): boolean {
  const lead = sharedLead(textKey(option.label), sent);
  return lead !== textKey(option.value) && containsPhrase(lead, option.value);
}

// Whether a value speaks in a label's words rather than as a value: a run of
// a label's words ("medicine", "healer's kit", "a grapple"), or a label's
// leading words past its value. A handler's own list knows none of these,
// so checkArgs refuses them with the values. A value that only adds its own
// words to an option's ("fire damage" for "fire") speaks no label and stays
// for selectAccepts.
function speaksLabel(field: CatalogField, value: string): boolean {
  const options = field.options ?? [];
  const sent = textKey(value);
  return namesHolding(options, value, labelOf).length > 0 || options.some((option) => pastValue(option, sent));
}

// The options a refusal names for words of their labels: a label the words
// start ("medicine" for "Medicine check, DC 10"), a run of a label that
// reaches its value ("healer's kit", "check, DC 10"), a run that names no
// other option ("street" for "City street"), or a label's leading words past
// its value. A run from a label's middle that holds another option's value
// reads as that other option, and names neither: "a grapple" is the middle
// of Escape's "Escape a grapple or a spell's hold", and it pointed a Grapple
// at Escape. The refusal's list of values answers it.
function optionsSpoken(field: CatalogField, value: string): Array<{ value: string; label: string }> {
  const sent = textKey(value);
  const options = field.options ?? [];
  const holding = namesHolding(options, value, labelOf);
  const spoken = (option: { value: string; label: string }) =>
    sharedLead(textKey(option.label), sent) === sent ||
    containsPhrase(value, option.value) ||
    !options.some((other) => other !== option && containsPhrase(value, other.value));
  return options.filter((option) => (holding.includes(option) && spoken(option)) || pastValue(option, sent));
}

// The option a select's value names by its label. The console shows the
// labels, and odm_dm_catalog hands agents the same ones beside the values:
// stabilize's How reads "Medicine check, DC 10" for the value "check", and
// that label sent as it reads, or its leading words as far as the value
// ("Medicine check"), is the option. A value in another case or spacing
// ("Check", "use object") is that value. This runs ahead of selectAccepts
// below: the label holds the word "check", so it would pass that check as
// sent and then fail the handler's own list. A typed value (`other`), or
// anything that names no one option, stays as sent, for checkArgs to judge.
export function selectValue(field: CatalogField, value: unknown): unknown {
  if (field.kind !== "select" || !field.options || field.other || typeof value !== "string") {
    return value;
  }
  if (field.options.some((option) => option.value === value)) {
    return value;
  }
  const named = findNamed(field.options, value, labelOf) ?? findNamed(field.options, value, valueOf);
  if (named) {
    return named.value;
  }
  const led = optionsLed(field, value);
  return led.length === 1 ? led[0].value : value;
}

// A select's refusal, with the options whose labels the words sent speak
// of: "medicine" is no option, and the answer says the Medicine check is
// "check".
function selectRefusal(field: CatalogField, value: unknown): string {
  const allowed = (field.options ?? []).map((option) => option.value);
  const spoken = typeof value === "string" ? optionsSpoken(field, value) : [];
  const hint = spoken.length
    ? ` For "${value}", send ${spoken.map((option) => `"${option.value}" (${option.label})`).join(" or ")}.`
    : "";
  return `${field.label} must be one of: ${allowed.join(", ")}.${hint}`;
}

// A pre-flight check for the console's form: required fields present,
// numbers actually numeric, selects within their options. The handler's own
// zod does the real validation; this exists so a person gets "Damage needs
// a target" instead of a generic parse failure.
export function checkArgs(
  entry: CatalogEntry,
  args: Record<string, unknown>,
): string | null {
  for (const field of entry.fields) {
    const value = args[field.name];
    const missing =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);
    if (field.required && missing) {
      return `${entry.label} needs ${field.label.toLowerCase()}.`;
    }
    const others = field.requiredUnless === undefined ? [] : [field.requiredUnless].flat();
    const empty = (other: unknown) => other === undefined || other === null || (typeof other === "string" && other.trim() === "") || (Array.isArray(other) && other.length === 0);
    if (others.length && missing && others.every((other) => empty(args[other]))) {
      return `${entry.label} needs ${field.label.toLowerCase()}.`;
    }
    if (missing) {
      continue;
    }
    if (field.kind === "number" && typeof value !== "number") {
      return `${field.label} must be a number.`;
    }
    if (field.kind === "boolean" && typeof value !== "boolean") {
      return `${field.label} must be true or false.`;
    }
    if (field.kind === "hitDice" || field.kind === "shares") {
      if (!Array.isArray(value) || value.some((row) => !row || typeof row !== "object")) {
        return `${field.label} must be a list of rows.`;
      }
    }
    if (field.kind === "select" && field.options && !field.other) {
      const allowed = field.options.map((option) => option.value);
      // The option the value names by its label, as normalizeArgs reads it
      // (src/lib/dm/invoke.ts). A label's words that name no one option are
      // refused here with the value to send, never left to the handler's
      // schema, whose list holds only the values.
      const chosen = selectValue(field, value);
      if (
        typeof chosen !== "string" ||
        (!allowed.includes(chosen) && (speaksLabel(field, chosen) || !selectAccepts(allowed, chosen)))
      ) {
        return selectRefusal(field, chosen);
      }
    }
  }
  return null;
}
