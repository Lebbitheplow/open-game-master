// What each trigger-shaped reaction answers, and whether it is open now: one
// table for the engine (reaction-triggers.ts, which reads the hit record and
// last-save.ts's triggers) and for the Hand (hand-react-triggers.ts, which
// reads the same records as the encounter's view projects them). A reaction
// in this table is offered when and only when one of its triggers is open,
// and the engine refuses it with nothing to answer, spending nothing.
//
// Before this the reactions whose trigger is not a hit on someone were taken
// on the call's word: Misty Escape with no damage, Tokens of the Departed with
// nobody dead, Skirmisher with no enemy beside the rogue, and their cards sat
// open on the holder's own turn. What goes through here: every counter,
// authored reaction or authored spend whose text opens with a trigger the
// engine records. A row the table leaves out is answered by its own hit lookup
// (authored-reactions.ts) or waits on a record nobody writes yet (the handoff
// list in the pull request).
//
// Pure: no database, so a test and the Hand import it directly.
import { textKey } from "@/lib/language/text-logic";
import { authoredRows } from "@/lib/srd/authored-effects";

// One thing that happened, as both the engine and the Hand read it.
//   hit, miss    an attack on `characterId` by `creatureId`
//   save         a save `creatureId` forced on `characterId`
//   death        `creatureId` died (`killerId` struck the blow)
//   turn_end     `creatureId` ended its turn; turn_start: `creatureId` began the one now running
//   cast         `creatureId` cast a spell (at `characterId`, when aimed at one)
//   pet_damage   `characterId`'s pet took damage
//   weapon_hit   `characterId` hit `creatureId` with a weapon on their turn
//   surge        `characterId` used Action Surge this turn; wind_step: Step of the Wind
export type TriggerEventKind = "hit" | "miss" | "save" | "death" | "turn_end" | "turn_start" | "cast" | "pet_damage" | "weapon_hit" | "surge" | "wind_step";

export type TriggerEvent = {
  id: string;
  kind: TriggerEventKind;
  characterId: string;
  creatureId: string | null;
  creatureName: string;
  damaged?: boolean;
  melee?: boolean;
  spell?: boolean;
  success?: boolean;
  ability?: string;
  against?: string;
  creatureType?: string;
  killerId?: string | null;
  advantage?: string;
  petName?: string;
  amount?: number;
  type?: string;
  enemy?: boolean;
  answered: string[];
};

// A trigger record as the engine keeps it (last-save.ts) and the encounter's
// view sends it (PublicEncounter.lastSaves): the creature that did it is `forcerId`.
export type TriggerRecordView = {
  id: string;
  kind?: TriggerEventKind;
  characterId: string;
  ability: string;
  forcerId: string;
  forcer: string;
  success?: boolean;
  against?: string;
  damage?: { amount: number; type: string; spell?: boolean };
  petName?: string;
  creatureType?: string;
  killerId?: string | null;
  spell?: string;
  enemy?: boolean;
  answered?: string[];
};

export function eventOfRecord(record: TriggerRecordView): TriggerEvent {
  const kind = record.kind ?? "save";
  return {
    id: record.id,
    kind,
    characterId: record.characterId,
    creatureId: record.forcerId || null,
    creatureName: record.forcer,
    damaged: (record.damage?.amount ?? 0) > 0,
    // A save with damage is a spell's when its record names one (cast-at-player.ts).
    spell: Boolean(record.damage?.spell || record.spell),
    ...(record.success !== undefined ? { success: record.success } : {}),
    ability: record.ability,
    ...(record.against ? { against: record.against } : {}),
    ...(record.creatureType !== undefined ? { creatureType: record.creatureType } : {}),
    ...(record.killerId !== undefined ? { killerId: record.killerId } : {}),
    ...(record.petName ? { petName: record.petName } : {}),
    ...(record.damage ? { amount: record.damage.amount, type: record.damage.type } : {}),
    ...(record.enemy !== undefined ? { enemy: record.enemy } : {}),
    answered: record.answered ?? [],
  };
}

// The creature under one of the holder's marks: the condition's `quarry`.
export function quarryOf(sheet: { conditions: string[]; conditionMeta?: unknown }, mark: string): string | null {
  const key = textKey(mark);
  const held = sheet.conditions.find((entry) => textKey(entry) === key || textKey(entry).startsWith(`${key} `));
  const meta = held ? (sheet.conditionMeta as Record<string, { quarry?: string } | undefined> | undefined)?.[held] : undefined;
  return meta?.quarry ?? null;
}

