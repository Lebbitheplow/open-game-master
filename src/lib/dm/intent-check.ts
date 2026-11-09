// Asks the engine, before a card is posted, whether it may be played at all.
//
// The Hand used to post a card and mark it spent on any 2xx, and the real
// checks (can-act.ts, cast-guard.ts) ran only later, inside the DM's tool
// call: a card from a downed character, off turn, or for a spell not on the
// sheet was accepted, greyed out, and then refused where the player could not
// see why. The same checks now run first, as a dry run that writes nothing,
// and the route answers 409 with the engine's own reason.
//
// Only what the engine can judge from the card alone is asked here: whether
// the character may act, and for a spell the whole cast guard (the spell on
// the sheet, the slot, the casting state, the turn's room for it). Reach,
// the target's AC and everything the dice decide stay with the DM's tool
// call, which the model still makes.
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { canAct, type ActKind } from "@/lib/dm/can-act";
import { reactionRefusal } from "@/lib/dm/reaction-gate";
import { spendsNoReaction } from "@/lib/dm/reaction-kinds";
import { reactsForAnother, timingOfUseReaction } from "@/lib/dm/reaction-tools";
import { listSheets } from "@/lib/db/sheets";
import { withHitAim } from "@/lib/dm/last-hit";
import { freshBudget, spendAction } from "@/lib/dm/action-budget";
import { castSpell } from "@/lib/dm/cast-guard";
import { isStoredCast, type MessageIntent } from "@/lib/dm/intent-logic";
import { reactionTriggerProblem } from "@/lib/dm/reaction-spells";
import { releaseStoredSpell } from "@/lib/dm/spell-storing";
import { consumableRefusal } from "@/lib/dm/consumables";
import { findCarriedItem } from "@/lib/dm/item-logic";
import { unnamedBeads } from "@/lib/battlemap/hand-items";
import { chargedItemUse } from "@/lib/dm/item-use";
import { prepareUseItem } from "@/lib/dm/object-actions";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { hasItemTag } from "@/lib/srd/item-tags";
import { scrollSpell } from "@/lib/srd/scrolls";
import { spellEngineName } from "@/lib/content";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { reassertsControl, summonMixPlan, summonPlan, summonSpellFor } from "@/lib/srd/summon-spells";
import { familiarKindOf, isFindFamiliar } from "@/lib/srd/familiar-forms";
import { buildPet } from "@/lib/dm/pet-build";

const NO_HOOKS = { record: () => {}, publish: () => {} };

function kindOf(intent: MessageIntent): ActKind {
  switch (intent.card) {
    case "attack":
    case "rider":
      return "attack";
    case "spell":
      return "cast";
    case "feature":
      return "free";
    case "basic":
      return intent.action === "end-turn" ? "free" : intent.action === "stand-up" || intent.action === "dismount" ? "move" : intent.bonus ? "bonus" : "action";
    case "reaction":
      return "reaction";
    // A shield's action, a draw's object interaction or a free drop: the
    // tool charges the right one; here only whether they may act at all.
    case "gear":
      return intent.action === "use" ? "action" : "free";
  }
}

// A summoning card's creature and number, asked of the plan the cast will
// make (src/lib/srd/summon-spells.ts summonPlan): a creature the spell
// cannot call from that slot, or a number of it the spell does not offer
// (eight brown bears, three wolves), is refused here in the engine's words,
// before the card waits on anyone (issue 685).
function summonCardRefusal(campaign: Campaign, sheet: CharacterSheet, intent: MessageIntent): string | null {
  if (!intent.spell || (!intent.variant && !intent.count && !intent.mix?.length)) {
    return null;
  }
  const engine = spellEngineName(intent.spell, spellAuthorsFor(campaign));
  // Find Familiar's form, Pact of the Chain's four only with the pact.
  if (isFindFamiliar(engine)) {
    const built = intent.variant ? buildPet(sheet, { kind: "familiar", form: familiarKindOf(intent.variant).form }) : null;
    return built && "error" in built ? built.error : null;
  }
  const summoning = summonSpellFor(engine);
  if (!summoning || reassertsControl(summoning, intent.variant)) {
    return null;
  }
  const slot = Math.max(summoning.level, intent.slotLevel ?? summoning.level);
  // Each target's own form (Animate Dead), within the slot's budget.
  if (intent.mix?.length) {
    const plans = summonMixPlan(summoning, slot, intent.mix);
    return "error" in plans ? plans.error : null;
  }
  const plan = summonPlan(summoning, slot, intent.variant ?? "", intent.count);
  return "error" in plan ? plan.error : null;
}

// A scroll's card, asked as use_item asks a scroll: what it holds, the action, and
// whether this reader can read it. Null for a row that is no scroll holding a spell.
function scrollCastAnswer(campaign: Campaign, sheet: CharacterSheet, intent: MessageIntent): ToolResult | null {
  const row = findCarriedItem(sheet.equipment, intent.item ?? "");
  const holds = row && hasItemTag(row, "scroll") ? scrollSpell(row) : null;
  if (!row || !holds) {
    return null;
  }
  if (textKey(holds) !== textKey(intent.spell ?? "")) {
    return { error: `${row.name} holds ${holds}, not ${intent.spell}.`, refused: "rules" };
  }
  const prepared = prepareUseItem(campaign, sheet, sheet, row.name);
  return "error" in prepared ? prepared : consumableRefusal(sheet, row) ?? { ok: true };
}

