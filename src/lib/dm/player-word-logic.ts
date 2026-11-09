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
//   - a line that only asks a question declares nothing;
//   - a line that only says what the character will not do ("I won't attack
//     again", "No more attacks from me") declares nothing either, unless it
//     also ends the turn in words ("...that's my turn").
// A card played from the Hand is a structured action and always declares.
// English is read here; any other table language is read once by the
// utility model (src/lib/dm/player-word-read.ts) and handed in as `read`.

import { englishEndsTurn } from "@/lib/dm/claims-logic";
import { containsPhrase } from "@/lib/language/text-logic";

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
  // only before the fight began about something else, chose to stay put
  // and do nothing, or only said what the character will not do.
  why: "silent" | "asked" | "before_fight" | "held" | "declined" | null;
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
const ACT_VERBS =
  "attack|swing|strike|stab|slash|hit|smash|bash|shoot|fire|loose|throw|hurl|cast|charge|rush|lunge|close in|move|run|dash|disengage|dodge|help|hide|grapple|shove|ready|drink|draw|punch|kick|bite|smite|rage|heal|bless|walk|step|approach|advance|retreat|flee|climb|jump|leap|tackle|grab|aim|cut|slice|thrust|parry|go (?:to|for|after|toward|towards)|head (?:to|for|toward|towards)|use";
const ACTS = new RegExp(`\\b(?:${ACT_VERBS})(?:s|es|ed|ing)?\\b`, "i");

// An action named only to turn it down: "I won't attack again", "Don't
// attack again this turn", "Bryn doesn't attack", "not casting anything
// else", "No more attacks from me". Read as acting, "won't attack" let the
// model's end_turn through with the move and the bonus action unspent: 8 of
// 16 such turns ended at the 0.34.1 play-test (issue 761). A few words may
// stand between ("I won't make another attack").
const DECLINED = new RegExp(
  `\\b(?:(?:don['’]?t|do not|doesn['’]?t|does not|didn['’]?t|won['’]?t|will not|can['’]?t|cannot|not|never|no longer)\\s+(?:\\w+\\s+){0,3}?|no\\s+(?:more\\s+|further\\s+|other\\s+)?)(?:${ACT_VERBS})(?:s|es|ed|ing)?\\b`,
  "i",
);

// "Ready" said of hands or a weapon kept ready is a stance, not the Ready
// action: "I keep my hands ready but don't attack again" acted on "ready".
const STANCE = /\b(?:(?:keep|stay|remain|get)(?:s|ing)?|kept|be|am|is|are|i['’]m|we['’]re|they['’]re|he['’]s|she['’]s)\s+(?:\w+\s+){0,2}?ready\b/gi;

// Where one clause of a line ends and the next begins.
const CLAUSE_BREAK = /([.!?;,\n]|\b(?:and|but|then|so|instead|while)\b)/i;

// The words with every clause that turns an action down taken out, and
// whether there was one. The rest of a declining clause goes with it: the
// goblin in "I won't attack the goblin again" is the foe declined.
function withoutDeclined(text: string): { rest: string; declined: boolean } {
  let declined = false;
  const rest = text
    .split(CLAUSE_BREAK)
    .map((piece, at) => {
      if (at % 2 === 0 && DECLINED.test(piece)) {
        declined = true;
        return ".";
      }
      return piece;
    })
    .join("");
  return { rest, declined };
}

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
// a name the fight knows (a foe, a spell on the sheet), outside a clause that
// turns it down.
export function englishActs(text: string, names: readonly string[]): boolean {
  const { rest } = withoutDeclined(text);
  return ACTS.test(rest.replace(STANCE, " ")) || names.some((name) => name.trim().length > 1 && containsPhrase(rest, name));
}

// Whether English words turn an action down ("I won't attack again").
export function englishDeclines(text: string): boolean {
  return withoutDeclined(text).declined;
}

// A line that only asks: every sentence of it ends in a question mark, in
// any script.
export function onlyAsks(text: string): boolean {
  const parts = text
    .split(/(?<=[.!?。！？؟\n])\s*/)
    .map((part) => part.trim())
    .filter((part) => /[\p{L}\p{N}]/u.test(part));
  return parts.length > 0 && parts.every((part) => /[?？؟]["'”’)\]]*$/.test(part));
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
  const asking = (line: WordLine) => onlyAsks(line.content);

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
    // Words in the fight that only turn an action down leave the rest of the
    // turn to the player: the move and the bonus action may still follow, so
    // the turn ends only when they say so (issue 761).
    const duringText = during.map((line) => line.content).join("\n");
    if (!acts && englishDeclines(duringText) && !englishEndsTurn(duringText)) {
      return { spoke: true, declares: false, holds, holdQuote, why: "declined" };
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
    case "declined":
      return `${name}'s player only said what ${name} will not do; they did not end the turn. Nothing was spent and the turn stays open. Ask them whether ${name} moves, uses a bonus action, or ends the turn, and wait for their answer.`;
    default:
      return `${name} has not acted: their player hasn't declared an action this turn. ${tail}`;
  }
}

// The refusal of a walk the words held still.
export function heldRefusal(name: string, quote: string | null, tail = " Nothing was spent."): string {
  return `${name}'s player said ${name} stays where they are${quote ? ` ("${quote}")` : ""}, so the server will not walk them.${tail} Resolve only what they asked from where they stand, or ask them.`;
}
