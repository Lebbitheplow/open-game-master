// What the engine needs to know beyond a card to resolve it itself
// (intent-logic.ts DirectContext), read from the campaign as it stands: the
// fight, how the card's spell resolves, and whether it is an instant blast
// on the battle map, whose squares the engine catches creatures in (issue
// 570). One reader for the turn's direct cards (src/lib/dm/turn.ts), for a
// human GM's own card (the actions route) and for a waiting card the GM
// resolves as played (src/lib/dm/resolve-card.ts), so they cannot drift.
import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { completedCastingOf } from "@/lib/dm/long-casting-logic";
import { storerNamed } from "@/lib/dm/ring-store";
import { textKey } from "@/lib/language/text-logic";
import { itemCastHeld, itemCastRows } from "@/lib/battlemap/hand-items";
import { linesNamed } from "@/lib/srd/item-row";
import { getFoe } from "@/lib/dm/sheet-foe";
import { beamConnected, beamHeld } from "@/lib/dm/witch-bolt";
import { spellEngineName, spellFactsFor, spellMechanicsFor } from "@/lib/content";
import { blastPickOf } from "@/lib/battlemap/area-shape";
import { areaFor } from "@/lib/battlemap/hand-area";
import { zoneRowFor } from "@/lib/battlemap/zones-spells";
import { spellAreaShape } from "@/lib/dm/aoe-shape";
import { boardCatchesCast } from "@/lib/dm/area-casting";
import { summonSpellFor } from "@/lib/srd/summon-spells";
import { isFindFamiliar } from "@/lib/srd/familiar-forms";
import type { DirectContext, MessageIntent } from "@/lib/dm/intent-logic";

export function directContextFor(campaignId: string, intent: MessageIntent, authors: string[], characterId: string): DirectContext {
  const encounter = getActiveEncounter(campaignId);
  const spell = intent.card === "spell" || intent.card === "reaction" ? intent.spell : undefined;
  const known = spell ? spellMechanicsFor({ spell, userIds: authors }) : null;
  const mech = known?.mech ?? null;
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
  // says, so only an instant blast is a blast here; a lasting area that
  // catches as it appears is `lasting` below.
  const zone = spell ? zoneRowFor({ spell, runsAs }) : null;
  const blast = board && spell && shape && rolled && !zone ? blastPickOf(shape) : null;
  // How the casting is shared out, when it can be (castShares).
  const shareKind = mech?.darts ? "darts" : mech?.attacks ? "attacks" : mech?.targets && !area ? "targets" : null;
  // A spell cast from the Hand (a reaction card's spell is use_reaction's):
  // the creatures it makes, the area it leaves, its range (issue 685).
  const cast = intent.card === "spell" && spell ? spell : null;
  const summoning = cast && runsAs ? summonSpellFor(runsAs) : null;
  // Find Familiar binds a pet of the form named (familiar-cast.ts).
  const familiar = Boolean(cast && runsAs && isFindFamiliar(runsAs));
  const facts = cast ? spellFactsFor(cast, authors) : null;
  // A casting of a minute or more out of a ring is begun in a fight, and resolved
  // by the card played once it is done (long-casting.ts).
  const wearer = cast && intent.item && encounter && typeof facts?.castingTime === "number" ? getSheetById(characterId) : null;
  const ring = wearer && intent.item ? storerNamed(wearer, intent.item) : null;
  // Another item holds it as a ring does, unless its text makes it an action
  // (item-use.ts, hand-items.ts itemCastHeld).
  const fromItem = wearer && !ring && cast && facts ? itemCastRows(wearer).find((row) => linesNamed([row.item], intent.item ?? "").length && textKey(row.entry.spell) === textKey(cast)) : null;
  const itemHolds = Boolean(fromItem && facts && itemCastHeld(fromItem, { castingTime: String(facts.castingTime) }));
  const ringBegins = Boolean(wearer && (ring || itemHolds) && cast && !completedCastingOf(wearer, cast));
  // An item that casts at once begins nothing for a summoning that names no
  // creature: the credit would go, and no creature would come.
  const heldHere = !intent.item || Boolean(ring) || itemHolds;
  const pick = cast && zone ? (board ? (areaFor({ spell: cast, runsAs })?.pick ?? "point") : "off") : null;
  // Laid on the board, an area whose first saves come as it appears (Ice
  // Storm, Entangle, a Wall of Fire) catches whoever stands on its squares,
  // as a Fireball does (area-casting.ts boardCatch), so its card is the
  // engine's to resolve; one with nothing to roll (a Wall of Stone shoving
  // creatures aside), or off the board, stays with the GM to name them.
  const boardCatches = Boolean(cast && zone?.catchesWhenLaid && board && rolled && boardCatchesCast(authors, characterId, { spell: cast, runsAs }));
  // Witch Bolt's card at what its beam is connected to is the beam's strike;
  // at anything else it is a new casting (src/lib/dm/witch-bolt.ts). So is a
  // ring's card of that spell, wherever it is aimed.
  const caster = cast && known && mech?.repeatDice && !intent.item ? getSheetById(characterId) : null;
  const foe = caster && intent.targetId ? getFoe(intent.targetId) : null;
  const beam = Boolean(caster && foe && known && beamHeld(caster, known.name, mech) && beamConnected(caster, foe, known.name));
  return {
    inFight: Boolean(encounter),
    resolution: mech?.resolution ?? null,
    area,
    ...(blast ? { blast } : {}),
    ...(shareKind ? { shareKind } : {}),
    ...(mech?.riders?.clusterFeet ? { cluster: true } : {}),
    ...(summoning ? { summon: summoning.forms?.length === 1 ? "one" : "choose" } : familiar ? { summon: "choose" } : {}),
    ...((summoning || familiar) && typeof facts?.castingTime === "number" && heldHere ? { long: true } : {}),
    ...(pick && zone ? { lasting: { pick, ...(zone.catchesWhenLaid && !boardCatches ? { catches: true } : {}) } } : {}),
    ...(facts?.range.kind === "self" ? { selfOnly: true } : {}),
    ...(mech?.dispel ? { dispel: true } : {}),
    ...(beam ? { beam: true } : {}),
    ...(ringBegins ? { ringBegins: true } : {}),
  };
}
