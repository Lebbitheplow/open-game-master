import type { RollTag } from "@/lib/dice-script-logic";

// Rolls one die: returns an integer in [1, sides]. Injectable for testing.
export type DieRng = (sides: number) => number;

export type Advantage = "none" | "advantage" | "disadvantage";

export type DieResult = {
  sides: number;
  value: number;
  kept: boolean;
  // The discarded face when a Great Weapon Fighting reroll replaced it, so
  // the dice card can show what happened.
  rerolledFrom?: number;
};

export type DiceTerm = {
  kind: "dice";
  sign: 1 | -1;
  count: number;
  sides: number;
  keep?: { mode: "highest" | "lowest"; count: number };
  dice: DieResult[];
  subtotal: number;
};

export type ModifierTerm = {
  kind: "modifier";
  sign: 1 | -1;
  value: number;
};

export type RollResult = {
  expression: string;
  total: number;
  terms: Array<DiceTerm | ModifierTerm>;
  // Set when the roll is a single kept d20 (1d20, 2d20kh1, 2d20kl1):
  // the natural face of the kept die, for crit detection.
  natural?: number;
  crit?: "nat20" | "nat1";
};

const MAX_DICE_PER_TERM = 100;
const MAX_SIDES = 100;
const MIN_SIDES = 2;
const MAX_TERMS = 20;

// XdY, optional khN/klN keep, optional rN reroll (Halfling Lucky: "1d20r1"
// rerolls a die at or below N once and keeps the new face, before the keep
// picks a survivor; in a kept term only one die is rerolled), optional fN
// floor (Reliable Talent: "1d20f10" treats a kept face below N as N), or a
// flat integer.
const TERM_PATTERN =
  /^(?:(\d{1,3})d(\d{1,3})(?:k([hl])(\d{1,3}))?(?:r(\d{1,3}))?(?:f(\d{1,3}))?|(\d{1,7}))$/i;

// ---- a test table's dice script (issue 685) ----
//
// A test table may script its dice: a seed, and faces forced on the rolls
// they are aimed at (src/lib/dice-script-logic.ts). The script lives in the
// database, which this module (bundled for the browser too) must not
// import, so the server module that keeps it (src/lib/db/dice-scripts.ts)
// registers a hook here, as src/lib/dm/wake.ts lets the loop register its
// waker. The hook answers null for every die at any other table, and then
// the die is rolled here as it always was.
//
// The frame is the one roll being made (one rollExpression call): what its
// site says it rolls, and the face a script forced on its d20, which every
// d20 of that roll then shows, so a forced face is the face the roll keeps
// at advantage or disadvantage too.
export type RollFrame = { purpose: RollTag | null; forcedD20: number | null };
export type ScriptedDie = (sides: number, frame: RollFrame) => number | null;

// A call the server holds for a player's dice is run again once they land
// (src/lib/dm/held-call.ts). The faces its first run drew by chance are
// drawn again on the second, so a die nobody has seen yet is the same die
// (`taped`), and every face drawn by chance is noted for a later run
// (`drawn`). Registered the way the dice script is, for the same reason.
// `before`: told of every die before it is thrown, so the held call may stop
// for a player watching for Portent before the first d20 of a roll.
export type DiceTape = { taped: (sides: number) => number | null; drawn: (sides: number, face: number) => void; before?: (sides: number, frame: RollFrame) => void };

// A whole roll once its dice are thrown, for what is set on it before the
// throw and changes the roll, not a die: Cosmic Omen's d6 and Restore
// Balance's one d20 (src/lib/db/dice-scripts.ts, armed at a watch stop).
// Registered the way the dice script is; answers the roll unchanged at any
// other moment. Told only of a roll whose site says what it rolls.
export type RolledHook = (result: RollResult, purpose: RollTag) => RollResult;

declare global {
  var __odmScriptedDie: ScriptedDie | undefined;
  var __odmDiceTape: DiceTape | null | undefined;
  var __odmRolled: RolledHook | undefined;
}

export function registerScriptedDice(hook: ScriptedDie) {
  globalThis.__odmScriptedDie = hook;
}

export function registerRolledHook(hook: RolledHook) {
  globalThis.__odmRolled = hook;
}

let frame: RollFrame | null = null;

