import { z } from "zod";

// A faction as FactionsPanel.tsx sends it: the whole draft on add or save,
// or { standing } alone from the standing buttons. Every field is optional
// because a save may change one; the routes say "needs a name" themselves,
// and an attitude this build does not know reads as neutral there.
export const factionBodySchema = z.object({
  name: z.string().optional(),
  blurb: z.string().optional(),
  goal: z.string().optional(),
  attitude: z.string().optional(),
  power: z.number().optional(),
  tags: z.array(z.string()).optional(),
  portraitPath: z.string().optional(),
  standing: z.number().optional(),
});
