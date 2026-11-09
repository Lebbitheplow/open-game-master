// What a player's words since the DM last spoke let the AI do with their
// character's own turn in a fight (src/lib/dm/player-word.ts reads the lines
// and gates the calls). Pure: no database, no model.
//
// Counting any line as the player's word let the AI play a turn its player
// never declared. A player answered a scene with "hold still"; the AI opened
// a fight in the same reply, their character won the initiative, and the
// pre-fight "hold still" counted as their turn: pc_attack with approach
// walked them 30 feet through two opportunity attacks toward a goblin they
// never meant to fight, and the swing was then refused for reach (0.34.0
// report).
// So the words are read for three things:
//   - a hold ("hold still", "I stay put", "I don't move") keeps the
//     character where they stand: no walk of theirs is made this turn;
//   - words written before the fight began were about the scene, so they
//     declare a fight turn only when they name something the character does
//     in it (an attack, a spell, a move, a foe of the fight);
//   - a line that only asks a question declares nothing.
// A card played from the Hand is a structured action and always declares.
// English is read here; any other table language is read once by the
// utility model (src/lib/dm/player-word-read.ts) and handed in as `read`.

import { containsPhrase, textKey } from "@/lib/language/text-logic";

export type WordLine = {
  content: string;
  createdAt: string;
  // The Hand card the line was played with, if any (reactions are filtered
  // out before this: they answer someone else's turn).
  card: string | null;
};

// The utility model's reading of the words at a table in another language.
export type WordReading = { acts: boolean; holds: boolean };

export type PlayerWord = {
  // Any own line since the DM last spoke.
  spoke: boolean;
  // The words ask for something the character does on this turn.
  declares: boolean;
  // The words keep the character where they stand this turn.
  holds: boolean;
  // The words the hold was read from, for the refusal.
  holdQuote: string | null;
  // Why the words declare nothing: never spoke, only asked a question, spoke
  // only before the fight began about something else, or chose to stay put
  // and do nothing.
  why: "silent" | "asked" | "before_fight" | "held" | null;
};

const SILENT: PlayerWord = { spoke: false, declares: false, holds: false, holdQuote: null, why: "silent" };

// Keeping still, in the forms players write it. "Hold Person" and "hold the
// door" are not holds: the verb needs a word of staying after it.
const HOLD_VERB =
  /\b(?:hold(?:s|ing)?|stand(?:s|ing)?|stay(?:s|ing)?|keep(?:s|ing)?|remain(?:s|ing)?)\s+(?:very\s+|perfectly\s+|completely\s+|totally\s+|dead\s+)?(?:still|steady|put|fast|firm|motionless|in place|here|back|(?:my|our|his|her|their) ground|ground|(?:my|our|his|her|their) position|position|where (?:i|we|he|she|they) (?:am|are|is|stand))\b/gi;