// Node's crypto, asked for by name instead of imported. This module is
// bundled for the browser too (the screens import its types and helpers),
// and an import of "node:crypto" there made the bundler ship a whole Node
// crypto polyfill with the table, the table view and the character builder:
// 438 KiB of script, 131 KiB on the wire, for dice the browser never rolls
// for anything that counts. The server gets the same module an import gave
// it, read at each roll, so the suites that replace its randomInt to force
// a die (scripts/lib/enforce-world.mjs) still do.
type NodeRandomInt = (min: number, max: number) => number;
function nodeCrypto(): { randomInt: NodeRandomInt } | undefined {
  const host = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  return host?.getBuiltinModule?.("node:crypto") as { randomInt: NodeRandomInt } | undefined;
}

// A whole number in [1, sides] from the browser's own generator: uniform,
// by drawing again when a draw lands in the uneven tail of the 32-bit range.
function webDie(sides: number): number {
  const limit = 0x1_0000_0000 - (0x1_0000_0000 % sides);
  const draw = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(draw);
  } while (draw[0] >= limit);
  return 1 + (draw[0] % sides);
}

export function defaultRng(sides: number) {
  globalThis.__odmDiceTape?.before?.(sides, frame ?? { purpose: null, forcedD20: null });
  const scripted = globalThis.__odmScriptedDie?.(sides, frame ?? { purpose: null, forcedD20: null });
  if (scripted !== undefined && scripted !== null) {
    return scripted;
  }
  const tape = globalThis.__odmDiceTape;
  const node = nodeCrypto();
  const face = tape?.taped(sides) ?? (node ? node.randomInt(1, sides + 1) : webDie(sides));
  tape?.drawn(sides, face);
  return face;
}

export type RollOptions = {
  // Great Weapon Fighting: reroll damage dice landing at or below this
  // value, once each, and keep the new face even if it is worse. d20s are
  // exempt: this is a damage-dice rule, never an attack-roll one.
  rerollBelow?: number;
  // Empowered Spell (SRD 5.1, sorcerer, Metamagic): "reroll a number of the
  // damage dice up to your Charisma modifier (minimum of one). You must use
  // the new rolls." Once every die is thrown, up to this many of them are
  // rolled again, lowest first by how far each fell below its die's average,
  // and only dice that did fall below it: rerolling a die at or above its
  // average loses more often than it gains. d20s are exempt, as above.
  empower?: number;
  // Who rolls and what, for a test table's dice script to aim its forced
  // faces by (src/lib/dice-script-logic.ts). Nothing else reads it.
  purpose?: RollTag;
};

// How a roll made of faces entered at the table reads its dice
// (rollEnteredDice): whether the face just drawn was the player's, already
// the one they kept after any reroll their own die took, and how a reroll of
// a face the server drew is drawn without taking the next entered face.
type EntryOptions = RollOptions & { faceIsFinal?: () => boolean; redraw?: DieRng };

// Parses and rolls a dice expression: XdY terms with optional khN/klN keeps
// and integer modifiers, joined by + or -. Examples: "1d20+5", "4d6kh3",
// "2d20kl1+3", "8d6", "1d100-10".
export function rollExpression(
  expression: string,
  rng: DieRng = defaultRng,
  options: RollOptions = {},
): RollResult {
  return rollFramed(expression, rng, options);
}

function rollFramed(expression: string, rng: DieRng, options: EntryOptions): RollResult {
  // Rolling is synchronous, so the frame is this call's alone until it
  // returns; the one it replaced is put back for whoever was rolling.
  const outer = frame;
  frame = { purpose: options.purpose ?? null, forcedD20: null };
  let result: RollResult;
  try {
    result = rollTerms(expression, rng, options);
  } finally {
    frame = outer;
  }
  return options.purpose && globalThis.__odmRolled ? globalThis.__odmRolled(result, options.purpose) : result;
}

