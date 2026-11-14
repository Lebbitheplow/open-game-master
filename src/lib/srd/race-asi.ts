// A race's increase of the player's choice, pick by pick. Most give every
// pick the same amount (a half-elf's two +1s); a lineage from the later books
// gives its picks different amounts (a fairy's +2 to one score and +1 to
// another: `amounts`, in pick order, so racialChoices.asi[0] takes the +2).
// Pure, so the builder and the server's check read one answer.

export type AsiChoiceShape = { count: number; amount: number; amounts?: number[] };

// What the pick at `index` adds.
export function asiPickAmount(choice: AsiChoiceShape, index: number): number {
  return choice.amounts?.[index] ?? choice.amount;
}

// The most one pick adds, and all the picks together.
export const asiPickMost = (choice: AsiChoiceShape) => Math.max(choice.amount, ...(choice.amounts ?? []));
export const asiPickTotal = (choice: AsiChoiceShape) =>
  Array.from({ length: choice.count }, (_, index) => asiPickAmount(choice, index)).reduce((sum, value) => sum + value, 0);

// The picks in words: "+2 / +1", "+1 / +1".
export const asiPickWords = (choice: AsiChoiceShape) =>
  Array.from({ length: choice.count }, (_, index) => `+${asiPickAmount(choice, index)}`).join(" / ");