export type TriggerOn =
  // Damage to the holder from a creature: a hit that dealt some, or a save it
  // forced with damage. `spell`: only a spell's.
  | { kind: "damaged"; rangeFt?: number; spell?: boolean }
  // An attack on the holder that missed.
  | { kind: "missed"; melee?: boolean }
  // An attack that hit, by a creature within the reach (Violent Attraction).
  | { kind: "hit_seen"; rangeFt: number }
  // A creature within the reach that another creature has just hit (Opportunist).
  | { kind: "struck_by_other"; rangeFt: number }
  // An attack roll or a save made within the reach; `edge`: one rolled with advantage or disadvantage.
  | { kind: "roll_near"; rangeFt: number; edge?: boolean }
  // The holder hit a creature with a weapon this turn (Hurl Through Hell, Raging Storm's sea).
  | { kind: "own_hit"; rangeFt?: number }
  // The holder used Step of the Wind this turn (Wings Unfurled).
  | { kind: "own_wind_step" }
  // A save a creature forced on the holder; `prey`: the creature under that
  // mark; `against`: a save against that condition.
  | { kind: "save_on_self"; prey?: string; against?: string }
  // A creature died: within the reach, of these types, slain by the holder, or the one under the mark.
  | { kind: "death"; rangeFt?: number; types?: string[]; byHolder?: boolean; marked?: string }
  // A creature (an enemy, with `enemy`) ended its turn within the reach.
  | { kind: "turn_end"; rangeFt: number; enemy?: boolean }
  // The creature whose turn it is began it within the reach.
  | { kind: "turn_start"; rangeFt: number }
  // A creature cast a spell within the reach; `atHolder`: aimed at the holder.
  | { kind: "cast"; rangeFt?: number; atHolder?: boolean }
  // The holder's pet took damage.
  | { kind: "pet_damage" }
  // The feature's holder used Action Surge (the reactor is an ally within the reach).
  | { kind: "surge"; rangeFt: number };

export type TriggerSpec = {
  on: TriggerOn[];
  // What the reaction waits for, in words for a refusal and a card's prompt.
  what: string;
  // The reaction acts on the trigger's creature (strikes it, makes it save):
  // a call that names a creature names the trigger it answers, and one that
  // names none answers the latest open one's.
  aimsAt?: true;
};

const DIES_NEAR = (feet: number, types?: string[]): TriggerSpec => ({
  on: [{ kind: "death", rangeFt: feet, ...(types ? { types } : {}) }],
  what: `a ${types ? types.join(" or ") : "creature"} dying within ${feet} feet of them`,
});

// By the reaction's or counter's name, or by a counter's id (keyed through
// textKey below, so "Slayer's Counter" is found as the engine names it).
const WRITTEN: Record<string, TriggerSpec> = {
  // Counters (src/lib/srd/authored-resources.json), spent through use_resource.
  sub_misty_escape: { on: [{ kind: "damaged" }], what: "damage a creature has just dealt them" },
  sub_fungal_infestation: DIES_NEAR(10, ["beast", "humanoid"]),
  sub_mantle_of_whispers: DIES_NEAR(30, ["humanoid"]),
  sub_cosmic_omen: { on: [{ kind: "roll_near", rangeFt: 30 }], what: "an attack roll or a saving throw made within 30 feet of them" },
  sub_restore_balance: { on: [{ kind: "roll_near", rangeFt: 60, edge: true }], what: "a roll made with advantage or disadvantage within 60 feet of them" },
  sub_violent_attraction: { on: [{ kind: "hit_seen", rangeFt: 60 }], what: "a weapon attack that hit, made by a creature within 60 feet of them" },
  sub_magic_users_nemesis: { on: [{ kind: "cast", rangeFt: 60 }], what: "a creature casting a spell within 60 feet of them" , aimsAt: true },
  sub_spell_thief: { on: [{ kind: "cast", atHolder: true }], what: "a spell a creature has just cast at them" , aimsAt: true },
  hurl_through_hell: { on: [{ kind: "own_hit" }], what: "a creature they have hit with an attack this turn" , aimsAt: true },
  sub_arcane_shot: { on: [{ kind: "own_hit" }], what: "an arrow of theirs that hit this turn" , aimsAt: true },
  sub_accursed_specter: { on: [{ kind: "death", byHolder: true, types: ["humanoid"] }], what: "a humanoid they have just slain" },
  sub_wings_unfurled: { on: [{ kind: "own_wind_step" }], what: "their Step of the Wind this turn" },
  // Authored reactions (src/lib/srd/authored-effects-data*.ts), taken with use_reaction.
  "perfected armor": { on: [{ kind: "turn_end", rangeFt: 30 }], what: "a creature ending its turn within 30 feet of them" , aimsAt: true },
  skirmisher: { on: [{ kind: "turn_end", rangeFt: 5, enemy: true }], what: "an enemy ending its turn within 5 feet of them" },
  "halo of spores": { on: [{ kind: "turn_start", rangeFt: 10 }], what: "a creature starting its turn within 10 feet of them" , aimsAt: true },
  "tokens of the departed": DIES_NEAR(30),
  opportunist: { on: [{ kind: "struck_by_other", rangeFt: 5 }], what: "a creature within 5 feet of them that another creature has just hit" , aimsAt: true },
  "slayer's counter": { on: [{ kind: "save_on_self", prey: "slayer's prey" }], what: "a save forced on them by the creature under their Slayer's Prey" , aimsAt: true },
  "inspiring surge": { on: [{ kind: "surge", rangeFt: 60 }], what: "an Action Surge their banneret has just used within 60 feet of them" },
  "beguiling defenses": { on: [{ kind: "save_on_self", against: "charmed" }], what: "a creature's attempt to charm them, a save against being charmed it forced" , aimsAt: true },
  "feedback loop": { on: [{ kind: "damaged" }], what: "damage a creature has just dealt them" , aimsAt: true },
  "the mark burns back": { on: [{ kind: "damaged", spell: true }], what: "damage a creature has just dealt them with a spell" , aimsAt: true },
  "duelist's flourish": { on: [{ kind: "missed", melee: true }], what: "a melee attack that has just missed them" , aimsAt: true },
  // Authored spends that wait for a trigger (src/lib/dm/authored-spends.ts).
  "master of hexes": { on: [{ kind: "death", marked: "hexblade's curse" }], what: "the death of the creature under their Hexblade's Curse" },
};

