// What use_resource asks of part wbf's features before its counters: the
// feats with a door of their own (ar-wbf-feat-doors.ts), a Spirits bard's
// Spirit Session, and a Genie warlock's Limited Wish. A door answers the
// whole call (a result), refuses it (an error), or lets the counter's own
// spend go on (null); wbfAfterSpend adds what a counter's use bought once the
// spend has gone through. mutations.ts calls both.
import { spellFactsFor, spellSchoolFor } from "@/lib/content";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { sessionMark, SESSION_SCHOOLS, UNSPOKEN } from "@/lib/dm/ar-wbf-bard-session-logic";
import { featDoorSpend } from "@/lib/dm/ar-wbf-feat-doors";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { sheetSpellAuthors } from "@/lib/dm/spell-authors";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { computeSheetDerived } from "@/lib/srd";
import { matchResource } from "@/lib/srd/class-resources";
import { recordItemCast } from "@/lib/srd/item-cast-credit";
import { highestSlotLevel } from "@/lib/srd/scrolls";

type DoorArgs = { variant?: string; targetEnemyId?: string; targetCharacterId?: string; amount?: number };

const SESSION = "sub_spirit_session";
const WISH = "sub_limited_wish";
const WISH_LEVEL = 6;

// A use spent with no spell named (the Hand's card sends the bare call) waits
// for its spell under this mark: the next call names it in variant and spends
// nothing more. The long rest clears a mark nobody answered
// (ar-wbf-bard-session-logic.ts).
const waiting = (sheet: CharacterSheet, id: string) => sheet.conditions.some((entry) => textKey(entry) === textKey(UNSPOKEN[id] ?? ""));
const without = (sheet: CharacterSheet, id: string) => sheet.conditions.filter((entry) => textKey(entry) !== textKey(UNSPOKEN[id] ?? ""));

export function wbfDoorSpend(campaign: Campaign, turnId: string, stale: CharacterSheet, resourceName: string, args: DoorArgs): ToolResult | null {
  const feat = featDoorSpend(campaign, turnId, stale, resourceName, args);
  if (feat) {
    return feat;
  }
  const id = matchResource(resourceName)?.id;
  if (id !== SESSION && id !== WISH) {
    return null;
  }
  const sheet = getSheetById(stale.id) ?? stale;
  if (!sheet.resources?.[id]) {
    return null;
  }
  // No spell named: the counter's own spend goes on, and wbfAfterSpend
  // leaves the mark the next call answers.
  if (!(args.variant ?? "").trim()) {
    return null;
  }
  if (id === SESSION) {
    return spiritSession(campaign, sheet, args);
  }
  const refusal = wishRefusal(sheet, args.variant);
  if (refusal || !waiting(sheet, WISH)) {
    return refusal;
  }
  // The wish was spent with no spell named: this call names it.
  patchSheetAudited(campaign.id, sheet.id, { conditions: without(sheet, WISH) }, { kind: "clear_condition", reason: "Limited Wish: the spell is named", delta: { condition: UNSPOKEN[WISH] } });
  return { ok: true, resource: "Limited Wish", ...wishCredit(sheet, args.variant) };
}

export function wbfAfterSpend(campaign: Campaign, stale: CharacterSheet, counterId: string | undefined, args: DoorArgs): Record<string, unknown> {
  if (counterId !== WISH && counterId !== SESSION) {
    return {};
  }
  const sheet = getSheetById(stale.id) ?? stale;
  if (!(args.variant ?? "").trim()) {
    if (!waiting(sheet, counterId)) {
      patchSheetAudited(campaign.id, sheet.id, { conditions: [...sheet.conditions, UNSPOKEN[counterId]] }, { kind: "set_condition", reason: "the use waits for its spell", delta: { condition: UNSPOKEN[counterId] } });
    }
    return {
      pick: counterId === WISH
        ? 'The wish is spent and waits for its spell: use_resource "Limited Wish" with the spell in variant (6th level or lower, a casting time of one action). Nothing more is spent.'
        : 'The session is held and waits for its spell: use_resource "Spirit Session" with the divination or necromancy spell in variant and the creatures who took part, the bard included, in amount. Nothing more is spent.',
    };
  }
  return counterId === WISH ? wishCredit(sheet, args.variant) : {};
}

function wishCredit(sheet: CharacterSheet, variant: string | undefined): Record<string, unknown> {
  const facts = spellFactsFor(variant ?? "", sheetSpellAuthors(sheet));
  if (!facts) {
    return {};
  }
  // The spell is cast as one from an item is (src/lib/srd/item-cast-credit.ts):
  // no slot, no components, the action already paid, and no need to know it.
  recordItemCast(sheet.id, { spell: facts.name, level: facts.level, item: "Limited Wish" });
  return {
    wish: `Limited Wish produces ${facts.name}: cast it now with its own tool (pc_attack, cast_at_enemy, aoe_damage, cast_buff, heal or use_spell_slot). No spell slot and no component is spent, ${sheet.name} need not know the spell, and the action is already paid.`,
  };
}

