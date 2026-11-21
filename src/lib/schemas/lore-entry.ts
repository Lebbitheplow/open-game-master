import { z } from "zod";

// A lore entry as the Lore panel, the campaign creator's world step and a
// copy send it (LorePanel.tsx, WorldSetupFields.tsx), for both the new-entry
// and the edit route. Fields are typed here and nothing more: which
// categories and styles exist, the length caps and the uploaded-path checks
// stay with the routes and src/lib/dm/world-lore-logic.ts, which refuse each
// in its own words.
export const loreEntryBodySchema = z.object({
  category: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  tags: z.array(z.string()).optional(),
  visibility: z.string().optional(),
  pinned: z.boolean().optional(),
  imagePath: z.string().optional(),
  // null is "the whole table", as normalizeLoreAudience reads it.
  audience: z.array(z.string()).nullable().optional(),
  attachmentPath: z.string().optional(),
  style: z.string().optional(),
});
