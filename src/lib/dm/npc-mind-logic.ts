// Pure logic of the NPC minds (docs/specs/ogm-npc-isolation-design.md):
// what one NPC may know, how its own context is built, how its answer is
// read and checked. No database, network or model call here, and no alias
// imports, so node test scripts (scripts/test-npc-mind.mjs) load it directly.
//
// The single narrator used to read every fact and play every NPC from one
// prompt, so a stranger greeted a hero by a name nobody had said and a
// companion remembered letters to a victim that never existed. A mind keeps
// three things apart: the world's truth (world_facts, sheets, never read
// here), what this NPC knows or believes and from whom, and what it said.
// Its context is built only from its own register, so a secret it was not
// told is not withheld by a prompt rule: it is simply not there.

import { clipText, containsPhrase, textKey } from "../language/text-logic.ts";

// knowledge: perceived first hand. belief: told by someone, maybe wrong.
// hypothesis: its own conclusion, maybe wrong. said: words it spoke.
// lie: words it spoke knowing them false, never a fact it lived.
// did: what it set out to do off-screen.
export const NPC_MEMORY_KINDS = ["knowledge", "belief", "hypothesis", "said", "lie", "did"] as const;
export type NpcMemoryKind = (typeof NPC_MEMORY_KINDS)[number];

// background: established before play (an author, the GM before the NPC's
// first appearance). perceived: seen or heard in a scene. told: news from a
// named source. self: its own words, conclusions, deeds.
export const NPC_SOURCE_KINDS = ["background", "perceived", "told", "self"] as const;
export type NpcSourceKind = (typeof NPC_SOURCE_KINDS)[number];
// The source of what the scene showed a mind where it stood (npc_speak's
// moment, npc_hear's words): proof it was on stage that turn, unlike news
// from afar (npc_inform). Never read as a person's name.
export const ON_STAGE_SOURCE = "on stage";

export type NpcMemory = {
  npcId: string;
  kind: NpcMemoryKind;
  sourceKind: NpcSourceKind;
  sourceName: string;
  content: string;
  // The game clock's instant when it learned it (src/lib/dm/calendar.ts).
  learnedAt: number;
};

// The cap on what one context carries: the newest memories win, background
// always rides (it is who they are).
export const MIND_MEMORY_LIMIT = 40;
export const MIND_TEXT_CHARS = 600;

// What one NPC may read now: its own rows, learned no later than now.
export function memoriesFor(npcId: string, memories: readonly NpcMemory[], now: number): NpcMemory[] {
  const own = memories.filter((memory) => memory.npcId === npcId && memory.learnedAt <= now);
  const background = own.filter((memory) => memory.sourceKind === "background");
  const lived = own.filter((memory) => memory.sourceKind !== "background");
  return [...background, ...lived.slice(-Math.max(0, MIND_MEMORY_LIMIT - background.length))];
}

// The two tiers. The first is played by its own mind and takes turns like
// a player: every party companion (chosen when the adventure is made), and
// any NPC the adventure's maker named first-tier. The second, everyone else,
// is voiced by the narrator from their personality and a light register.
export type NpcTier = "primary" | "secondary";

export function tierOf(input: { tier: string; companionKind?: string | null }): NpcTier {
  if (input.companionKind === "party") {
    return "primary";
  }
  return input.tier === "primary" ? "primary" : "secondary";
}

// A first-tier mind apart from the party (a companion left behind,
// src/lib/dm/party-split.ts): where it is, and the game instant its life is
// already played up to. Nothing runs while nobody looks; when the story
// touches it again, a catch-up plays the time between (npc-mind.ts catchUp).
export type NpcAway = { place: string; since: number };

export const CATCH_UP_STEP_MINUTES = 12 * 60;
export const CATCH_UP_MAX_STEPS = 6;
export const CATCH_UP_MIN_MINUTES = 60;

export function parseAway(raw: string): NpcAway | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as { place?: unknown; since?: unknown };
    return typeof value.place === "string" && typeof value.since === "number" && Number.isFinite(value.since)
      ? { place: value.place, since: value.since }
      : null;
  } catch {
    return null;
  }
}