// Raging Storm's environments each wait for their own thing.
const WRITTEN_BY_GATE: Record<string, TriggerSpec> = {
  "storm aura (desert)": { on: [{ kind: "damaged", rangeFt: 10 }], what: "a hit a creature in the aura has just landed on them", aimsAt: true },
  "storm aura (sea)": { on: [{ kind: "own_hit", rangeFt: 10 }], what: "a creature in the aura they have hit this turn", aimsAt: true },
};

const keyed = (rows: Record<string, TriggerSpec>) => Object.fromEntries(Object.entries(rows).map(([key, spec]) => [key.includes("_") ? key : textKey(key), spec]));
const TABLE = keyed(WRITTEN);
const BY_GATE = keyed(WRITTEN_BY_GATE);

export function triggerSpecFor(name: string, options: { counterId?: string; gateCondition?: string } = {}): TriggerSpec | null {
  if (options.gateCondition && BY_GATE[textKey(options.gateCondition)]) return BY_GATE[textKey(options.gateCondition)];
  return (options.counterId ? TABLE[options.counterId] : undefined) ?? TABLE[textKey(name)] ?? null;
}

// The counters dealt when their trigger comes and never as a card on the
// holder's own turn (hand-spells.ts featureCards).
export const TRIGGERED_COUNTERS: readonly string[] = Object.keys(TABLE).filter((key) => key.includes("_"));

// The authored reaction that spends this counter, when the counter is that
// feature's own (the row's `counter`) and no authored spend draws on it
// (src/lib/srd/authored-effects-data*.ts): use_resource refuses it toward
// use_reaction (reaction-counters.ts) and the Hand deals no card of it on the
// holder's own turn (hand-spells.ts featureCards), since the reaction checks
// the trigger and applies the effect. A shared pool (ki, Bardic Inspiration)
// is spent by many things and is never one reaction's.
export function reactionSpending(defId: string): string | null {
  const rows = authoredRows();
  if (rows.some((row) => (row.entry.spends ?? []).some((spend) => spend.pool?.id === defId))) return null;
  for (const row of rows) {
    if (row.entry.counter !== defId) continue;
    const reaction = (row.entry.reactions ?? []).find((entry) => entry.pool && "id" in entry.pool && entry.pool.id === defId);
    if (reaction) return reaction.name;
  }
  return null;
}

