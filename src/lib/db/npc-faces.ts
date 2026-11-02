// Who a figure on the board or in the initiative order is, and the face the
// Cast gives them. An ally the GM puts on the map or into the order is a
// token or an entry with a name and nothing else (an npc:<uuid> ref), so it
// drew one of the neutral faces by that name even when the Cast already said
// who they are: an elf archer fighting beside the party now draws the elf
// archer (src/lib/placeholders.ts), and a 3D board view draws the gender the
// Cast records (src/lib/actor-sex-logic.ts). The link is the one
// start_encounter makes: an NPC id, else the whole name or an alias.
//
// The roster is read once per projection, not once per figure.
import { getNpcById, listNpcs, npcNamedIn, type Npc } from "@/lib/db/npcs";
import { npcPlaceholder } from "@/lib/placeholders";

export type CastLookup = {
  byId(npcId: string | undefined): Npc | null;
  byName(name: string): Npc | null;
};

export function castLookup(campaignId: string): CastLookup {
  let roster: Npc[] | null = null;
  return {
    byId(npcId) {
      const npc = npcId ? getNpcById(npcId) : null;
      return npc?.campaignId === campaignId ? npc : null;
    },
    byName(name) {
      roster ??= listNpcs(campaignId);
      return npcNamedIn(roster, name);
    },
  };
}

// Their portrait, or the plate their role, race and gender pick.
export function npcFace(npc: Npc): string {
  return npc.portraitUrl || npcPlaceholder(npc.role, npc.name, { race: npc.race, gender: npc.gender });
}
