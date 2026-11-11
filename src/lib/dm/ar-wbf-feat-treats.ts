// Chef's treats, the half of the feat its text left without numbers until
// wave 2 wrote them in (D5): "with an hour's work as you finish a long rest
// you make a number of treats equal to your proficiency bonus that keep for 8
// hours: a creature eats one as a bonus action and gains temporary hit points
// equal to your proficiency bonus."
//
// The count, the amount and the long rest are the counter's row
// (src/lib/srd/class-resources.ts chef_treats). This file holds what a
// counter alone gets wrong:
// - whose bonus action it is. The treat is eaten by the creature that gains
//   the hit points, so in a fight the eater's turn pays, not the cook's: a
//   counter charges its holder, and a friend could never have eaten one on
//   their own turn (turnPayer, read by use_resource before the charge).
// - the 8 hours, counted on the campaign's clock from the end of the cook's
//   last long rest (src/lib/db/clock.ts longRests): past it the treats have
//   spoiled and nothing is spent. A clock that never recorded the rest has
//   nothing to count from and refuses nothing.
import { getClock } from "@/lib/db/clock";
import { describeDuration } from "@/lib/dm/calendar";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";

export const TREATS_COUNTER = "chef_treats";
const KEEP_MINUTES = 8 * 60;

// The character whose turn pays for a use of this counter: the eater for a
// treat (the target named, else the cook), the holder for everything else.
export function turnPayer<S extends Pick<CharacterSheet, "id">>(counterId: string | undefined, holder: S, target: S | null | undefined): S {
  return counterId === TREATS_COUNTER && target ? target : holder;
}

// The refusal for treats made more than 8 hours ago, or null: asked before
// anything is spent.
export function treatsRefusal(campaignId: string, counterId: string, cook: Pick<CharacterSheet, "id" | "name">): ToolError | null {
  if (counterId !== TREATS_COUNTER) {
    return null;
  }
  const clock = getClock(campaignId);
  const made = clock.longRests?.[cook.id];
  if (made === undefined || clock.instant - made <= KEEP_MINUTES) {
    return null;
  }
  return {
    error: `${cook.name}'s treats were made as their last long rest ended and keep for 8 hours; ${describeDuration(clock.instant - made)} have passed and they have spoiled. The next long rest makes more. Nothing was spent.`,
    refused: "rules",
  };
}
