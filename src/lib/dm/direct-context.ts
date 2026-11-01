// What the engine needs to know beyond a card to resolve it itself
// (intent-logic.ts DirectContext), read from the campaign as it stands: the
// fight, how the card's spell resolves, and whether it is an instant blast
// on the battle map, whose squares the engine catches creatures in (issue
// 570). One reader for the turn's direct cards (src/lib/dm/turn.ts), for a
// human GM's own card (the actions route) and for a waiting card the GM
// resolves as played (src/lib/dm/resolve-card.ts), so they cannot drift.
import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import { getActiveEncounter } from "@/lib/db/encounters";
import { spellEngineName, spellFactsFor, spellMechanicsFor } from "@/lib/content";
import { blastPickOf } from "@/lib/battlemap/area-shape";
import { areaFor } from "@/lib/battlemap/hand-area";
import { zoneRowFor } from "@/lib/battlemap/zones-spells";
import { spellAreaShape } from "@/lib/dm/aoe-shape";
import { summonSpellFor } from "@/lib/srd/summon-spells";
import type { DirectContext, MessageIntent } from "@/lib/dm/intent-logic";

export function directContextFor(campaignId: string, intent: MessageIntent, authors: string[]): DirectContext {
  const encounter = getActiveEncounter(campaignId);
  const spell = intent.card === "spell" || intent.card === "reaction" ? intent.spell : undefined;
  const mech = spell ? (spellMechanicsFor({ spell, userIds: authors })?.mech ?? null) : null;
  const runsAs = spell ? spellEngineName(spell, authors) : undefined;
  const board = encounter ? getBattleMapForEncounter(encounter.id) : null;
  // A save or a blast that hits without one fills the area its text prints,
  // whatever the parsed row says: the parser misses a line "100 feet long"
  // and a "10-foot-radius sphere", and Lightning Bolt went to cast_at_enemy
  // at one goblin.
  const rolled = mech?.resolution === "save" || mech?.resolution === "auto";
  const shape = spell && (mech?.area || rolled) ? spellAreaShape(spell, authors) : null;
  const area = Boolean(mech?.area) || Boolean(rolled && shape);
  // A lasting area (a Web) is laid by its zone row and bites when its row
  // says, so only an instant blast on a board is caught at once.
  const zone = spell ? zoneRowFor({ spell, runsAs }) : null;
  const blast = board && spell && shape && rolled && !zone ? blastPickOf(shape) : null;
  // How the casting is shared out, when it can be (castShares).
  const shareKind = mech?.darts ? "darts" : mech?.attacks ? "attacks" : mech?.targets && !area ? "targets" : null;
  // A spell cast from the Hand (a reaction card's spell is use_reaction's):
  // the creatures it makes, the area it leaves, its range (issue 685).
  const cast = intent.card === "spell" && spell ? spell : null;
  const summoning = cast && runsAs ? summonSpellFor(runsAs) : null;
  const pick = cast && zone ? (board ? (areaFor({ spell: cast, runsAs })?.pick ?? "point") : "off") : null;
  return {
    inFight: Boolean(encounter),
    resolution: mech?.resolution ?? null,
    area,
    ...(blast ? { blast } : {}),
    ...(shareKind ? { shareKind } : {}),
    ...(mech?.riders?.clusterFeet ? { cluster: true } : {}),
    ...(summoning ? { summon: summoning.forms?.length === 1 ? "one" : "choose" } : {}),
    ...(pick && zone ? { lasting: { pick, ...(zone.catchesWhenLaid ? { catches: true } : {}) } } : {}),
    ...(cast && spellFactsFor(cast, authors)?.range.kind === "self" ? { selfOnly: true } : {}),
    ...(mech?.dispel ? { dispel: true } : {}),
  };
}
