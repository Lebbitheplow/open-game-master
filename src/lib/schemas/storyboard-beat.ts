import { z } from "zod";

// One storyboard card as DmStoryboardPanel.tsx sends it: { kind, title } for
// a new card, the whole card for an edit. checkBeat (src/lib/workshop/
// board.ts) still trims, caps and drops what the board cannot hold; this
// only refuses a body whose fields are the wrong kind of thing.
const linkId = z.string().nullish();

export const storyboardBeatBodySchema = z.object({
  kind: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  links: z
    .object({ npcId: linkId, mapId: linkId, encounterId: linkId, locationId: linkId })
    .optional(),
  edges: z.array(z.string()).optional(),
  routes: z
    .record(z.string(), z.object({ kind: z.string().optional(), label: z.string().optional() }).nullable())
    .optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});
