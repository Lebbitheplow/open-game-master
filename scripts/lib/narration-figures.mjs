// The dice read back to the table (issue #1092): a roll's total, an AC or a
// DC, dice notation, a bonus, a count of damage or hit points, in digits or
// in words. "The attack rolls a 19, a hit against your AC 14" and "The attack
// deals four damage" are the report's own lines.
//
// A measure for a live run (scripts/smoke-local.mjs), never a rule the app
// applies: it is English only, like the lines the smoke plays, and the app
// reads a table's story with a model in the table's own language. Coins,
// distances and time are the world's own numbers and are not counted.

const COUNT =
  "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)";
const DAMAGE_TYPE = "(?:slashing|piercing|bludgeoning|fire|cold|acid|poison|necrotic|radiant|lightning|thunder|force|psychic)";

const FIGURES = [
  ["roll-total", new RegExp(`\\broll(?:s|ed)?\\s+(?:an?\\s+)?(?:natural\\s+|total\\s+of\\s+)?${COUNT}\\b`, "i")],
  ["roll-total", /\bnatural\s+(?:1|20|one|twenty)\b/i],
  ["armor-class", /\bAC\s*(?:of\s+)?\d+|\barmou?r class\b/i],
  ["difficulty", /\bDC\s*(?:of\s+)?\d+|\bdifficulty class\b/i],
  ["damage-count", new RegExp(`\\b${COUNT}\\s+(?:points?\\s+of\\s+)?(?:${DAMAGE_TYPE}\\s+)?damage\\b`, "i")],
  ["hit-points", new RegExp(`\\b${COUNT}\\s+(?:hit points?|HP)\\b|\\bhit points?\\b`, "i")],
  ["dice-notation", /\b\d*d(?:4|6|8|10|12|20|100)\b/i],
  ["bonus", /(?<![\w-])[+-]\d+\b/],
];

// Every figure found, each with the text around it so a report can be
// checked by eye. One finding a kind.
export function figuresIn(narration) {
  const text = String(narration ?? "");
  const found = [];
  for (const [kind, pattern] of FIGURES) {
    const match = pattern.exec(text);
    if (match && !found.some((entry) => entry.kind === kind)) {
      found.push({ kind, match: text.slice(Math.max(0, match.index - 30), match.index + 90).replace(/\s+/g, " ") });
    }
  }
  return found;
}