// An expression's signed terms, each read by the grammar, or the reason it
// cannot be read. Shared by the roll and by what a roll card says of it.
function termsOf(expression: string): { compact: string; terms: Array<{ rawTerm: string; sign: 1 | -1; match: RegExpExecArray }> } {
  const compact = expression.replace(/\s+/g, "").toLowerCase();
  if (!compact) {
    throw new Error("Empty dice expression.");
  }

  // Split into signed terms; a leading sign is optional.
  const rawTerms = compact.match(/[+-]?[^+-]+/g);
  if (!rawTerms || rawTerms.join("") !== compact) {
    throw new Error(`Invalid dice expression: ${expression}`);
  }
  if (rawTerms.length > MAX_TERMS) {
    throw new Error("Too many terms in dice expression.");
  }
  const terms = rawTerms.map((rawTerm) => {
    const sign: 1 | -1 = rawTerm.startsWith("-") ? -1 : 1;
    const body = rawTerm.replace(/^[+-]/, "");
    const match = TERM_PATTERN.exec(body);
    if (!match) {
      throw new Error(`Invalid dice term: ${rawTerm}`);
    }
    return { rawTerm, sign, match };
  });
  return { compact, terms };
}

function rollTerms(expression: string, rng: DieRng, options: EntryOptions): RollResult {
  const terms: Array<DiceTerm | ModifierTerm> = [];
  // Each dice term's floor and its own reroll, for an Empowered Spell's
  // second throw of a die (below).
  const again: Array<{ term: DiceTerm; floorAt: number; reroll: () => number }> = [];
  const read = termsOf(expression);
  const compact = read.compact;
  for (const { rawTerm, sign, match } of read.terms) {

    if (match[7] !== undefined) {
      terms.push({ kind: "modifier", sign, value: Number(match[7]) });
      continue;
    }

    const count = Number(match[1]);
    const sides = Number(match[2]);
    if (count < 1 || count > MAX_DICE_PER_TERM) {
      throw new Error(`Dice count out of range in: ${rawTerm}`);
    }
    if (sides < MIN_SIDES || sides > MAX_SIDES) {
      throw new Error(`Die size out of range in: ${rawTerm}`);
    }

    let keep: DiceTerm["keep"];
    if (match[3]) {
      const keepCount = Number(match[4]);
      if (keepCount < 1 || keepCount > count) {
        throw new Error(`Keep count out of range in: ${rawTerm}`);
      }
      keep = { mode: match[3] === "h" ? "highest" : "lowest", count: keepCount };
    }

    const roll = () => {
      const value = rng(sides);
      if (!Number.isInteger(value) || value < 1 || value > sides) {
        throw new Error(`RNG returned an invalid d${sides} value: ${value}`);
      }
      return value;
    };
    // The grammar reroll (Halfling Lucky "r1") and the Great Weapon Fighting
    // option (d20-exempt) both reroll a low die once and keep the new face.
    // They act on disjoint die types in practice; a die either one catches
    // is rerolled.
    const grammarReroll = match[5] ? Number(match[5]) : 0;
    if (grammarReroll < 0 || grammarReroll >= sides) {
      throw new Error(`Reroll threshold out of range in: ${rawTerm}`);
    }
    const weaponRerollAt = sides === 20 ? 0 : (options.rerollBelow ?? 0);
    // With advantage or disadvantage the grammar reroll touches one die, the
    // first low one: SRD 5.1 Advantage and Disadvantage, "When you have
    // advantage or disadvantage and something in the game, such as the
    // halfling's Lucky trait, lets you reroll or replace the d20, you can
    // reroll or replace only one of the dice." At disadvantage two 1s stay 1.
    let grammarRerollsLeft = keep ? 1 : count;
    const reroll = () => {
      if (!options.redraw) {
        return roll();
      }
      const value = options.redraw(sides);
      if (!Number.isInteger(value) || value < 1 || value > sides) {
        throw new Error(`RNG returned an invalid d${sides} value: ${value}`);
      }
      return value;
    };
    const dice: DieResult[] = Array.from({ length: count }, () => {
      const value = roll();
      // A face a player entered is the one they kept: their own die already
      // took the reroll, so it is not rolled a second time here.
      const final = options.faceIsFinal?.() ?? false;
      const lucky = !final && grammarReroll > 0 && value <= grammarReroll && grammarRerollsLeft > 0;
      if (lucky) {
        grammarRerollsLeft -= 1;
      }
      if (lucky || (!final && weaponRerollAt > 0 && value <= weaponRerollAt)) {
        return { sides, value: reroll(), kept: true, rerolledFrom: value };
      }
      return { sides, value, kept: true };
    });

    if (keep) {
      const order = dice
        .map((die, index) => ({ die, index }))
        .sort((a, b) =>
          keep.mode === "highest" ? b.die.value - a.die.value : a.die.value - b.die.value,
        );
      const keptIndexes = new Set(order.slice(0, keep.count).map((entry) => entry.index));
      dice.forEach((die, index) => {
        die.kept = keptIndexes.has(index);
      });
    }

    // The floor raises kept faces below it (Reliable Talent's 10), keeping
    // the original face visible on the card.
    const floorAt = match[6] ? Number(match[6]) : 0;
    if (floorAt > 0) {
      for (const die of dice) {
        if (die.kept && die.value < floorAt) {
          die.rerolledFrom = die.value;
          die.value = Math.min(sides, floorAt);
        }
      }
    }

    const subtotal = dice.reduce((sum, die) => sum + (die.kept ? die.value : 0), 0);
    const term: DiceTerm = { kind: "dice", sign, count, sides, keep, dice, subtotal };
    terms.push(term);
    if (sides !== 20 && !keep && sign === 1) {
      again.push({ term, floorAt, reroll });
    }
  }

  // Empowered Spell: the dice that fell furthest below their average, thrown
  // again, the new faces kept whatever they are.
  if ((options.empower ?? 0) > 0) {
    const low = again
      .flatMap((entry) => entry.term.dice.map((die) => ({ entry, die })))
      .filter(({ die }) => die.value * 2 < die.sides + 1)
      .sort((a, b) => a.die.value / a.die.sides - b.die.value / b.die.sides)
      .slice(0, options.empower);
    for (const { entry, die } of low) {
      const was = die.value;
      // The face first thrown stays on the card (a floored 1 shows its 1).
      die.rerolledFrom = die.rerolledFrom ?? was;
      die.value = Math.max(entry.floorAt, entry.reroll());
      entry.term.subtotal += die.value - was;
    }
  }

  const total = terms.reduce(
    (sum, term) =>
      sum + term.sign * (term.kind === "dice" ? term.subtotal : term.value),
    0,
  );

  const result: RollResult = { expression: compact, total, terms };

  // Crit detection: the leading term is a d20 keeping a single die, and no
  // other d20 term competes. Rider dice from effect conditions ("1d20+5+1d4"
  // for a blessed attack) leave the natural face detectable.
  const diceTerms = terms.filter((term): term is DiceTerm => term.kind === "dice");
  const lead = terms[0];
  if (
    lead &&
    lead.kind === "dice" &&
    lead.sides === 20 &&
    lead.sign === 1 &&
    diceTerms.filter((term) => term.sides === 20).length === 1
  ) {
    const keptDice = lead.dice.filter((die) => die.kept);
    if (keptDice.length === 1) {
      result.natural = keptDice[0].value;
      if (result.natural === 20) {
        result.crit = "nat20";
      } else if (result.natural === 1) {
        result.crit = "nat1";
      }
    }
  }

  return result;
}

