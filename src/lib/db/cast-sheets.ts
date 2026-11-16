// The cast sheet (docs/specs/ogm-npc-cast-sheet.md): a first-tier NPC keeps
// its things on a real sheet, as a hero and a companion do, so the item tools
// (grant_item, remove_item, use_item, handle_item and its hand) move a thing
// between a hero and that NPC in one server step that checks who holds it.
// Before this an NPC's things were a list of words that npc_state rewrote
// whole, and a hand-over was two calls the narrator could half forget: the
// key Volodar handed Brakk never reached his sheet (the raft, 2026-11-16).
//
// A cast sheet is neither a hero nor a companion. listSheets never returns
// it, so nothing that means "the heroes and their companions" (initiative,
// the party panel, experience, rests) sees one; sheet_updated is never sent
// for one (src/lib/events.ts). Its owner is an unloginable bot user, one per
// sheet like a companion's. Its numbers are an SRD commoner's and no rule
// reads them yet: a fight still runs on the NPC's own record.
//
// Made the first time the NPC needs it; the words npc_state kept in carries
// move onto it then, one item each, and the list is emptied.

import { getSheetById, createSheet, markSheetAsCast } from "@/lib/db/sheets";
import { getNpcById, setNpcCastSheet, setNpcState, type Npc } from "@/lib/db/npcs";
import { createCastUser } from "@/lib/db/users";
import { grantItemMath } from "@/lib/dm/mutation-math";
import { createSheetSchema, type CharacterSheet } from "@/lib/schemas/sheet";
import type { NpcState } from "@/lib/dm/npc-state-logic";

// An SRD 5.1 commoner: AC 10, 4 hit points, every ability 10.
function commonerInput(name: string) {
  return createSheetSchema.parse({
    name: name.slice(0, 60),
    race: "human",
    class: "commoner",
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    maxHp: 4,
    ac: 10,
    acOverride: true,
    hitDice: { die: "d8", total: 1, spent: 0 },
    proficiencies: { saves: [], skills: [], languages: [], tools: [], armor: [], weapons: [] },
  });
}

// The NPC's cast sheet, made now if it has none yet.
export function castSheetFor(npc: Npc): CharacterSheet {
  const current = npc.castSheetId ? getSheetById(npc.castSheetId) : null;
  if (current) {
    return current;
  }
  let equipment: CharacterSheet["equipment"] = [];
  for (const thing of npc.state.carries) {
    equipment = grantItemMath(equipment, thing, 1, { identified: true }).equipment;
  }
  const owner = createCastUser(npc.name);
  const created = createSheet(npc.campaignId, owner.id, 1, { ...commonerInput(npc.name), equipment }, null, { companion: true });
  const sheet = markSheetAsCast(created.id) ?? created;
  setNpcCastSheet(npc.id, sheet.id);
  const fresh = getNpcById(npc.id);
  if (fresh?.state.carries.length) {
    setNpcState(npc.id, { ...fresh.state, carries: [] });
  }
  return sheet;
}

// What the NPC has on them, by name: the cast sheet once there is one, the
// words npc_state kept before that.
export function npcThings(npc: Npc): string[] {
  const sheet = npc.castSheetId ? getSheetById(npc.castSheetId) : null;
  if (!sheet) {
    return npc.state.carries;
  }
  return sheet.equipment.map((item) => ((item.qty ?? 1) > 1 ? `${item.name} x${item.qty}` : item.name));
}

// The NPC's record with what they really carry in it, for every reader that
// shows or weighs their things (the roster, the state guard, their own mind).
export function stateWithThings(npc: Npc): NpcState {
  return npc.castSheetId ? { ...npc.state, carries: npcThings(npc) } : npc.state;
}