const HOLD_NOT_MOVING = /\b(?:don['’]?t|do not|doesn['’]?t|does not|won['’]?t|will not|not going to)\s+(?:move|budge|step|go anywhere)\b/gi;
const HOLD_WAIT = /\b(?:i|we)\s+(?:just\s+|quietly\s+|silently\s+)?wait\b|\bwaits\b|\bfreez(?:e|es|ing)\b/gi;
// A negation right before the hold, in its own clause, undoes it: "I don't
// hold still, I charge".
const HOLD_UNDONE = /\b(?:don['’]?t|do not|doesn['’]?t|does not|won['’]?t|will not|not|never|stop|no longer|instead of)\s+(?:\w+\s+)?$/i;

// Something done in a fight. Used only where a line could otherwise be a
// remark about the scene: words from before the fight, and a hold.
const ACTS =
  /\b(?:attack|swing|strike|stab|slash|hit|smash|bash|shoot|fire|loose|throw|hurl|cast|charge|rush|lunge|close in|move|run|dash|disengage|dodge|help|hide|grapple|shove|ready|drink|draw|punch|kick|bite|smite|rage|heal|bless|walk|step|approach|advance|retreat|flee|climb|jump|leap|tackle|grab|aim|cut|slice|thrust|parry|go (?:to|for|after|toward|towards)|head (?:to|for|toward|towards)|use)(?:s|es|ed|ing)?\b/i;

function clauseBefore(text: string, at: number): string {
  const before = text.slice(0, at);
  return before.slice(Math.max(...[".", "!", "?", ";", ",", "\n"].map((mark) => before.lastIndexOf(mark))) + 1);
}

// The hold phrase in English words, or null.
export function englishHold(text: string): string | null {
  for (const pattern of [HOLD_VERB, HOLD_NOT_MOVING, HOLD_WAIT]) {
    for (const match of text.matchAll(pattern)) {
      if (!HOLD_UNDONE.test(clauseBefore(text, match.index))) {
        return match[0];
      }
    }
  }
  return null;
}

// Whether English words name something done in a fight: an action verb, or
// a name the fight knows (a foe, a spell on the sheet).
export function englishActs(text: string, names: readonly string[]): boolean {
  return ACTS.test(text) || names.some((name) => name.trim().length > 1 && containsPhrase(text, name));
}

// The English words around a quoted question that say only who asks it:
// '"Do you know this place?" I ask Corin.' Without them, the commonest way
// to write a question to someone ("..." I ask) read as an act, and a
// companion asked about the road got a Persuasion check (0.34.1 report).
// "I ask him to open the gate" and "I ask for help" ask for something done,
// and "and", "then" or "but" add a second act: none of those is a tag.
const ASK_TAG =
  /^[\p{L}'’-]+\s+(?:[\p{L}]+ly\s+)?(?:ask|asks|asked|inquire|inquires|wonder|wonders)\b(?:[\s,]+(?!(?:to|for|and|then|but)\b)[\p{L}'’-]+){0,5}[\s,.!…]*$/iu;
// An indirect question: "I ask Corin what he thinks of the road."
const ASK_INDIRECT =
  /^[\p{L}'’-]+\s+(?:[\p{L}]+ly\s+)?(?:ask|asks|asked|inquire|inquires|wonder|wonders)\b(?:\s+(?!(?:to|for)\b)[\p{L}'’-]+){0,3}?\s+(?:what|whether|if|how|why|where|who|whom|when|which|about)\b(?![^]*\b(?:and|then|but)\b)[^]*$/iu;

// A line that only asks: every sentence of it ends in a question mark, in
// any script, or at an English table only says who asks.
export function onlyAsks(text: string, english = true): boolean {
  const parts = text
    .split(/(?<=[.!?。！？؟\n])\s*/)
    .map((part) => part.trim())
    .filter((part) => /[\p{L}\p{N}]/u.test(part));
  // Each sentence is a question, a tag, or something else; a line of tags
  // alone ("I ask.") asks nothing.
  const kind = (part: string): "question" | "tag" | null => {
    if (/[?？؟]["'”’)\]]*$/.test(part)) {
      return "question";
    }
    // The quote mark a question closed with opens the tag's part.
    const bare = part.replace(/^["'”’“‘)\]\s]+/, "");
    if (!english) {
      return null;
    }
    return ASK_INDIRECT.test(bare) ? "question" : ASK_TAG.test(bare) ? "tag" : null;
  };
  const kinds = parts.map(kind);
  return kinds.includes("question") && kinds.every((entry) => entry !== null);
}

// Whether every one of the character's lines only asks: no Hand card, and
// nothing said beside the question. A roll to sway someone is the answer to
// an attempt, and a question is none (SRD 5.1, Ability Checks: the GM calls
// for one when a character tries something whose outcome is in doubt), so
// the AI answers the question in character and the player decides whether
// to press. No line at all is not this: the GM may still call for a check
// the scene forces.
export function onlyAsked(lines: readonly Pick<WordLine, "content" | "card">[], english: boolean): boolean {
  return lines.length > 0 && lines.every((line) => !line.card && onlyAsks(line.content, english));
}

// The skills social_check rolls: the checks that try to change a mind.
const SWAY_SKILLS = new Set(["persuasion", "deception", "intimidation"]);

// Whether a request_roll's skill is one that sways someone.
export function swaySkill(skill: string | undefined): boolean {
  return SWAY_SKILLS.has(textKey(skill ?? ""));
}

// The refusal of a roll to sway someone the player only asked a question of.
export function askedSwayRefusal(name: string): string {
  return `${name}'s player only asked a question, and a question sways no one, so nothing was rolled. Answer it in character, as the one asked feels about the party, and do not narrate a check. If the player then presses, argues or bargains, that attempt is the roll.`;
}

export function readPlayerWord(
  lines: readonly WordLine[],
  options: {
    // When the running fight began; lines before it were about the scene.
    fightStartedAt: string | null;
    english: boolean;
    // Foes of the fight and spells on the sheet, read as naming an action.
    names: readonly string[];
    // The utility model's reading at a table in another language; null when
    // it was not made or failed.
    read: WordReading | null;
  },
): PlayerWord {
  if (!lines.length) {
    return SILENT;
  }
  if (lines.some((line) => line.card)) {
    const text = lines.filter((line) => !line.card).map((line) => line.content).join("\n");
    const holdQuote = options.english ? englishHold(text) : options.read?.holds ? text.trim().slice(0, 80) : null;
    return { spoke: true, declares: true, holds: holdQuote !== null, holdQuote, why: null };
  }
  const started = options.fightStartedAt;
  // A line written in the same instant the fight began counts as in it.
  const before = started ? lines.filter((line) => line.createdAt < started) : [];
  const during = started ? lines.filter((line) => line.createdAt >= started) : [...lines];
  const all = lines.map((line) => line.content).join("\n");
  const asking = (line: WordLine) => onlyAsks(line.content, options.english);

  if (options.english) {
    const acts = englishActs(all, options.names);
    const holdQuote = englishHold(all);
    const holds = holdQuote !== null;
    // A question counts only when it asks for the action by its verb ("Can
    // I attack it?"): naming the goblin in "Is the goblin still there?" asks
    // nothing of the turn.
    const saidDuring = during.some((line) => !asking(line) || englishActs(line.content, []));
    const saidBefore = before.length > 0 && englishActs(before.map((line) => line.content).join("\n"), options.names);
    if (holds && !acts) {
      return { spoke: true, declares: false, holds, holdQuote, why: during.length ? "held" : "before_fight" };
    }
    if (saidDuring || saidBefore) {
      return { spoke: true, declares: true, holds, holdQuote, why: null };
    }
    return { spoke: true, declares: false, holds, holdQuote, why: during.length ? "asked" : "before_fight" };
  }

  // Another language: the reading decides; without one, a line written in
  // the fight still counts as it always did, and words from before it wait
  // for the player (asking again costs a line, acting for them costs their
  // turn).
  const read = options.read;
  const holdQuote = read?.holds ? all.trim().slice(0, 80) : null;
  const holds = holdQuote !== null;
  if (read) {
    if (holds && !read.acts) {
      return { spoke: true, declares: false, holds, holdQuote, why: during.length ? "held" : "before_fight" };
    }
    if (read.acts) {
      return { spoke: true, declares: true, holds, holdQuote, why: null };
    }
    return { spoke: true, declares: false, holds, holdQuote, why: during.length ? "asked" : "before_fight" };
  }
  if (during.some((line) => !asking(line))) {
    return { spoke: true, declares: true, holds: false, holdQuote: null, why: null };
  }
  return { spoke: true, declares: false, holds: false, holdQuote: null, why: during.length ? "asked" : "before_fight" };
}

// The refusal of a turn-spending call the words did not ask for.
export function unaskedRefusal(name: string, word: Pick<PlayerWord, "why">): string {
  const tail = `Nothing was spent. Don't narrate an attempt; wait for them to say what ${name} does, or narrate the moment and stop.`;
  switch (word.why) {
    case "asked":
      return `${name} has not acted: their player only asked a question this turn. Answer it, then wait for them to say what ${name} does. ${tail}`;
    case "before_fight":
      return `${name} has not acted: their player spoke before this fight began and named nothing ${name} does in it. ${tail}`;
    case "held":
      return `${name} has not acted: their player said ${name} stays where they are and named nothing else. Nothing was spent. If that is all ${name} does, end_turn ends the turn; otherwise wait for them to say what ${name} does.`;
    default:
      return `${name} has not acted: their player hasn't declared an action this turn. ${tail}`;
  }
}

// The refusal of a walk the words held still.
export function heldRefusal(name: string, quote: string | null, tail = " Nothing was spent."): string {
  return `${name}'s player said ${name} stays where they are${quote ? ` ("${quote}")` : ""}, so the server will not walk them.${tail} Resolve only what they asked from where they stand, or ask them.`;
}