// The steps a catch-up plays, each as the instant it ends at: one per half
// day apart, at most six (a long absence is told in a few strokes), none for
// under an hour.
export function catchUpSteps(since: number, now: number): number[] {
  const elapsed = now - since;
  if (elapsed < CATCH_UP_MIN_MINUTES) {
    return [];
  }
  const count = Math.min(CATCH_UP_MAX_STEPS, Math.ceil(elapsed / CATCH_UP_STEP_MINUTES));
  return Array.from({ length: count }, (_, index) => since + Math.round((elapsed * (index + 1)) / count));
}

// How an attempt made apart from the party went, on the engine's d20.
export function attemptOutcome(d20: number): "succeeds" | "partly succeeds" | "fails" {
  return d20 >= 15 ? "succeeds" : d20 >= 8 ? "partly succeeds" : "fails";
}

export function awayRosterNote(away: NpcAway): string {
  return `apart from the party, at ${away.place || "an unknown place"}: when the story cuts to them or reaches anyone from there, call npc_speak with away: true; call it without away only once the party is back with them`;
}

// What the narrator's roster says of an NPC at a table with minds. A
// first-tier one is asked; a second-tier one is voiced from what their
// register holds, and the heroes' names only once they learned them.
export function rosterNote(tier: NpcTier, memories: readonly NpcMemory[], heroNames: readonly string[]): string {
  if (tier === "primary") {
    return "first tier: their own mind plays them; give them a turn with npc_speak, never write their words";
  }
  const known = heroNames.filter((name) => knowsName(name, memories));
  const learned = memories
    .filter((memory) => memory.sourceKind !== "self" && memory.sourceKind !== "background")
    .slice(-4)
    .map((memory) => (memory.kind === "belief" ? `told by ${memory.sourceName || "someone"}: ${memory.content}` : memory.content).slice(0, 120));
  return [
    "second tier: you voice them from their personality",
    `heroes they know by name: ${known.length ? known.join(", ") : "none"}`,
    learned.length ? `what they learned: ${learned.join(" / ")}` : "they know nothing of the party beyond what they see",
  ].join("; ");
}

// What a bystander keeps of another's words: a claim from that speaker,
// which may be false, never a fact they know. The speaker is named only to
// a hearer who already knows that name; hearing it said does not teach it.
export function overheard(
  speaker: string,
  speech: string,
  hearerMemories: readonly NpcMemory[],
): { kind: "belief"; sourceKind: "told"; sourceName: string; content: string } {
  const known = knowsName(speaker, hearerMemories);
  return {
    kind: "belief",
    sourceKind: "told",
    sourceName: known ? speaker : "someone you do not know by name",
    content: `${known ? speaker : "Someone"} said: "${speech}"`,
  };
}

// A name is known once it reached the NPC: said in something it perceived
// or was told, or the name of whoever told it. Its own words do not count:
// a name it guessed aloud is not a name it learned.
export function knowsName(name: string, memories: readonly NpcMemory[]): boolean {
  if (textKey(name).length < 2) {
    return false;
  }
  return memories.some(
    (memory) =>
      memory.sourceKind !== "self" &&
      (containsPhrase(memory.content, name) || textKey(memory.sourceName) === textKey(name)),
  );
}

export type MindPerson = { name: string; description: string };

// The people in front of it, by name only where it learned the name.
export function presentPeople(people: readonly MindPerson[], memories: readonly NpcMemory[]): string[] {
  return people.map((person) => (knowsName(person.name, memories) ? `${person.name} (${person.description})` : `someone you do not know by name: ${person.description}`));
}

export type MentalScores = { int?: number; wis?: number; cha?: number };
export type MentalBand = "very low" | "low" | "average" | "sharp" | "exceptional";

// Bands, not numbers: the model plays a description better than a score,
// and a sheet's 3 must not reason like a 20 whatever the inspiration says.
export function bandOf(score: number | undefined): MentalBand {
  if (score === undefined || !Number.isFinite(score)) {
    return "average";
  }
  if (score <= 5) {
    return "very low";
  }
  if (score <= 8) {
    return "low";
  }
  if (score <= 12) {
    return "average";
  }
  if (score <= 16) {
    return "sharp";
  }
  return "exceptional";
}

