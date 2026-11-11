// The squares a character's spell may be cast from besides their own, asked
// by every door that measures a character's spell from where they stand when
// it would refuse for range or a blocked line (cast-reach.ts
// spellReachProblem, the one heal, cast_at_enemy and cast_buff use;
// zone-cast.ts for a laid area; pc-attack-plan.ts for an attack-roll spell):
//
//   - a Scribes wizard's spellbook mind (scribe-mind.ts castFromMind), which
//     spends a use of Manifest Mind casting;
//   - a Circle of Wildfire druid's spirit, for a fire or healing spell while
//     it is out (Enhanced Bond: "you may cast them from the spirit's
//     position"). No call names it: a spell that does not reach from the
//     druid and reaches from the spirit is cast from the spirit, as the
//     player would choose.
//
// `reachesFrom` is the door's own range and line with the origin's token in
// the caster's place. The square cast from, or null to leave the door's own
// refusal standing.
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import type { BattleToken } from "@/lib/battlemap/types";
import { getSheetById } from "@/lib/db/sheets";
import { spellMechanicsFor } from "@/lib/content";
import { castFromMind } from "@/lib/dm/scribe-mind";
import { sheetSpellAuthors } from "@/lib/dm/spell-authors";
import { summonsOf } from "@/lib/dm/summon-store";
import { textKey } from "@/lib/language/text-logic";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import type { SpellFacts } from "@/lib/srd/spell-facts";

type Origin = { encounterId: string; casterId: string; facts: Pick<SpellFacts, "name" | "classes"> | null; reachesFrom: (origin: BattleToken) => boolean };

const SPIRIT_CONDITION = "wildfire spirit";
const SPIRIT_SPELL = "Summon Wildfire Spirit";

export function castFromElsewhere(input: Origin): { x: number; y: number } | null {
  return castFromMind(input) ?? castFromSpirit(input);
}

function castFromSpirit(input: Origin): { x: number; y: number } | null {
  const sheet = getSheetById(input.casterId);
  if (!sheet || !input.facts || !holdsFeature(sheet, "Enhanced Bond") || !sheet.conditions.some((entry) => isConditionNamed(entry, SPIRIT_CONDITION))) {
    return null;
  }
  // "your fire and healing spells": fire as either of its types, or healing.
  const mech = spellMechanicsFor({ spell: input.facts.name, userIds: sheetSpellAuthors(sheet) })?.mech ?? null;
  const fire = [mech?.damageType, mech?.secondType].some((type) => textKey(type ?? "") === "fire");
  if (!mech || !(fire || mech.resolution === "heal")) {
    return null;
  }
  const map = getBattleMapForEncounter(input.encounterId);
  const spirit = map ? summonsOf(sheet.campaignId, sheet.id, SPIRIT_SPELL).map((summon) => getTokenByRef(map.id, summon.id)).find(Boolean) ?? null : null;
  return spirit && input.reachesFrom(spirit) ? { x: spirit.x, y: spirit.y } : null;
}