// A card that casts a spell from an item, asked as use_item will ask it. A
// reaction spell is asked its trigger as well, before anything is drawn: a credit
// left waiting would pay for the next Shield the wearer cast from their own slots.
function storedCastRefusal(campaign: Campaign, sheet: CharacterSheet, intent: MessageIntent): string | null {
  const item = intent.item ?? "";
  // Which beads a Necklace of Prayer Beads holds is the GM's to say (an older
  // Hand dealt a card for every kind): the card waits until they have.
  const row = findCarriedItem(sheet.equipment, item);
  if (row && unnamedBeads(row)) {
    return `Which beads ${row.name} holds is the GM's to say; until they name them on the item, say in your own words which bead you use.`;
  }
  const released =
    releaseStoredSpell(campaign, sheet, item, intent.spell, "", { dryRun: true }) ??
    chargedItemUse(campaign, "", sheet, item, undefined, intent.spell, { dryRun: true }) ??
    scrollCastAnswer(campaign, sheet, intent);
  if (!released) {
    return `${intent.item} holds no spell to cast.`;
  }
  if (typeof released.error === "string") {
    return released.error;
  }
  if (intent.card === "reaction") {
    return reactionTriggerProblem(campaign, sheet, intent.spell ?? "", { targetEnemyId: intent.targetKind === "enemy" ? intent.targetId : undefined })?.error ?? null;
  }
  return summonCardRefusal(campaign, sheet, intent);
}

// The engine's reason the card cannot be played now, or null.
export function intentRefusal(
  campaign: Campaign,
  sheet: CharacterSheet,
  intent: MessageIntent,
): string | null {
  // Ending a turn is always allowed; the End Turn route owns it.
  if (intent.card === "basic" && intent.action === "end-turn") {
    return null;
  }
  if (isStoredCast(intent)) {
    const refused = storedCastRefusal(campaign, sheet, intent);
    if (refused || intent.card === "spell") {
      return refused;
    }
  }
  // A spell is judged by the cast guard. A reaction card's spell is cast by
  // use_reaction (src/lib/dm/reaction-spells.ts), so it is asked as that
  // cast, off turn too, and its spent reaction below as any reaction's.
  if ((intent.card === "spell" || intent.card === "reaction") && intent.spell && !isStoredCast(intent)) {
    const verdict = castSpell(
      campaign,
      "",
      sheet,
      {
        spell: intent.spell,
        ...(intent.slotLevel ? { level: intent.slotLevel } : {}),
        // A ritual card is asked as a ritual: a class that casts none is told so.
        ...(intent.ritual ? { ritual: true } : {}),
        ...(intent.card === "reaction" ? { via: "reaction" as const } : {}),
        dryRun: true,
      },
      NO_HOOKS,
    );
    if (typeof verdict.error === "string") {
      return verdict.error;
    }
    if (intent.card === "spell") {
      return summonCardRefusal(campaign, sheet, intent);
    }
  }
  const encounter = getActiveEncounter(campaign.id);
  // A reaction is asked as use_reaction asks it (reaction-gate.ts), of the hit
  // its card answers: one that answers the blow that dropped them, or is
  // taken as they drop (Necrotic Husk, Stone's Endurance), is open to a hero
  // at 0, where a bare canAct refused every card a fallen hero's Hand offers.
  // Lucky is no reaction (reaction-kinds.ts spendsNoReaction): use_reaction
  // judges it alone, and its card stays open after the reaction is spent.
  const noReaction = intent.card === "reaction" && spendsNoReaction(intent.feature ?? "");
  if (noReaction) {
    return null;
  }
  if (intent.card === "reaction") {
    const sheets = listSheets(campaign.id);
    const sheetsById = new Map(sheets.map((entry) => [entry.id, entry]));
    const asked = { feature: intent.feature ?? "", ...(intent.targetKind === "ally" && intent.targetId ? { targetCharacterId: intent.targetId } : {}) };
    const timing = timingOfUseReaction(campaign, sheet, asked, sheets, sheetsById);
    const refused = withHitAim(intent.hit, () => reactionRefusal(campaign.id, sheet, encounter, intent.feature ?? "The reaction", timing, reactsForAnother(sheet, asked, sheets, sheetsById)));
    if (refused) {
      return refused.error;
    }
  } else {
    const able = canAct({ sheet, encounter, kind: kindOf(intent) });
    if (!able.ok) {
      return able.error;
    }
  }
  // A reaction (Uncanny Dodge, Shield) needs the reaction the fight still
  // holds for them; the spend function says so in the engine's words.
  if (intent.card === "reaction" && encounter?.reactionsUsed.includes(sheet.id)) {
    const spent = spendAction({ ...freshBudget({ ownerId: sheet.id, round: encounter.round }), reactionUsed: true }, "reaction", intent.feature ?? "The reaction", sheet.name);
    return spent.ok ? null : spent.error;
  }
  return null;
}