const INT_GUIDE: Record<MentalBand, string> = {
  "very low": "Reasoning: very limited. You think in simple, concrete terms, follow only what is in front of you, cannot chain clues into a theory, and speak plainly with a small vocabulary.",
  low: "Reasoning: below average. You manage everyday problems but miss subtle connections, trust the obvious explanation, and avoid long arguments.",
  average: "Reasoning: ordinary. You can link two or three facts, but you are no detective.",
  sharp: "Reasoning: sharp. You connect clues others miss and argue well, yet you can still be wrong when facts are missing.",
  exceptional: "Reasoning: brilliant. You see patterns quickly and plan ahead; your conclusions are still guesses until proven.",
};
const WIS_GUIDE: Record<MentalBand, string> = {
  "very low": "Perception and judgement: very poor. You are easily fooled and notice little.",
  low: "Perception and judgement: weak. You often miss lies and details.",
  average: "Perception and judgement: ordinary.",
  sharp: "Perception and judgement: keen. You often sense a lie or a mood.",
  exceptional: "Perception and judgement: remarkable. Little escapes you, though you can still be deceived.",
};
const CHA_GUIDE: Record<MentalBand, string> = {
  "very low": "Presence: awkward and unconvincing; people rarely heed you.",
  low: "Presence: unremarkable; you persuade poorly.",
  average: "Presence: ordinary.",
  sharp: "Presence: persuasive and memorable.",
  exceptional: "Presence: commanding; people listen when you speak.",
};

export function mentalGuide(scores: MentalScores): string[] {
  return [INT_GUIDE[bandOf(scores.int)], WIS_GUIDE[bandOf(scores.wis)], CHA_GUIDE[bandOf(scores.cha)]];
}

// Reads INT/WIS/CHA from a sheet's abilities or a monster's stats, in the
// shapes the bestiary and the sheets store them.
export function mentalScoresOf(source: unknown): MentalScores {
  const read = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
  if (!source || typeof source !== "object") {
    return {};
  }
  const record = source as Record<string, unknown>;
  const nested = record.abilities && typeof record.abilities === "object" ? (record.abilities as Record<string, unknown>) : record;
  return {
    int: read(nested.int ?? nested.intelligence),
    wis: read(nested.wis ?? nested.wisdom),
    cha: read(nested.cha ?? nested.charisma),
  };
}

export type MindBrief = {
  name: string;
  // Who they are: role, trait, personality words, goals, attitude.
  identity: string[];
  // Behaviour borrowed from a cultural figure, never its lore.
  inspiration: string;
  scores: MentalScores;
  memories: NpcMemory[];
  present: MindPerson[];
  // How they stand with the heroes they know (the relationship meter).
  bonds: string[];
  // What they directly perceive right now.
  perceives: string;
  offscreen?: boolean;
};

const MEMORY_LABEL: Record<NpcMemoryKind, string> = {
  knowledge: "you witnessed",
  belief: "you were told (it may be false)",
  hypothesis: "you suspect (unproven)",
  said: "you said",
  lie: "you lied, saying",
  did: "you set out to",
};

export function renderMemory(memory: NpcMemory): string {
  const from = memory.sourceKind === "told" && memory.sourceName ? ` by ${memory.sourceName}` : "";
  const label = memory.sourceKind === "background" ? "from your past" : `${MEMORY_LABEL[memory.kind]}${from}`;
  return `- (${label}) ${clipText(memory.content, MIND_TEXT_CHARS)}`;
}

