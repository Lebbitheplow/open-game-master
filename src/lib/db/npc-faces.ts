// The face a tracked NPC shows on the board and in the initiative order. An
// ally the GM puts on the map or into the order is a token or an entry with
// a name and nothing else, so it drew one of the neutral faces by that name
// even when the Cast already said who they are: an elf archer fighting
// beside the party now draws the elf archer (src/lib/placeholders.ts).
import { getNpcById, getNpcByName } from "@/lib/db/npcs";
import { npcPlaceholder } from "@/lib/placeholders";

export function trackedNpcFace(campaignId: string, ref: { npcId?: string; name: string }): string | null {
  const byId = ref.npcId ? getNpcById(ref.npcId) : null;
  const npc = byId && byId.campaignId === campaignId ? byId : getNpcByName(campaignId, ref.name);
  if (!npc) {
    return null;
  }
  return npc.portraitUrl || npcPlaceholder(npc.role, npc.name, { race: npc.race, gender: npc.gender });
}