// Canonical d20 test expression for checks, saves, and attacks.
// Advantage rolls 2d20 keep highest; disadvantage keeps lowest.
export function d20Expression(modifier: number, advantage: Advantage = "none") {
  const base =
    advantage === "advantage" ? "2d20kh1" : advantage === "disadvantage" ? "2d20kl1" : "1d20";
  if (modifier > 0) {
    return `${base}+${modifier}`;
  }
  if (modifier < 0) {
    return `${base}-${Math.abs(modifier)}`;
  }
  return base;
}

export function rollD20(
  modifier: number,
  advantage: Advantage = "none",
  rng: DieRng = defaultRng,
  options: RollOptions = {},
): RollResult {
  return rollExpression(d20Expression(modifier, advantage), rng, options);
}

// The die faces an expression will roll, in roll order. Lets the UI render
// one input per physical die (e.g. "2d20kh1+4" -> [20, 20]).
export function expressionDice(expression: string): number[] {
  const faces: number[] = [];
  rollExpression(expression, (sides) => {
    faces.push(sides);
    return 1;
  });
  return faces;
}

// Scores an expression using player-supplied physical die values instead of
// the RNG. Values are consumed in roll order; keep rules, modifiers, and
// crit detection all apply exactly as in a digital roll.
export function rollExpressionWithDice(expression: string, values: number[]): RollResult {
  let index = 0;
  const result = rollExpression(expression, (sides) => {
    if (index >= values.length) {
      throw new Error("Not enough die values for this roll.");
    }
    const value = values[index];
    if (!Number.isInteger(value) || value < 1 || value > sides) {
      throw new Error(`Die ${index + 1} must be a whole number from 1 to ${sides}.`);
    }
    index += 1;
    return value;
  });
  if (index !== values.length) {
    throw new Error("Too many die values for this roll.");
  }
  return result;
}

