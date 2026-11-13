// What the mystery classes' counters do that no authored spend shape says
// (WAVE2 D5: the genre text is the rule, played on the SRD 5.1 engine;
// src/lib/classes/mystery-features.json). src/lib/dm/authored-spend-effects.ts
// hands a `mystery` spend here by the name its row gives
// (src/lib/srd/authored-effects-genre-b-mystery.ts), after authored-spends.ts
// has checked the gate, the pool and the turn. Each effect refuses before it
// writes; a refusal spends nothing.
//
//   spirit_ward      Spirit Ward, and with Chorus of the Dead "two creatures at
//                    once and also grants advantage on their next save"
//   quiet_court      "call a procession of spirits: for 1 minute they obscure,
//                    terrify (WIS save), and strike (2d8 necrotic) as you direct"
//   anchor           "when a creature within 30 ft dies, hold its spirit: it
//                    can be revived within 24 hours as if freshly dead"
//   ferrywoman       "lay a spirit to rest or release a possession without a
//                    contest; hostile entities get a CHA save"
//   story            "a named creature's public standing collapses, and its
//                    allies must save (WIS) or abandon it"
//   hypnotic         "a willing or restrained creature answers three questions
//                    truthfully under trance (WIS save resists if unwilling)"
//   dreams           "read a sleeping or unconscious creature's dreams"
//
// A use with no creature on the board to name (a haunting in a story scene, a
// witness under trance in a parlor) lays the rite on its holder for a minute,
// where the registry's line tells the GM what it does
// (src/lib/srd/genre-b-mystery-conditions.ts); the spends sweep reads a row
// that is accepted and writes nothing as dead.
//
// Before this each spent its use and handed its sentence back.
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getEnemy, listEnemies, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { creatureTypeOf } from "@/lib/bestiary/creature-type";
import { withinFeet } from "@/lib/dm/authored-saves";
import { resolveSpendEffect, type SpendContext } from "@/lib/dm/authored-spend-effects";
import { sideOf } from "@/lib/dm/combatant";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import { layEnemyConditionInstance } from "@/lib/dm/enemy-condition-lay";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { FLEEING } from "@/lib/dm/flee-logic";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { anchorSpirit } from "@/lib/dm/genre-b-mystery-anchor";
import { FILE, fileHeld, fileNameOf, onFile, openFile } from "@/lib/dm/genre-b-mystery-dossier";
import { getNpcByName } from "@/lib/db/npcs";
import { bindsWorthResisting } from "@/lib/dm/legendary-logic";
import { minutesSinceDeath } from "@/lib/dm/revival";
import { rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import { rollAgainst } from "@/lib/roll-labels";
import { computeSheetDerived } from "@/lib/srd";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { ARCHETYPE, CHORUS, DEADLINE, DOORSTEP_RITE, DREAM_RITE, EXAMINED, WARY, FERRY_RITE, QUIET_COURT, SPIRIT_ANCHORED, SPIRIT_WARD, STORY_RITE, TRANCE, TRANCE_RITE } from "@/lib/srd/genre-b-mystery-conditions";
import { isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

type Resolution = ToolError | { patch?: Record<string, unknown>; result: Record<string, unknown> };

const MINUTE = 10;
// 24 hours of six-second rounds.
const DAY = 24 * 600;

// 8 + proficiency + the class's own ability, as every genre counter's save
// that names no DC (src/lib/srd/counter-rules.ts counterSaveDc).
function dcOf(sheet: CharacterSheet, ability: "int" | "wis" | "cha"): number {
  const derived = computeSheetDerived(sheet);
  return 8 + derived.proficiencyBonus + derived.abilityMods[ability];
}

function namedEnemy(ctx: SpendContext): EncounterEnemy | null {
  const ref = ctx.args.targetEnemyId;
  const enemy = ref && ctx.encounter ? resolveTargetFoe(ctx.campaign.id, ctx.encounter, ref) : null;
  return enemy && enemy.status === "alive" ? enemy : null;
}

function namedCharacter(ctx: SpendContext): CharacterSheet | null {
  const sheet = ctx.args.targetCharacterId ? getSheetById(ctx.args.targetCharacterId) : null;
  return sheet && sheet.campaignId === ctx.campaign.id ? sheet : null;
}

function save(ctx: SpendContext, enemy: EncounterEnemy, ability: "wis" | "cha", dc: number, against: string | undefined) {
  return rollEnemySave(ctx.campaign.id, enemy, ability, dc, {
    resist: against ? bindsWorthResisting([against]) : true,
    ...(against ? { against } : {}),
    origin: { ref: ctx.sheet.id },
    record: { turn: ctx.turn ?? undefined, detail: `${enemy.displayName}: ${ability.toUpperCase()} save against ${ctx.spend.name}` },
  });
}

function withCondition(ctx: SpendContext, target: CharacterSheet, condition: string, meta: Record<string, unknown>) {
  const fresh = getSheetById(target.id) ?? target;
  const kept = fresh.conditions.filter((entry) => textKey(entry) !== textKey(condition));
  const updated = patchSheet(fresh.id, { conditions: [...kept, condition], conditionMeta: { ...fresh.conditionMeta, [condition]: meta } });
  if (updated) {
    publishPersisted(ctx.campaign.id, "sheet_updated", { sheet: updated });
  }
}

// The rite laid on its holder for the minute, for a use in the story.
function rite(ctx: SpendContext, condition: string, line: string): Resolution {
  const kept = ctx.sheet.conditions.filter((entry) => textKey(entry) !== textKey(condition));
  return { patch: { conditions: [...kept, condition], conditionMeta: { ...ctx.sheet.conditionMeta, [condition]: { rounds: MINUTE } } }, result: { applied: line } };
}

// ---- Spirit Ward, Chorus of the Dead ----

function spiritWard(ctx: SpendContext): Resolution {
  const warded = resolveSpendEffect(ctx, { kind: "buff", target: "ally", condition: SPIRIT_WARD, rounds: 1 });
  if ("error" in warded || !holdsGenreFeature(ctx.sheet, "spirit_medium", "Chorus of the Dead")) {
    return warded;
  }
  // "Spirit Ward can protect two creatures at once": the ally named and the
  // medium. Named for themselves alone, the medium is the one creature.
  const ally = namedCharacter(ctx);
  const lines = [...((warded.result.applied as string[] | undefined) ?? [])];
  const both = ally && ally.id !== ctx.sheet.id ? [ally, ctx.sheet] : [ctx.sheet];
  let patch = warded.patch as { conditions?: string[]; conditionMeta?: ConditionMetaMap } | undefined;
  for (const target of both) {
    if (target.id !== ctx.sheet.id) {
      // "also grants advantage on their next save": kept until that save
      // spends it (src/lib/srd/genre-b-mystery-conditions.ts).
      withCondition(ctx, target, CHORUS, { source: ctx.sheet.id });
      continue;
    }
    // The medium's own conditions are written with the spend's patch.
    const base = { conditions: patch?.conditions ?? ctx.sheet.conditions, conditionMeta: (patch?.conditionMeta ?? ctx.sheet.conditionMeta) as ConditionMetaMap };
    const add = (condition: string, meta: Record<string, unknown>) => {
      base.conditions = [...base.conditions.filter((entry) => textKey(entry) !== textKey(condition)), condition];
      base.conditionMeta = { ...base.conditionMeta, [condition]: meta } as ConditionMetaMap;
    };
    add(SPIRIT_WARD, { rounds: 1 });
    add(CHORUS, { source: ctx.sheet.id });
    patch = { ...patch, ...base };
  }
  if (both.length > 1) {
    lines.push(`Chorus of the Dead: ${ctx.sheet.name} is warded as well.`);
  }
  lines.push(`Chorus of the Dead: ${both.map((entry) => entry.name).join(" and ")} ${both.length > 1 ? "have" : "has"} advantage on the next saving throw.`);
  return { ...(patch ? { patch } : {}), result: { ...warded.result, applied: lines } };
}

// ---- Queen of the Quiet Court ----

// The call lays the procession on the medium for the minute and directs it at
// the creature named; while it lasts, "Direct the Procession" (the same row's
// second spend) sends it at another with no further use. The save is the
// terror's; a creature that makes it is passed over.
function quietCourt(ctx: SpendContext, calls: boolean): Resolution {
  const { campaign, sheet } = ctx;
  const enemy = namedEnemy(ctx);
  if (!ctx.encounter) {
    return calls
      ? rite(ctx, QUIET_COURT, `The procession of spirits walks with ${sheet.name} for a minute. There is no fight, so no creature on the board saves; the GM resolves it in the story.`)
      : { error: `${ctx.spend.name} sends the procession at a creature in a fight, and there is no fight. Nothing was spent.`, refused: "rules" };
  }
  if (!enemy) {
    return { error: `${ctx.spend.name} sends the procession at a creature of the fight (targetEnemyId). Nothing was spent.`, refused: "rules" };
  }
  const dc = dcOf(sheet, "wis");
  const rolled = save(ctx, enemy, "wis", dc, "frightened");
  const numbers = { saveAbility: "wis", dc, damage: "2d8", type: "necrotic", condition: "frightened" };
  const lines: string[] = [];
  if (rolled.success) {
    lines.push(`${enemy.displayName} holds its nerve and the spirits pass it by (WIS ${rolled.total} vs DC ${dc}).`);
  } else {
    const fresh = getEnemy(enemy.id) ?? enemy;
    if (immuneToCondition(fresh, "frightened")) {
      lines.push(`${enemy.displayName} cannot be frightened.`);
    } else {
      layEnemyConditionInstance(campaign, fresh, "frightened", { source: sheet.id, rounds: MINUTE });
      lines.push(`${enemy.displayName} is frightened of ${sheet.name} for a minute (WIS ${rolled.total} vs DC ${dc}).`);
    }
    const dealt = rollCard(campaign, ctx.turn, sheet.id, "damage", rollAgainst(ctx.spend.name, enemy.displayName), "2d8", sheetAttacker(sheet)).total;
    const struck = getEnemy(enemy.id) ?? enemy;
    if (ctx.turn) {
      const sheets = listSheets(campaign.id);
      applyEnemyDamage(campaign, ctx.turn, ctx.encounter, struck, dealt, sheets, new Map(sheets.map((entry) => [entry.id, entry])), "necrotic", { magical: true });
    } else {
      hurtEnemy(campaign, ctx.encounter, struck, dealt, "necrotic", ctx.spend.name);
    }
    lines.push(`The spirits strike ${enemy.displayName} for ${dealt} necrotic damage.`);
  }
  publishEncounter(campaign.id);
  if (calls) {
    lines.push(`The procession stays with ${sheet.name} for a minute: attacks against them are at disadvantage, and "Direct the Procession" sends it at another creature as an action.`);
  }
  return { ...(calls ? { patch: courtPatch(sheet) } : {}), result: { ...numbers, applied: lines } };
}

function courtPatch(sheet: CharacterSheet) {
  const kept = sheet.conditions.filter((entry) => textKey(entry) !== textKey(QUIET_COURT));
  return { conditions: [...kept, QUIET_COURT], conditionMeta: { ...sheet.conditionMeta, [QUIET_COURT]: { rounds: MINUTE } } };
}

// ---- Anchor of the Living ----

function anchor(ctx: SpendContext): Resolution {
  const { campaign, sheet } = ctx;
  const fallen = namedCharacter(ctx);
  // On the board the tokens decide the reach; a body the board no longer
  // shows is where the story has it.
  const map = ctx.encounter ? getBattleMapForEncounter(ctx.encounter.id) : null;
  const beyond = (id: string) => Boolean(ctx.encounter && map && getTokenByRef(map.id, id) && getTokenByRef(map.id, sheet.id) && !withinFeet(ctx.encounter.id, sheet.id, id, 30));
  if (!fallen) {
    // A creature of the fight that has just died: its spirit is held on its row.
    const enemy = ctx.args.targetEnemyId && ctx.encounter ? resolveTargetFoe(campaign.id, ctx.encounter, ctx.args.targetEnemyId) : null;
    if (!enemy) {
      return { error: `${ctx.spend.name} holds the spirit of a creature as it dies: name the character (targetCharacterId) or the creature (targetEnemyId). Nothing was spent.`, refused: "rules" };
    }
    if (enemy.status === "alive" && enemy.currentHp > 0) {
      return { error: `${enemy.displayName} is not dead, and ${ctx.spend.name} holds a spirit as its creature dies. Nothing was spent.`, refused: "rules" };
    }
    if (beyond(enemy.id)) {
      return { error: `${enemy.displayName} died beyond 30 feet of ${sheet.name}; ${ctx.spend.name} reaches no further. Nothing was spent.`, refused: "rules" };
    }
    layEnemyConditionInstance(campaign, enemy, SPIRIT_ANCHORED, { source: sheet.id, rounds: DAY });
    publishEncounter(campaign.id);
    return { result: { applied: `${sheet.name} holds ${enemy.displayName}'s spirit: for 24 hours a spell that returns the dead finds it as if freshly dead.` } };
  }
  if (fallen.id === sheet.id) {
    return { error: `${ctx.spend.name} holds another creature's spirit, not ${sheet.name}'s own. Nothing was spent.`, refused: "rules" };
  }
  const dying = !fallen.deathSaves?.dead && fallen.currentHp <= 0;
  if (!fallen.deathSaves?.dead && !dying) {
    return { error: `${fallen.name} is neither dead nor dying, and ${ctx.spend.name} holds a spirit as its creature dies. Nothing was spent.`, refused: "rules" };
  }
  // "when a creature ... dies": the minute the engine gives Revivify is the
  // moment's length; a death with no moment on record is taken at the call's word.
  const since = dying ? null : minutesSinceDeath(campaign.id, fallen.id);
  if (since !== null && since > 1) {
    return { error: `${fallen.name} died too long ago: ${ctx.spend.name} catches a spirit as its creature dies. Nothing was spent.`, refused: "rules" };
  }
  if (beyond(fallen.id)) {
    return { error: `${fallen.name} is beyond 30 feet of ${sheet.name}; ${ctx.spend.name} reaches no further. Nothing was spent.`, refused: "rules" };
  }
  anchorSpirit(campaign.id, fallen.id, sheet.name);
  withCondition(ctx, fallen, SPIRIT_ANCHORED, { source: sheet.id, rounds: DAY });
  return {
    result: {
      applied: dying
        ? `${sheet.name} stands ready to hold ${fallen.name}'s spirit: if they die within the minute, for 24 hours a spell that returns the dead finds them as if freshly dead.`
        : `${sheet.name} holds ${fallen.name}'s spirit: for 24 hours a spell that returns the dead finds them as if freshly dead (Revivify's minute does not run out).`,
    },
  };
}

// ---- Ferrywoman's Due ----

const POSSESSIONS = ["possessed", "charmed"];

function ferrywoman(ctx: SpendContext): Resolution {
  const { campaign, sheet } = ctx;
  const dc = dcOf(sheet, "wis");
  const host = namedCharacter(ctx);
  if (host) {
    // "release a possession without a contest": the hold a creature has on a
    // character, which the board keeps as possessed or charmed.
    const held = host.conditions.filter((entry) => isConditionNamed(entry, ...POSSESSIONS));
    if (!held.length) {
      return { error: `${host.name} is under no possession or charm for ${ctx.spend.name} to release. Nothing was spent.`, refused: "rules" };
    }
    const meta = host.conditionMeta as ConditionMetaMap;
    const sourceId = held.map((entry) => (meta?.[entry] as { source?: string } | undefined)?.source).find(Boolean);
    const possessor = sourceId ? getEnemy(sourceId) : null;
    if (possessor && possessor.status === "alive") {
      const rolled = save(ctx, possessor, "cha", dc, undefined);
      if (rolled.success) {
        return { result: { saveAbility: "cha", dc, applied: `${possessor.displayName} keeps its hold on ${host.name} (CHA ${rolled.total} vs DC ${dc}).` } };
      }
    }
    const cleared = removeConditions(host.conditions, meta, held);
    const updated = patchSheet(host.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
    return { result: { saveAbility: "cha", dc, applied: `${host.name} is released: ${held.join(" and ")} ended.` } };
  }
  const enemy = namedEnemy(ctx);
  if (!ctx.encounter) {
    return rite(ctx, FERRY_RITE, `${ctx.spend.name}: there is no fight, so no spirit on the board saves; the GM lays it to rest in the story (a hostile one makes a CHA save, DC ${dc}).`);
  }
  if (!enemy) {
    return { error: `${ctx.spend.name} lays an undead of the fight to rest or releases a possessed character: name the creature (targetEnemyId) or the character (targetCharacterId). Nothing was spent.`, refused: "rules" };
  }
  // A spirit is an undead on the SRD 5.1 engine (WAVE2 D5), as Mistress of the
  // Threshold reads it.
  if (creatureTypeOf(enemy.stats) !== "undead") {
    return { error: `${enemy.displayName} is no spirit: ${ctx.spend.name} lays an undead to rest. Nothing was spent.`, refused: "rules" };
  }
  const rolled = save(ctx, enemy, "cha", dc, undefined);
  if (rolled.success) {
    return { result: { saveAbility: "cha", dc, applied: `${enemy.displayName} refuses its rest (CHA ${rolled.total} vs DC ${dc}).` } };
  }
  const fresh = getEnemy(enemy.id) ?? enemy;
  const sheets = listSheets(campaign.id);
  const laid = ctx.turn
    ? applyEnemyDamage(campaign, ctx.turn, ctx.encounter, fresh, fresh.currentHp, sheets, new Map(sheets.map((entry) => [entry.id, entry])), undefined, { death: true })
    : { applied: hurtEnemy(campaign, ctx.encounter, fresh, fresh.currentHp, "", ctx.spend.name) };
  publishEncounter(campaign.id);
  return { result: { saveAbility: "cha", dc, laidToRest: enemy.displayName, applied: `${enemy.displayName} is laid to rest (CHA ${rolled.total} vs DC ${dc}).`, ...laid } };
}

// ---- The Story of the Century ----

function story(ctx: SpendContext): Resolution {
  const { campaign, sheet } = ctx;
  if (!ctx.encounter) {
    return rite(ctx, STORY_RITE, `${ctx.spend.name}: the truth is in print and the named creature's public standing collapses. There is no fight, so none of its allies on the board saves; the GM has them save (WIS, DC ${dcOf(sheet, "cha")}) or abandon it in the story.`);
  }
  const named = namedEnemy(ctx);
  if (!named) {
    return { error: `${ctx.spend.name} names the creature the story is about (targetEnemyId). Nothing was spent.`, refused: "rules" };
  }
  const side = sideOf(ctx.encounter, "enemy", named.id, named);
  const allies = listEnemies(ctx.encounter.id).filter((enemy) => enemy.id !== named.id && enemy.status === "alive" && enemy.currentHp > 0 && sideOf(ctx.encounter!, "enemy", enemy.id, enemy) === side);
  const dc = dcOf(sheet, "cha");
  const lines = [`${named.displayName}'s public standing collapses.`];
  if (!allies.length) {
    lines.push(`${named.displayName} has no ally in the fight to abandon it.`);
  }
  for (const enemy of allies) {
    const rolled = save(ctx, enemy, "wis", dc, undefined);
    if (rolled.success) {
      lines.push(`${enemy.displayName} stands by ${named.displayName} (WIS ${rolled.total} vs DC ${dc}).`);
      continue;
    }
    // "abandon it": it leaves the fight, as a creature that flees does on its
    // turns (src/lib/dm/enemy-flight.ts fleeTurn), for the minute.
    layEnemyConditionInstance(campaign, getEnemy(enemy.id) ?? enemy, FLEEING, { source: sheet.id, rounds: MINUTE });
    lines.push(`${enemy.displayName} abandons ${named.displayName} and flees (WIS ${rolled.total} vs DC ${dc}).`);
  }
  publishEncounter(campaign.id);
  return { result: { saveAbility: "wis", dc, applied: lines } };
}

// ---- Hypnotic Induction, The Unconscious Speaks ----

function hypnotic(ctx: SpendContext): Resolution {
  const { campaign, sheet } = ctx;
  const answers = "answers three questions truthfully under trance";
  const dc = dcOf(sheet, "int");
  const willing = namedCharacter(ctx);
  if (willing && willing.id !== sheet.id) {
    withCondition(ctx, willing, TRANCE, { source: sheet.id, rounds: MINUTE });
    return { result: { applied: `${willing.name}, willing, ${answers}.` } };
  }
  const enemy = namedEnemy(ctx);
  if (!ctx.encounter) {
    return rite(ctx, TRANCE_RITE, `${ctx.spend.name}: a willing or restrained creature ${answers}; an unwilling one makes a WIS save (DC ${dc}) to resist. No creature on the board was named, so the GM resolves it in the story.`);
  }
  if (!enemy) {
    return { error: `${ctx.spend.name} takes a willing character (targetCharacterId) or a restrained creature of the fight (targetEnemyId). Nothing was spent.`, refused: "rules" };
  }
  // "a willing or restrained creature"; Master of the Couch: "can be used on
  // hostile creatures in conversation".
  const restrained = enemy.conditions.some((entry) => isConditionNamed(entry, "restrained"));
  if (!restrained && !holdsGenreFeature(sheet, "alienist", "Master of the Couch")) {
    return { error: `${enemy.displayName} is neither willing nor restrained, and ${ctx.spend.name} takes no other creature. Nothing was spent.`, refused: "rules" };
  }
  const rolled = save(ctx, enemy, "wis", dc, undefined);
  if (!rolled.success) {
    layEnemyConditionInstance(campaign, getEnemy(enemy.id) ?? enemy, TRANCE, { source: sheet.id, rounds: MINUTE });
    publishEncounter(campaign.id);
  }
  return {
    result: {
      saveAbility: "wis",
      dc,
      applied: rolled.success ? `${enemy.displayName} resists the trance (WIS ${rolled.total} vs DC ${dc}).` : `${enemy.displayName} ${answers} (WIS ${rolled.total} vs DC ${dc}).`,
    },
  };
}

const ASLEEP = ["unconscious", "asleep", "sleeping"];

function dreams(ctx: SpendContext): Resolution {
  const reads = "three true impressions of its dreams, which the GM gives";
  const character = namedCharacter(ctx);
  const enemy = namedEnemy(ctx);
  const subject = character ?? enemy;
  if (!subject) {
    return ctx.encounter
      ? { error: `${ctx.spend.name} reads a sleeping or unconscious creature: name it (targetEnemyId or targetCharacterId). Nothing was spent.`, refused: "rules" }
      : rite(ctx, DREAM_RITE, `${ctx.spend.name}: ${ctx.sheet.name} reads a sleeping or unconscious creature's dreams for ${reads}.`);
  }
  const name = character ? character.name : enemy!.displayName;
  const out = subject.conditions.some((entry) => isConditionNamed(entry, ...ASLEEP)) || (character !== null && character.currentHp <= 0 && !character.deathSaves?.dead);
  if (!out) {
    return { error: `${name} is awake, and ${ctx.spend.name} reads only a sleeping or unconscious creature. Nothing was spent.`, refused: "rules" };
  }
  // The reading is the alienist's for the minute: the line the GM answers by.
  return rite(ctx, DREAM_RITE, `${ctx.sheet.name} reads ${name}'s dreams: ${reads}.`);
}

// ---- the files (src/lib/dm/genre-b-mystery-dossier.ts) ----

// The creature a file is opened on: one of the fight, or a person named in
// the variant, as the story has them.
function subjectOf(ctx: SpendContext): { name: string; npcId?: string } | ToolError {
  const enemy = ctx.args.targetEnemyId && ctx.encounter ? resolveTargetFoe(ctx.campaign.id, ctx.encounter, ctx.args.targetEnemyId) : null;
  if (enemy) {
    return { name: fileNameOf(enemy), ...(enemy.npcId ? { npcId: enemy.npcId } : {}) };
  }
  const named = (ctx.args.variant ?? "").trim();
  if (named) {
    const npc = getNpcByName(ctx.campaign.id, named);
    return { name: npc?.name ?? named, ...(npc ? { npcId: npc.id } : {}) };
  }
  return { error: `${ctx.spend.name} names a creature: one of the fight (targetEnemyId), or a person by name (variant). Nothing was spent.`, refused: "rules" };
}

function traumaMap(ctx: SpendContext): Resolution {
  const subject = subjectOf(ctx);
  if ("error" in subject) return subject;
  openFile(ctx.campaign, ctx.sheet, subject.name, FILE.trauma, subject);
  return { result: { applied: `${ctx.sheet.name} holds a Trauma Map of ${subject.name}: the GM names its deepest current fear or fixation, truthfully.` } };
}

function caseStudy(ctx: SpendContext): Resolution {
  const subject = subjectOf(ctx);
  if ("error" in subject) return subject;
  // "permanently": the one creature picked stays the pick.
  const held = fileHeld(ctx.campaign.id, ctx.sheet.id, FILE.study);
  if (held) {
    return { error: `${ctx.sheet.name}'s Case Study is ${held}, and it is theirs for good. Nothing was spent.`, refused: "rules" };
  }
  openFile(ctx.campaign, ctx.sheet, subject.name, FILE.study, subject);
  return { result: { applied: `${subject.name} is ${ctx.sheet.name}'s Case Study: advantage on Insight and Persuasion against it from now on.` } };
}

function nemesis(ctx: SpendContext): Resolution {
  const subject = subjectOf(ctx);
  if ("error" in subject) return subject;
  if (onFile(ctx.campaign.id, ctx.sheet.id, subject.name, FILE.nemesis)) {
    return { error: `${subject.name} is ${ctx.sheet.name}'s nemesis already. Nothing was spent.`, refused: "rules" };
  }
  openFile(ctx.campaign, ctx.sheet, subject.name, FILE.nemesis, { ...subject, single: true });
  return { result: { applied: `${subject.name} is ${ctx.sheet.name}'s nemesis until the case ends: advantage on every check and save opposing them.` } };
}

// "your treatments treat one target's saving throw as if it rolled a 1": the
// creature named carries the mark until its next save against the alienist's spell.
function archetype(ctx: SpendContext): Resolution {
  const enemy = namedEnemy(ctx);
  if (!ctx.encounter || !enemy) {
    return { error: `${ctx.spend.name} marks a creature of the fight for the alienist's next treatment (targetEnemyId). Nothing was spent.`, refused: "rules" };
  }
  layEnemyConditionInstance(ctx.campaign, enemy, ARCHETYPE, { source: ctx.sheet.id, rounds: MINUTE });
  publishEncounter(ctx.campaign.id);
  return { result: { applied: `${enemy.displayName}'s next saving throw against ${ctx.sheet.name}'s treatment counts as a roll of 1.` } };
}

// "cast one treatment of 5th level or lower without a slot; it cannot be
// resisted by creatures you have a Trauma Map of".
function examinedMind(ctx: SpendContext): Resolution {
  const free = resolveSpendEffect(ctx, { kind: "buff", condition: "slotless cast (5th)", rounds: 600 });
  if ("error" in free) return free;
  const patch = (free.patch ?? {}) as { conditions?: string[]; conditionMeta?: ConditionMetaMap };
  const conditions = [...(patch.conditions ?? ctx.sheet.conditions).filter((entry) => textKey(entry) !== textKey(EXAMINED)), EXAMINED];
  return { patch: { ...patch, conditions, conditionMeta: { ...((patch.conditionMeta ?? ctx.sheet.conditionMeta) as ConditionMetaMap), [EXAMINED]: { rounds: 600 } } }, result: free.result };
}

function investigated(ctx: SpendContext): Resolution {
  const subject = subjectOf(ctx);
  if ("error" in subject) return subject;
  if (onFile(ctx.campaign.id, ctx.sheet.id, subject.name, FILE.investigated)) {
    return { error: `${ctx.sheet.name} has ${subject.name} on file already. Nothing was spent.`, refused: "rules" };
  }
  openFile(ctx.campaign, ctx.sheet, subject.name, FILE.investigated, subject);
  return { result: { applied: `${ctx.sheet.name} has investigated ${subject.name}: it cannot surprise them.` } };
}

function workingFolk(ctx: SpendContext): Resolution {
  const subject = subjectOf(ctx);
  if ("error" in subject) return subject;
  if (onFile(ctx.campaign.id, ctx.sheet.id, subject.name, FILE.kin)) {
    return { error: `${ctx.sheet.name} knows ${subject.name} for working folk already. Nothing was spent.`, refused: "rules" };
  }
  openFile(ctx.campaign, ctx.sheet, subject.name, FILE.kin, subject);
  return { result: { applied: `${subject.name} is working folk to ${ctx.sheet.name}: advantage on Persuasion with them.` } };
}

// "A creature you surprise with a question answers before thinking: one
// truthful sentence (WIS save negates)". Asked once, it is surprised no more.
function doorstep(ctx: SpendContext): Resolution {
  const dc = dcOf(ctx.sheet, "cha");
  if (!ctx.encounter) {
    return rite(ctx, DOORSTEP_RITE, `${ctx.spend.name}: the creature surprised by ${ctx.sheet.name}'s question answers before thinking, one truthful sentence, unless it makes a WIS save (DC ${dc}).`);
  }
  const enemy = namedEnemy(ctx);
  if (!enemy) {
    return { error: `${ctx.spend.name} is a question put to a creature of the fight (targetEnemyId). Nothing was spent.`, refused: "rules" };
  }
  if (enemy.conditions.some((entry) => isConditionNamed(entry, WARY))) {
    return { error: `${enemy.displayName} has been caught by a question already and is not surprised by another. Nothing was spent.`, refused: "rules" };
  }
  const rolled = save(ctx, enemy, "wis", dc, undefined);
  layEnemyConditionInstance(ctx.campaign, getEnemy(enemy.id) ?? enemy, WARY, { source: ctx.sheet.id, rounds: 10 * MINUTE });
  publishEncounter(ctx.campaign.id);
  return {
    result: {
      saveAbility: "wis",
      dc,
      applied: rolled.success ? `${enemy.displayName} catches itself and says nothing (WIS ${rolled.total} vs DC ${dc}).` : `${enemy.displayName} answers before thinking: one truthful sentence (WIS ${rolled.total} vs DC ${dc}).`,
    },
  };
}

// The GM's word that the clock is on a check: the muckraker's next one has advantage.
function deadline(ctx: SpendContext): Resolution {
  return rite(ctx, DEADLINE, `${ctx.sheet.name} works to a deadline: advantage on their next ability check.`);
}

const EFFECTS: Record<string, (ctx: SpendContext) => Resolution> = {
  investigated,
  working_folk: workingFolk,
  doorstep,
  deadline,
  trauma_map: traumaMap,
  case_study: caseStudy,
  nemesis,
  archetype,
  examined_mind: examinedMind,
  spirit_ward: spiritWard,
  quiet_court: (ctx) => quietCourt(ctx, true),
  quiet_court_direct: (ctx) => quietCourt(ctx, false),
  anchor,
  ferrywoman,
  story,
  hypnotic,
  dreams,
};

export function mysterySpend(ctx: SpendContext, effect: string): Resolution {
  const run = EFFECTS[effect];
  if (!run) {
    return { error: `${ctx.spend.name} names an effect the server does not know (${effect}).`, retry: true };
  }
  return run(ctx);
}
