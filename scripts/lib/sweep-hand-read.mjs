// Reading a card and a stored roll, for the Hand sweep (scripts/lib/sweep-hand-run.mjs).

// "1d8+3", "2d6 + 1d4 + 5" as dice by size and a flat number.
export function termsOf(expression) {
  const out = { dice: {}, flat: 0 };
  const text = String(expression ?? "").replace(/\s+/g, "");
  for (const match of text.matchAll(/([+-]?)(\d+)d(\d+)(?:k[hl]\d+)?(?:r\d+)?(?:f\d+)?|([+-]?)(\d+)(?!d)/g)) {
    if (match[3]) {
      const sign = match[1] === "-" ? -1 : 1;
      out.dice[match[3]] = (out.dice[match[3]] ?? 0) + sign * Number(match[2]);
    } else if (match[5]) {
      out.flat += (match[4] === "-" ? -1 : 1) * Number(match[5]);
    }
  }
  return out;
}

export function sameTerms(a, b) {
  const sizes = new Set([...Object.keys(a.dice), ...Object.keys(b.dice)]);
  for (const size of sizes) {
    if ((a.dice[size] ?? 0) !== (b.dice[size] ?? 0)) return false;
  }
  return a.flat === b.flat;
}

// The flat bonus of a stored d20 roll: everything that is not a die.
export function flatOf(roll) {
  return (roll.terms ?? []).filter((term) => term.kind === "modifier").reduce((sum, term) => sum + term.sign * term.value, 0);
}

// The feet a card's range line gives: the far end of "5 ft / 20/60 ft",
// "80/320 ft", "60 ft", "Touch" as 5, null for Self or words.
export function rangeFeet(range) {
  const text = String(range ?? "");
  if (/^touch$/i.test(text.trim())) return 5;
  const numbers = [...text.matchAll(/(\d+)/g)].map((match) => Number(match[1]));
  return numbers.length ? Math.max(...numbers) : null;
}