// Limited Wish: "the effect of one spell of 6th level or lower, from any
// class's list, with a casting time of one action". Null when the spell fits.
function wishRefusal(sheet: CharacterSheet, variant: string | undefined): ToolResult | null {
  const asked = (variant ?? "").trim();
  if (!asked) {
    return { error: "Limited Wish produces one spell's effect: name the spell in variant (6th level or lower, a casting time of one action, from any class's list). Nothing was spent.", retry: true };
  }
  const facts = spellFactsFor(asked, sheetSpellAuthors(sheet));
  if (!facts) {
    return { error: `No spell called "${asked}" is known. Name the spell Limited Wish produces in variant. Nothing was spent.`, retry: true };
  }
  if (facts.level > WISH_LEVEL) {
    return { error: `${facts.name} is a level ${facts.level} spell, and Limited Wish produces a spell of 6th level or lower. Nothing was spent.`, refused: "rules" };
  }
  if (facts.castingTime !== "action") {
    return { error: `${facts.name} does not have a casting time of one action, and Limited Wish's spell must. Nothing was spent.`, refused: "rules" };
  }
  return null;
}

// Spirit Session: the ritual of a rest, its use spent here. `amount` is the
// number of creatures who took part, the bard included (one when left out).
function spiritSession(campaign: Campaign, sheet: CharacterSheet, args: DoorArgs): ToolResult {
  const state = sheet.resources[SESSION];
  // Held already with no spell named: this call names it and spends nothing.
  const held = waiting(sheet, SESSION);
  if (!held && state.max - state.used < 1) {
    return { error: `${sheet.name} has held a Spirit Session since their last long rest; it comes back with the next. Nothing was spent.`, refused: "rules" };
  }
  const encounter = getActiveEncounter(campaign.id);
  if (encounter && (encounter.kind ?? "fight") === "fight") {
    return { error: "Spirit Session is an hour-long ritual held during a short or long rest, not in a fight. Nothing was spent.", refused: "rules" };
  }
  const asked = (args.variant ?? "").trim();
  const authors = sheetSpellAuthors(sheet);
  const facts = asked ? spellFactsFor(asked, authors) : null;
  if (!facts) {
    return { error: `Spirit Session teaches one divination or necromancy spell: name it in variant${asked ? ` (no spell called "${asked}" is known)` : ""}, and the number of creatures who took part, the bard included, in amount. Nothing was spent.`, retry: true };
  }
  const school = textKey(spellSchoolFor(facts.runsAs ?? facts.name, authors) ?? "");
  if (!SESSION_SCHOOLS.includes(school)) {
    return { error: `${facts.name} is ${school ? `a spell of ${school}` : "of no school on record"}, and Spirit Session teaches a divination or necromancy spell. Nothing was spent.`, refused: "rules" };
  }
  const took = Math.max(1, args.amount ?? 1);
  const most = computeSheetDerived(sheet).proficiencyBonus;
  if (took > most) {
    return { error: `Spirit Session is held with up to ${sheet.name}'s proficiency bonus in willing creatures, themselves included: ${most}, not ${took}. Nothing was spent.`, refused: "rules" };
  }
  if (facts.level > highestSlotLevel(sheet)) {
    return { error: `${facts.name} is a level ${facts.level} spell, above the levels ${sheet.name} can cast; Spirit Session teaches a spell of a level they can cast. Nothing was spent.`, refused: "rules" };
  }
  if (facts.level > took) {
    return { error: `${facts.name} is a level ${facts.level} spell, and Spirit Session teaches a spell of a level no higher than the number of creatures who took part (${took}; send it in amount, the bard included). Nothing was spent.`, refused: "rules" };
  }
  const casting = sheet.spellcasting;
  if (!casting) {
    return { error: `${sheet.name} casts no spells. Nothing was spent.`, refused: "rules" };
  }
  const list = facts.level === 0 ? "cantrips" : "prepared";
  const theirs = [...(casting.cantrips ?? []), ...(casting.known ?? []), ...(casting.prepared ?? [])].some((name) => textKey(name) === textKey(facts.name));
  if (theirs) {
    return { error: `${sheet.name} already has ${facts.name}; Spirit Session teaches a spell they lack. Nothing was spent.`, refused: "rules" };
  }
  const mark = sessionMark(facts.name);
  patchSheetAudited(
    campaign.id,
    sheet.id,
    {
      ...(held ? {} : { resources: { ...sheet.resources, [SESSION]: { max: state.max, used: state.used + 1 } } }),
      spellcasting: { ...casting, [list]: [...(casting[list] ?? []), facts.name] },
      // The mark carries no clock of its own: the long rest's patch takes it
      // and the spell together (ar-wbf-bard-session-logic.ts sessionForgotten).
      conditions: [...without(sheet, SESSION), mark],
    },
    { kind: "use_resource", reason: `Spirit Session: learns ${facts.name}`, delta: { resource: "Spirit Session", spent: held ? 0 : 1 } },
  );
  return {
    ok: true,
    resource: "Spirit Session",
    learned: facts.name,
    participants: took,
    applied: `${sheet.name} learns ${facts.name} from the spirits: it is a bard spell of theirs, cast with their slots, beside the spells they know, until they start a long rest.`,
  };
}
