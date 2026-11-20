import { z } from "zod";

// A quest as QuestsPanel.tsx sends it. Objectives arrive as lines of text
// on a new quest and as the stored { id, text, done } rows on an edit;
// normalizeObjectives (src/lib/dm/quest-logic.ts) reads both, so each item
// is either here. A status this build does not know falls back there too.
export const questBodySchema = z.object({
  title: z.string().optional(),
  objectives: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).optional(),
  status: z.string().optional(),
  visibility: z.enum(["dm", "party"]).optional(),
});