// The faces a player rolling real dice enters for an expression: one per die.
// A reroll the expression carries ("1d20r1", a halfling's Lucky) is made with
// the die in hand, and the face they keep is the one they enter, so it asks
// for no face of its own. expressionDice counts a reroll's draw as a face
// (the server's own throw makes it), and a card built on it asked a halfling
// for two d20s that the roll then refused.
export function entryDice(expression: string): number[] {
  const faces: number[] = [];
  rollFramed(expression, (sides) => {
    faces.push(sides);
    return 1;
  }, { faceIsFinal: () => true });
  return faces;
}

// Scores a roll from the faces entered at the table, one per die in roll
// order (entryDice). A number is a face the player kept, any reroll already
// made with their own die. Null is a face the server draws: it takes the
// rerolls the expression and `options.rerollBelow` (Great Weapon Fighting)
// give a die, as the server's own throw would.
export function rollEnteredDice(expression: string, entries: ReadonlyArray<number | null>, options: RollOptions = {}): RollResult {
  let index = 0;
  let typed = false;
  const result = rollFramed(
    expression,
    (sides) => {
      if (index >= entries.length) {
        throw new Error("Not enough die values for this roll.");
      }
      const value = entries[index];
      index += 1;
      if (value === null) {
        typed = false;
        return defaultRng(sides);
      }
      if (!Number.isInteger(value) || value < 1 || value > sides) {
        throw new Error(`Die ${index} must be a whole number from 1 to ${sides}.`);
      }
      typed = true;
      return value;
    },
    { ...options, faceIsFinal: () => typed, redraw: defaultRng },
  );
  if (index !== entries.length) {
    throw new Error("Too many die values for this roll.");
  }
  return result;
}

// The reroll each entered face may take (entryDice order): the face at or
// below which it is rolled again, the term it belongs to, and whether only
// one die of that term may be (a kept pool, as at advantage). A card reads it
// to take a Pixels die's next landing in place of a face that qualified.
export type EntryReroll = { at: number; term: number; once: boolean };

export function entryRerolls(expression: string): EntryReroll[] {
  const out: EntryReroll[] = [];
  termsOf(expression).terms.forEach(({ match }, term) => {
    if (match[7] !== undefined) {
      return;
    }
    const at = match[5] ? Number(match[5]) : 0;
    for (let die = 0; die < Number(match[1]); die += 1) {
      out.push({ at, term, once: Boolean(match[3]) });
    }
  });
  return out;
}

// What a player rolling real dice does for the rerolls an expression carries
// before they enter a face, said on their roll card. With advantage or
// disadvantage only one of the dice is rerolled (SRD 5.1, Advantage and
// Disadvantage).
export function entryRerollNotes(expression: string): string[] {
  const notes: string[] = [];
  for (const { match } of termsOf(expression).terms) {
    const below = match[5] ? Number(match[5]) : 0;
    if (match[7] !== undefined || below < 1) {
      continue;
    }
    const face = below === 1 ? "a 1" : `${below} or less`;
    const count = Number(match[1]);
    notes.push(
      match[3] && count > 1
        ? `A d${match[2]} that shows ${face}: roll one of them again, once, and enter the new number.`
        : `A d${match[2]} that shows ${face}: roll it again, once, and enter the new number.`,
    );
  }
  return notes;
}

export function isValidExpression(expression: string) {
  try {
    // Roll with a constant RNG; only the parse can throw for a valid grammar.
    rollExpression(expression, () => 1);
    return true;
  } catch {
    return false;
  }
}