// What the call is held to besides the record.
export type TriggerContext = {
  // Who takes the reaction.
  holderId: string;
  // Who holds the feature, when another takes it (Inspiring Surge's banneret).
  featureHolderId?: string;
  // Whether the creature `id` stands within `feet` of the reactor (true where no board says).
  near: (id: string, feet: number) => boolean;
  // The creature under a mark of the holder's ("slayer's prey", "hexblade's curse").
  quarry: (mark: string) => string | null;
  // This holder's answer key: an event it answered is not open to it again.
  label: string;
};

function opens(on: TriggerOn, event: TriggerEvent, ctx: TriggerContext): boolean {
  const reach = (id: string | null, feet: number | undefined) => feet === undefined || !id || id === ctx.holderId || ctx.near(id, feet);
  const self = (id: string) => id === ctx.holderId;
  switch (on.kind) {
    case "damaged":
      return self(event.characterId) && Boolean(event.creatureId) && Boolean(event.damaged) && (event.kind === "hit" || event.kind === "save") && (!on.spell || Boolean(event.spell)) && reach(event.creatureId, on.rangeFt);
    case "missed":
      return event.kind === "miss" && self(event.characterId) && (!on.melee || Boolean(event.melee));
    case "hit_seen":
      // A creature's hit on a character, or a character's weapon hit on a creature.
      return (event.kind === "hit" && Boolean(event.creatureId) && reach(event.creatureId, on.rangeFt)) || (event.kind === "weapon_hit" && reach(event.characterId, on.rangeFt));
    case "struck_by_other":
      return event.kind === "weapon_hit" && !self(event.characterId) && Boolean(event.creatureId) && reach(event.creatureId, on.rangeFt);
    case "roll_near": {
      if (event.kind !== "hit" && event.kind !== "miss" && event.kind !== "save") return false;
      // The one who rolled: the attacker for an attack, the one saving for a save.
      const roller = event.kind === "save" ? event.characterId : event.creatureId;
      return Boolean(roller) && reach(roller, on.rangeFt) && (!on.edge || (event.advantage !== undefined && event.advantage !== "none"));
    }
    case "own_hit":
      return event.kind === "weapon_hit" && self(event.characterId) && reach(event.creatureId, on.rangeFt);
    case "own_wind_step":
      return event.kind === "wind_step" && self(event.characterId);
    case "save_on_self":
      return event.kind === "save" && self(event.characterId) && Boolean(event.creatureId) && (!on.prey || event.creatureId === ctx.quarry(on.prey)) && (!on.against || textKey(event.against ?? "") === textKey(on.against));
    case "death":
      return (
        event.kind === "death" &&
        (!on.types || on.types.some((type) => textKey(event.creatureType ?? "").includes(type))) &&
        (!on.byHolder || event.killerId === ctx.holderId) &&
        (!on.marked || event.creatureId === ctx.quarry(on.marked)) &&
        reach(event.creatureId, on.rangeFt)
      );
    case "turn_end":
      return event.kind === "turn_end" && !self(event.creatureId ?? "") && (!on.enemy || Boolean(event.enemy)) && reach(event.creatureId, on.rangeFt);
    case "turn_start":
      return event.kind === "turn_start" && !self(event.creatureId ?? "") && reach(event.creatureId, on.rangeFt);
    case "cast":
      return event.kind === "cast" && Boolean(event.creatureId) && !self(event.creatureId ?? "") && (!on.atHolder || self(event.characterId)) && reach(event.creatureId, on.rangeFt);
    case "pet_damage":
      return event.kind === "pet_damage" && self(event.characterId) && (event.amount ?? 0) > 0;
    case "surge":
      return event.kind === "surge" && event.characterId === (ctx.featureHolderId ?? ctx.holderId) && reach(event.characterId, on.rangeFt);
  }
}

// The events open to this reaction now, the latest last. `creature`: only those
// the creature named did (or is).
export function openFor(spec: TriggerSpec, events: TriggerEvent[], ctx: TriggerContext, creature?: string | null): TriggerEvent[] {
  return events.filter((event) => !event.answered.includes(ctx.label) && spec.on.some((on) => opens(on, event, ctx)) && (!creature || !spec.aimsAt || event.creatureId === creature));
}

// A holder's answer key, as last-hit.ts answerKey writes it, for the Hand
// (which cannot import the record's module).
export function triggerKey(label: string, holderId: string): string {
  return `${label}@${holderId}`;
}

// The refusal for a reaction with nothing open to answer, in the words the
// engine and the Hand both use.
export function nothingToAnswer(who: string, name: string, spec: TriggerSpec, named: boolean): string {
  return `${name} answers ${spec.what}, and the server has ${named ? "none by that creature" : "nothing like it"} on record for ${who} just now. Nothing was spent.`;
}
