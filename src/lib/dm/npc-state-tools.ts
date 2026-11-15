import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { getNpcByName, nearestNpcName, setNpcState } from "@/lib/db/npcs";
import { badArguments, type ToolResult } from "@/lib/dm/tool-errors";
import {
  applyNpcStatePatch,
  NPC_CONDITIONS,
  NPC_CUSTODY,
  NPC_RESTRAINTS,
  npcStateWords,
} from "@/lib/dm/npc-state-logic";

// npc_state: the GM declares what happened to a tracked NPC's body (taken
// prisoner, tied, freed, knocked out, killed) and the server keeps it, so the
// roster says it every turn instead of the narrator having to remember it
// from prose (docs/specs/ogm-npc-state.md). set_npc stays who a person is and
// how they feel; this is what state they are in, which changes many times a
// scene and has rules of its own.

export const NPC_STATE_TOOL_NAMES = ["npc_state"] as const;

export const npcStateTools = [
  {
    type: "function" as const,
    function: {
      name: "npc_state",
      description:
        "When a tracked NPC is taken prisoner, tied, freed, wounded, knocked out or killed on screen, or sets out with the party or leaves it, record it here; their roster line then says it every turn. Give only what changed.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          custody: { type: "string", enum: [...NPC_CUSTODY], description: "free also removes their bonds" },
          heldBy: { type: "string", description: "with captive: who holds them" },
          restraint: { type: "string", enum: [...NPC_RESTRAINTS] },
          condition: { type: "string", enum: [...NPC_CONDITIONS] },
          withParty: { type: "boolean", description: "travels with the party: goes where they go" },
          disarmed: { type: "boolean" },
          carries: { type: "array", items: { type: "string" }, description: "replaces the list: only things that matter to the story (proof, a key), not ordinary gear" },
        },
        required: ["name"],
      },
    },
  },
];

const stateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  custody: z.enum(NPC_CUSTODY).optional(),
  heldBy: z.string().trim().max(80).optional(),
  restraint: z.enum(NPC_RESTRAINTS).optional(),
  condition: z.enum(NPC_CONDITIONS).optional(),
  withParty: z.boolean().optional(),
  disarmed: z.boolean().optional(),
  // Measured by applyNpcStatePatch, which says what to shorten.
  carries: z.array(z.string().max(400)).max(40).optional(),
});

export function handleNpcState(campaign: Campaign, rawArguments: string): ToolResult {
  let args: z.infer<typeof stateSchema>;
  try {
    args = stateSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments: npc_state needs the NPC's name and what changed.", error, rawArguments);
  }
  const npc = getNpcByName(campaign.id, args.name);
  if (!npc) {
    const near = nearestNpcName(campaign.id, args.name);
    return {
      error: near
        ? `No tracked NPC is called "${args.name}"; did you mean ${near}? Send it again with their tracked name.`
        : `No tracked NPC is called "${args.name}". Register them with set_npc first.`,
      retry: true,
    };
  }
  if (!args.custody && !args.heldBy && !args.restraint && !args.condition && args.withParty === undefined && args.disarmed === undefined && !args.carries) {
    return { error: "npc_state needs at least one of custody, heldBy, restraint, condition, withParty, disarmed or carries: what changed.", retry: true };
  }
  const applied = applyNpcStatePatch(npc.state, {
    custody: args.custody,
    heldBy: args.heldBy,
    restraint: args.restraint,
    condition: args.condition,
    withParty: args.withParty,
    disarmed: args.disarmed,
    carries: args.carries,
  });
  if ("error" in applied) {
    return { error: `${npc.name}: ${applied.error}`, retry: true };
  }
  setNpcState(npc.id, applied.state);
  const words = npcStateWords(applied.state);
  return {
    ok: true,
    npc: npc.name,
    state: words || "free and on their feet",
    note: `${npc.name} is now ${words || "free and on their feet"} on the record; their roster line says so every turn until npc_state changes it.`,
  };
}
