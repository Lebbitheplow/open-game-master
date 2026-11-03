// The pure half of food and water (src/lib/dm/supplies.ts): what a meal from
// the world does to the count of days without, and which lifestyles keep a
// character fed (issue 793). A meal at a host's table or a well never reached
// the rules while food and water came only from the pack.

import { z } from "zod";
import type { Lifestyle } from "@/lib/dm/between-state";

export type Hunger = { food: number; water: number };

// Three characters at least, so a stray "x" is not taken for dinner.
export const mealArg = z.string().trim().min(3).max(200);

export const MEAL_PROPERTY = {
  type: "string",
  description:
    "Food and drink the story gives the party from outside their packs: the host's dinner and the well. Only for the supplies variant, and only when the story has them eat and drink from something other than their packs: no meal in the story, no meal here. Everyone living is back to no days without, and the next dawn costs no ration and no thirst. Scarce water still applies.",
};

// A meal now. SRD 5.1, Food and Water: "A normal day of eating resets the
// count of days without food to zero". With no water to be found, the meal is
// food alone: the DM's scarce water outranks it, so the count of days without
// water stands.
export function afterMeal(
  hunger: Record<string, Hunger>,
  livingIds: string[],
  waterRation: "half" | "none" | undefined,
): Record<string, Hunger> {
  const next = { ...hunger };
  for (const id of livingIds) {
    if (next[id]) {
      next[id] = { food: 0, water: waterRation === "none" ? next[id].water : 0 };
    }
  }
  return next;
}

// A lifestyle of squalid or better pays for food and water, so its dawn costs
// no ration (SRD 5.1, Lifestyle Expenses). Wretched is free and buys nothing,
// and a character with none chosen is on the road, living off their supplies.
export function lifestyleFeeds(lived: Lifestyle | null): boolean {
  return lived !== null && lived !== "wretched";
}
