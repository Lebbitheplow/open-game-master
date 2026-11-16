import { z } from "zod";
import { getClock } from "@/lib/db/clock";
import type { Campaign } from "@/lib/db/campaigns";
import { getCurrentLocation } from "@/lib/db/locations";
import { getNpcAway, getNpcTier } from "@/lib/db/npc-minds";
import { getNpcByName, listNpcs, nearestNpcName, renameNpc, setNpcPlace, setNpcState, touchCast } from "@/lib/db/npcs";
import { planRename } from "@/lib/dm/entity-review-logic";
import { textKey } from "@/lib/language/text-logic";
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
        "When a tracked NPC is taken prisoner, tied, freed, wounded, knocked out or killed on screen, sets out with the party or leaves it, or eats or drinks, record it here; their roster line then says it every turn. Give only what changed.",
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
          revealedName: { type: "string", description: "the name the story just revealed for someone tracked under a description; the old one stays an alias" },
          carries: { type: "array", items: { type: "string" }, description: "second-tier NPCs only, replaces the list: only things that matter to the story (proof, a key), not ordinary gear. A first-tier NPC's things move with handle_item hand, grant_item and remove_item." },
          drank: { type: "boolean", description: "they drank enough just now: their thirst starts again from this moment" },
          ate: { type: "boolean", description: "they ate a meal just now: their hunger starts again from this moment" },
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
  revealedName: z.string().trim().min(1).max(80).optional(),
  drank: z.boolean().optional(),
  ate: z.boolean().optional(),
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
  if (!args.custody && !args.heldBy && !args.restraint && !args.condition && args.withParty === undefined && args.disarmed === undefined && !args.carries && !args.revealedName && !args.drank && !args.ate) {
    return { error: "npc_state needs at least one of custody, heldBy, restraint, condition, withParty, disarmed, carries, drank, ate or revealedName: what changed.", retry: true };
  }
  // A first-tier NPC keeps its things on a cast sheet (src/lib/db/cast-sheets.ts):
  // a list rewritten here would be the half-recorded hand-over the sheet ends.
  if (args.carries && (npc.castSheetId || getNpcTier(npc.id) === "primary")) {
    return {
      error: `${npc.name} keeps their things on their own sheet, not in carries. A thing changing hands: handle_item with action "hand" (characterId the giver, toCharacterId the taker; ${npc.name} is named by name). A thing found or made: grant_item. A thing lost or destroyed: remove_item. Send npc_state again without carries for anything else that changed.`,
      retry: true,
    };
  }
  // A name the story revealed (the armed man at the mill is Rugo): the same
  // person under it, memories, bonds and tier and all, the old one kept as
  // an alias so the transcript still finds them. Checked before anything is
  // written, so a refusal leaves the call to be sent again whole.
  let renameTo: { name: string; aliases: string[] } | null = null;
  if (args.revealedName && textKey(args.revealedName) !== textKey(npc.name)) {
    const plan = planRename(npc, args.revealedName);
    if ("error" in plan) {
      return { error: `${npc.name}: ${plan.error}`, retry: true };
    }
    const clash = listNpcs(campaign.id).find(
      (other) => other.id !== npc.id && [other.name, ...other.aliases].some((name) => textKey(name) === textKey(plan.name)),
    );
    if (clash) {
      return {
        error: `"${plan.name}" is already ${clash.name === plan.name ? "another tracked NPC" : `a name of ${clash.name}`}. If they are one person, the table merges them from the cast; otherwise send npc_state without revealedName.`,
        refused: "rules",
      };
    }
    renameTo = plan;
  }
  const applied = applyNpcStatePatch(npc.state, {
    custody: args.custody,
    heldBy: args.heldBy,
    restraint: args.restraint,
    condition: args.condition,
    withParty: args.withParty,
    disarmed: args.disarmed,
    carries: args.carries,
    ...(args.drank ? { drankAt: getClock(campaign.id).instant } : {}),
    ...(args.ate ? { ateAt: getClock(campaign.id).instant } : {}),
  });
  if ("error" in applied) {
    return { error: `${npc.name}: ${applied.error}`, retry: true };
  }
  setNpcState(npc.id, applied.state);
  // Travelling with the party means being where it is now: a prisoner the
  // record left at the mill joins the party's place when it is taken along.
  const here = applied.state.withParty ? (getCurrentLocation(campaign.id)?.name ?? "") : "";
  if (here && npc.location !== here && !getNpcAway(npc.id)) {
    setNpcPlace(npc.id, { location: here });
  }
  const name = renameTo ? (renameNpc(npc.id, renameTo.name, renameTo.aliases)?.name ?? npc.name) : npc.name;
  if (renameTo) {
    touchCast(campaign.id);
  }
  const words = npcStateWords(applied.state);
  return {
    ok: true,
    npc: name,
    ...(renameTo ? { formerly: npc.name } : {}),
    state: words || "free and on their feet",
    note: `${name} is now ${words || "free and on their feet"} on the record; their roster line says so every turn until npc_state changes it.`,
  };
}