export const MIND_SYSTEM = [
  "You are one character in a tabletop role-playing game, played by a separate mind from the Game Master.",
  "You know ONLY what is listed below as your past and your memories, plus what you perceive right now. You do not know anything else about the world, other people's secrets, or names you have not heard.",
  "Never invent past events, relationships, letters, or meetings that are not in your past or memories. If something important you know is relevant, bring it up unless you have a reason in character to keep it hidden.",
  "You may suspect, guess, be wrong, keep secrets, or lie; a guess stays a guess.",
  // How a person talks, not a witness under oath: the limits above are what
  // you know, never who you are. Played without this, every mind at the
  // table split hairs over the hero's guesses ("those are suppositions", "do
  // not confuse the two papers"), said the same caution turn after turn, and
  // talking to them was talking to a wall.
  "Talk like a living person in this moment, not a witness under oath or a clerk. First answer what was just said to you, plainly, in a few spoken sentences; then, if you want, add one thing of your own.",
  "What you do not know limits your knowledge, not your voice: give your opinions, hunches, fears and bets as yours (\"I'd wager it was him\", \"I don't trust it\"). Do not correct or lecture others about their guesses unless your nature truly calls for it; a friend who has it roughly right is agreed with, not audited.",
  "If whoever talks to you is confused, help them in simple words, the way you would help a friend; never answer confusion with finer distinctions.",
  "Never say again a point you already made (your own words are in your memories, marked as said): move the talk forward with something new, or keep silent.",
  "If you keep a secret, you keep it for a reason, and you know what would make you give up a piece of it: trust earned, a promise kept, proof, a fair trade, a threat to someone you love. When someone offers that, give up a piece. Nobody stonewalls forever, and nobody repeats the same refusal.",
  "Stay within the abilities described for you; your inspiration shapes your manner, never your knowledge or powers.",
  "You only propose: the Game Master and the rules decide what actually happens.",
  // Every character's first goal, under whatever else they want.
  "Above all your goals stands one: staying alive. Wealth, power, love, revenge or duty are worth pursuing only while you live to have them. Weigh every risk against your life: in danger you may retreat, hide, flee, surrender, bargain, beg, lie or betray. You risk your life only when your nature truly demands it (a fanatic's faith, a parent shielding a child, a debt of honour), and even then you look for a way to come out alive.",
  'Answer with ONE JSON object and nothing else: {"speech": "your exact words, or empty", "intent": "what you try to do, in one short sentence, or empty", "conclusion": "a new suspicion you formed, or empty", "lie": true if your speech is knowingly false, else false}.',
].join("\n");

