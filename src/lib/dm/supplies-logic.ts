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
    "Food and drink from outside the packs. Only for the supplies variant, and only when the story has the party eat and drink from something else (a host's dinner, a well): no meal in the story, no meal here. Everyone living is back to no days without, and the next dawn costs no ration and no thirst. Scarce water still applies.",
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

// Whether a refused call's meal is what it got wrong, so its refusal says so.
// Only then: every other refusal keeps its words, since a lean window's next
// call carries the refusal and has no room to spare (issue 746).
export function mealRefused(rawArguments: string): boolean {
  try {
    const raw = JSON.parse(rawArguments || "{}") as Record<string, unknown> | null;
    return Boolean(raw && typeof raw === "object" && raw.meal !== undefined && !mealArg.safeParse(raw.meal).success);
  } catch {
    return false;
  }
}

export const MEAL_REFUSAL = "A meal names its source in at least 3 characters.";

// A lifestyle of squalid or better pays for food and water, so a dawn it paid
// for costs no ration (SRD 5.1, Lifestyle Expenses). `lived` is the lifestyle
// the purse kept up (lifestyle.ts livedLifestyle), null with none chosen.
// Wretched is free and buys nothing, and a character with none chosen is on
// the road, living off their supplies, unless their downtime work keeps them
// (`coveredCp`, SRD 5.1 Practicing a Profession: "a modest lifestyle without
// having to pay").
export function lifestyleFeeds(lived: Lifestyle | null, coveredCp = 0): boolean {
  return lived === null ? coveredCp > 0 : lived !== "wretched";
}
