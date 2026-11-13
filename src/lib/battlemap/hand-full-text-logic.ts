// A card's whole text for the "Full text" opener (HandAimBar.tsx, #926): its
// description, less what the rules line just above it already says. A
// spell's notes carry that line as a paragraph of their own; a weapon's
// notes run on in one paragraph whose first sentences are the line (hand.ts
// attackCards: the rules line is the first two notes), so a packed weapon
// with a third note (not proficient, a versatile grip) wrote its rules line
// twice. Pure.
import type { HandCard } from "@/lib/battlemap/hand-core";

export function cardFullText(card: Pick<HandCard, "rules" | "description">): string {
  const rules = card.rules?.trim() ?? "";
  return (card.description ?? "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .map((part) => (rules && part.startsWith(rules) ? part.slice(rules.length).trim() : part))
    .filter(Boolean)
    .join("\n\n");
}