export function renderMindPrompt(brief: MindBrief): string {
  const remembered = brief.memories.map(renderMemory);
  return [
    `You are ${brief.name}.`,
    ...brief.identity.filter(Boolean),
    brief.inspiration ? `Your manner is inspired by: ${clipText(brief.inspiration, 200)}. Borrow temperament and voice only; none of that figure's names, world, memories, powers or relations are yours.` : "",
    ...mentalGuide(brief.scores),
    brief.bonds.length ? `How you stand with people you know:\n${brief.bonds.map((bond) => `- ${bond}`).join("\n")}` : "",
    remembered.length ? `Your past and memories (everything you know):\n${remembered.join("\n")}` : "Your past and memories: nothing beyond who you are.",
    brief.present.length ? `Present with you:\n${presentPeople(brief.present, brief.memories).map((line) => `- ${line}`).join("\n")}` : "",
    brief.offscreen
      ? `Time passes away from the heroes. ${clipText(brief.perceives, MIND_TEXT_CHARS)}\nSay what you do next to pursue your goals (intent). Speech may stay empty.`
      : `What you perceive right now:\n${clipText(brief.perceives, MIND_TEXT_CHARS * 2)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export type NpcProposal = { speech: string; intent: string; conclusion: string; lie: boolean };

// The mind's answer, or why it is not one. A reply without a JSON object, or
// with neither words nor intent, is invalid: the turn does not fill the gap.
export function parseProposal(text: string): { ok: true; proposal: NpcProposal } | { ok: false; error: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { ok: false, error: "the reply held no JSON object" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { ok: false, error: "the reply's JSON did not parse" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "the reply was not an object" };
  }
  const record = parsed as Record<string, unknown>;
  const text_ = (value: unknown) => (typeof value === "string" ? clipText(value.trim(), MIND_TEXT_CHARS * 2) : "");
  const proposal: NpcProposal = {
    speech: text_(record.speech),
    intent: text_(record.intent),
    conclusion: text_(record.conclusion),
    lie: record.lie === true,
  };
  if (!proposal.speech && !proposal.intent) {
    return { ok: false, error: "the reply had neither words nor an intent" };
  }
  return { ok: true, proposal };
}

// Who perceives a moment: the NPC addressed and the named NPCs present,
// each once, only ones the cast holds. A name the cast does not hold is
// reported, not invented into a mind.
export function recipientsOf(
  addressed: string,
  alsoPresent: readonly string[],
  cast: ReadonlyArray<{ id: string; name: string; aliases?: string[] }>,
): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const wanted of [addressed, ...alsoPresent]) {
    const key = textKey(wanted);
    if (!key) {
      continue;
    }
    const found = cast.find((npc) => textKey(npc.name) === key || (npc.aliases ?? []).some((alias) => textKey(alias) === key));
    if (!found) {
      unknown.push(wanted);
    } else if (!ids.includes(found.id)) {
      ids.push(found.id);
    }
  }
  return { ids, unknown };
}

// Names of people and places the world holds that the NPC said without
// having learned them (A1, A3). A flag for the GM, never a block: the NPC
// may be lying or guessing, and its words never become world facts.
export function unlearnedNames(
  speech: string,
  selfName: string,
  worldNames: readonly string[],
  memories: readonly NpcMemory[],
): string[] {
  const self = textKey(selfName);
  return [...new Set(worldNames)].filter(
    (name) => textKey(name).length >= 3 && textKey(name) !== self && containsPhrase(speech, name) && !knowsName(name, memories),
  );
}

// Whether the GM may still lay down this NPC's past: only before the NPC
// has lived anything in play. A past written after it has spoken would be
// the retroactive invention the contract forbids (A3).
export function backgroundOpen(memories: readonly NpcMemory[], proposals: number): boolean {
  return proposals === 0 && memories.every((memory) => memory.sourceKind === "background");
}

// Off-screen: the NPCs with something to pursue, away from the scene, at
// most `budget`, the longest-idle first.
export function offscreenCandidates<T extends { id: string; name: string; location: string; goal: string; lastActedAt: number }>(
  npcs: readonly T[],
  here: string,
  budget: number,
): T[] {
  const place = textKey(here);
  return npcs
    .filter((npc) => npc.goal.trim() && (!place || textKey(npc.location) !== place))
    .sort((a, b) => a.lastActedAt - b.lastActedAt)
    .slice(0, Math.max(0, budget));
}

// ---- A companion's own turn in a fight ------------------------------------

// The calls by which a character spends their own turn, and the argument
// naming who acts. A first-tier companion nobody commands chooses that turn
// with its own mind: until it has, these calls for it are refused.
const TURN_ACTOR_ARG: Record<string, string> = {
  pc_attack: "characterId",
  take_action: "characterId",
  move_token: "characterId",
  use_item: "characterId",
  use_resource: "characterId",
  use_spell_slot: "characterId",
  cast_at_enemy: "characterId",
  cast_buff: "characterId",
  aoe_damage: "casterCharacterId",
  end_turn: "characterId",
};

export function turnActorOf(name: string, args: Record<string, unknown>): string | null {
  const key = TURN_ACTOR_ARG[name];
  const value = key ? args[key] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// How hurt a creature looks to someone fighting beside or against it: what
// the table sees, never the number.
export function healthWord(current: number, max: number): string {
  if (current <= 0) return "down";
  const share = max > 0 ? current / max : 1;
  if (share >= 1) return "unhurt";
  if (share > 0.5) return "hurt";
  if (share > 0.25) return "bloodied";
  return "near death";
}

export type FightSeen = { name: string; health: string; conditions: string[]; feet: number | null };

// A first-tier mind's own model and reasoning effort (ticket 09), chosen by
// whoever runs the story from what the table's agent program offers. Blank
// fields follow the table's mind route (the utility model, else the story's).
export type MindModelChoice = { model: string; effort: string };

export function parseMindModel(raw: string): MindModelChoice | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Partial<MindModelChoice>;
    const model = typeof value.model === "string" ? value.model.trim() : "";
    const effort = typeof value.effort === "string" ? value.effort.trim() : "";
    return model || effort ? { model, effort } : null;
  } catch {
    return null;
  }
}

// What the program offers, as the choice is checked against: an unknown
// model, or an effort the model (or, with no model, the table's) lacks, is
// refused. `fallbackModel` is the table's mind model, for a choice of effort
// alone.
export function mindModelProblem(
  choice: MindModelChoice,
  offered: ReadonlyArray<{ id: string; efforts?: readonly string[] }>,
  fallbackModel: string,
): string | null {
  const model = offered.find((entry) => entry.id === (choice.model || fallbackModel));
  if (choice.model && !model) {
    return `The table's model server does not offer the model "${choice.model}".`;
  }
  if (choice.effort && !(model?.efforts ?? []).includes(choice.effort)) {
    return `The model "${choice.model || fallbackModel}" does not offer the effort "${choice.effort}".`;
  }
  return null;
}

// What the companion's hands allow (attack-rules.ts handsRuling): the
// shield on its arm, and the carried two-handed weapons it cannot use with it.
export type FightHands = { shield: string | null; blocked: string[] };

function handsLine(hands: FightHands | undefined): string {
  if (!hands?.shield) {
    return "";
  }
  return hands.blocked.length
    ? `Your ${hands.shield} is on your arm: while it is, you cannot use ${hands.blocked.join(", ")} (they need both hands). Doffing a shield takes your action.`
    : `Your ${hands.shield} is on your arm.`;
}

// The fight as the companion sees it from where it stands.
// `self`: the companion's own state, which it knows exactly; staying alive
// comes first, so it has to know how close to death it is.
export type FightSelf = { hp: number; maxHp: number; conditions: string[] };

export function renderFightView(view: { round: number; foes: FightSeen[]; allies: FightSeen[]; hands?: FightHands; self?: FightSelf }): string {
  const line = (seen: FightSeen) =>
    `- ${seen.name}: ${seen.health}${seen.conditions.length ? `, ${seen.conditions.join(", ")}` : ""}${seen.feet === null ? "" : `, ${seen.feet} ft from you`}`;
  const self = view.self;
  return [
    `It is your turn in the fight (round ${view.round}). Choose what you do with it from your sheet: movement, an action, perhaps a bonus action. Name the target and the weapon or spell.`,
    self
      ? `You: ${self.hp} of ${self.maxHp} hit points (${healthWord(self.hp, self.maxHp)})${self.conditions.length ? `, ${self.conditions.join(", ")}` : ""}. Staying alive comes first: if this fight is likely to kill you, fall back, disengage, heal, or flee rather than die for nothing.`
      : "",
    view.foes.length ? `Foes you see:\n${view.foes.map(line).join("\n")}` : "You see no foe standing.",
    view.allies.length ? `Your side:\n${view.allies.map(line).join("\n")}` : "",
    handsLine(view.hands),
  ]
    .filter(Boolean)
    .join("\n");
}
// ---- A first-tier mind's turn in the scene (design §9) ----
//
// A first-tier character is played like a player at the table: whenever it
// is in the scene it gets a turn after the players and before the outcome.
// The server cannot see who stands where, so "in the scene" is carried from
// turn to turn: a mind that acted in the previous DM turn is still on stage
// and is owed a turn in this one. The narrator answers with npc_speak (the
// mind perceives the turn from where it stands and chooses), or with
// npc_inform when the character has left the scene: news alone is no act,
// so the chain ends there until the story addresses them again. A companion
// in a fight is left to its own fight turn (ticket 08).
export type SceneMindCandidate = {
  id: string;
  name: string;
  tier: NpcTier;
  archived: boolean;
  away: boolean;
  companionInFight: boolean;
  actedLastTurn: boolean;
  // Acted in one of the last few turns and not sent off stage since
  // (npc-minds.ts npcsOnStageRecently): asked when time skips.
  onStageRecently: boolean;
  // Unconscious or dead on the NPC's sheet (npc-state-logic.ts): no turn.
  silenced?: boolean;
};

// The tools that let time pass over the scene: a rest, a wait, a journey,
// downtime. Whoever is on stage lives that stretch too.
export const TIME_SKIP_TOOLS: ReadonlySet<string> = new Set(["take_rest", "pass_time", "travel", "downtime"]);

export function mindsOwedTurn(
  candidates: readonly SceneMindCandidate[],
  touchedIds: ReadonlySet<string>,
  timeSkipped = false,
): SceneMindCandidate[] {
  return candidates.filter(
    (entry) =>
      entry.tier === "primary" &&
      !entry.archived &&
      !entry.away &&
      !entry.companionInFight &&
      !entry.silenced &&
      (entry.actedLastTurn || (timeSkipped && entry.onStageRecently)) &&
      !touchedIds.has(entry.id),
  );
}

// The note that sends the narrator back once when a turn closed without the
// owed minds' turns.
export function sceneMindsPrompt(names: readonly string[], timeSkipped = false): string {
  const who = names.join(", ");
  return [
    ...(timeSkipped
      ? [
          "[Table note] Time passed over the scene this turn, and the characters on stage lived it too: what they do in that stretch is theirs to choose, not yours.",
          "In perceives, tell each how long passes, where they are and what goes on around them; their mind chooses what they do meanwhile (talk, sleep, keep watch, try something). Narrate the stretch from what they chose.",
        ]
      : []),
    `[Table note] ${who} ${names.length === 1 ? "is" : "are"} a first-tier character in this scene and had no turn of their own in it.`,
    "Like a player at the table, each acts after the players and before the outcome.",
    "Call npc_speak for each now. In perceives, tell them only what they could see and hear of this turn from where they are: sounds, shouts, who left and who came back, what was said within earshot (words npc_hear rolled for: only if it says they heard them). Nothing from beyond their sight and hearing, and nothing of anyone's thoughts.",
    "Their mind may speak, act, ask or keep silent; then narrate what they say and carry out what they intend with the engine's tools.",
    "If one of them is no longer in the scene at all, call npc_inform for them instead with what, if anything, reached them.",
    // Played live: after the prisoner's silent turn the narrator told the
    // failed search of the shelter a second time in other words.
    "The narration so far stands: after their turns, narrate only what those turns add, and never tell an outcome already told again.",
  ].join(" ");
}

// ---- Who hears words said in the scene (D&D 5e Perception) ----
//
// Words the narrator voices, or a hero says, reach the people around only
// as far as they could hear them. Close by they are heard; out of earshot
// they are not; in between (across a room, a weak voice, rain on the roof)
// the listener's Perception decides against the difficulty the narrator
// sets: passive (10 + Wisdom modifier), or a d20 roll when they are
// listening on purpose. A miss leaves only that someone spoke.
export type HearingReach = "near" | "far" | "out_of_earshot";

export function abilityModifier(score: number | undefined): number {
  return typeof score === "number" && Number.isFinite(score) ? Math.floor((score - 10) / 2) : 0;
}

export function hears(reach: HearingReach, dc: number, wisdom: number | undefined, d20: number | null): { heard: boolean; total: number | null } {
  if (reach === "near") return { heard: true, total: null };
  if (reach === "out_of_earshot") return { heard: false, total: null };
  const total = (d20 ?? 10) + abilityModifier(wisdom);
  return { heard: total >= dc, total };
}

// The note that sends the narrator back once when words were said aloud
// with first-tier characters on stage and nobody asked who heard them.
export function hearingPrompt(names: readonly string[], quote: string): string {
  return [
    `[Table note] Words were said aloud this turn ("${quote}") with ${names.join(", ")} on stage, and nobody asked whether they heard.`,
    "Call npc_hear for what each speaker said, listing each of them as a listener with how far they were: near, far (with how hard it was to make out as dc) or out_of_earshot. The server rolls their Perception in secret.",
    "Do not write the narration again: it stands as it is. If what they heard changes anything, carry it on in the next turn.",
  ].join(" ");
}

export function heardMemory(speaker: string, words: string, place: string): string {
  return `${place ? `${place}: ` : ""}you heard ${speaker} say: «${words}»`;
}

export function mutedMemory(speaker: string, place: string): string {
  return `${place ? `${place}: ` : ""}you saw ${speaker} speaking, too low or too far for you to make out the words.`;
}

// First-tier NPCs besides the party's companions: each is a mind the table
// pays for every time they act. The table sets the ceiling
// (gameSettings.npcMindLimit); a campaign made before it keeps four.
export const MAX_FIRST_TIER_NPCS = 4;

export function firstTierLimit(campaign: { gameSettings: { npcMindLimit?: number } }): number {
  return campaign.gameSettings.npcMindLimit ?? MAX_FIRST_TIER_NPCS;
}
