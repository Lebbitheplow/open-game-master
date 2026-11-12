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
import { containsPhrase, phraseOffsets, textKey } from "@/lib/language/text-logic";

export type WordLine = {
  content: string;
  createdAt: string;
  // The Hand card the line was played with, if any (reactions are filtered
  // out before this: they answer someone else's turn).
  card: string | null;
};

// The utility model's reading of the words at a table in another language.
// `declines`: they turn an action down, and `ends`: they end the turn, read
// as englishDeclines and englishEndsTurn read English (absent from a reply
// that left them out: then neither is said).
export type WordReading = { acts: boolean; holds: boolean; declines?: boolean; ends?: boolean };

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
// stand between ("I won't make another attack"), but not a new subject or a
// word that starts another thought: "I never miss when I attack" and "I
// can't let them hit Corin" turn nothing down.
const DECLINED = new RegExp(
  `\\b(?:(?:don['’]?t|do not|doesn['’]?t|does not|didn['’]?t|won['’]?t|will not|can['’]?t|cannot|not|never|no longer)\\s+(?:(?!(?:i|you|he|she|it|we|they|when|whenever|if|unless|until|because|let|lets|that)\\b)\\w+\\s+){0,3}?|no\\s+(?:more\\s+|further\\s+|other\\s+)?)(?:${ACT_VERBS})(?:s|es|ed|ing)?\\b`,
  "i",
);

// Someone else's act, in a question: "Don't you attack?" and "Will they
// flee?" ask nothing of the character's turn, where "Can I attack it?" does.
const OTHERS_ACT = new RegExp(`\\b(?:you|he|she|they)\\s+(?:\\w+\\s+){0,2}?(?:${ACT_VERBS})(?:s|es|ed|ing)?\\b`, "gi");

// A name said with an article or a possessive is a thing spoken of, not an
// act asked for: "I keep my shield up" with Shield on the sheet, "the goblin
// has had enough" beside a turned-down attack.
const SPOKEN_OF = /\b(?:the|a|an|this|that|my|your|his|her|its|our|their)\s+$/;

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

// Whether English words that also turn an action down ask for another one:
// a fight verb, or a name said as the thing to do ("Fire Bolt on the
// archer"), not one only spoken of beside it.
function actsBesideDeclined(text: string, names: readonly string[]): boolean {
  const { rest } = withoutDeclined(text);
  const key = textKey(rest);
  return (
    ACTS.test(rest.replace(STANCE, " ")) ||
    names.some((name) => name.trim().length > 1 && phraseOffsets(rest, name).some((at) => !SPOKEN_OF.test(key.slice(0, at))))
  );
}

// Whether an English question asks for something the character does ("Can
// I attack it?"), not about what someone else does.
function asksToAct(text: string): boolean {
  return englishActs(text.replace(OTHERS_ACT, " "), []);
}

// Whether English words turn an action down ("I won't attack again").
export function englishDeclines(text: string): boolean {
  return withoutDeclined(text).declined;
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

// One word of whom or what is listened to: never a joining word, which
// starts a second act ("I listen to her, and then bribe him"), nor "me" or
// "us" ("You listen to me" is an order, and one meant to sway).
const HEARD_WORD = String.raw`(?!(?:and|then|but|or|me|us)\b)\p{L}[\p{L}'-]*`;
// The ways a table writes listening: "I listen to her story", "I hear him
// out", "I let her finish", "I keep quiet", "I motion for him to go on".
// The first reader knew only "listen" with "to him", "to her" or "to
// them", and "I listen to the captain" or "I hear him out" still rolled
// Persuasion toward the one talking (issue #896).
const HEARING_VERB = String.raw`(?:(?:listen|listens|listened)(?:\s+(?:closely|carefully|quietly|intently|along))?(?:\s+to\s+(?:what\s+(?:he|she|they|you|it)\s+(?:has|have|had)\s+to\s+say|(?:the|his|her|their|this|that|my|our)\s+${HEARD_WORD}(?:\s+${HEARD_WORD})?|${HEARD_WORD}))?(?:\s+(?:closely|carefully|quietly|intently))?|(?:hear|hears|heard)\s+${HEARD_WORD}\s+out|(?:let|lets)\s+${HEARD_WORD}\s+(?:talk|speak|finish|continue|explain|go\s+on)|(?:keep|keeps|kept|stay|stays|stayed|remain|remains|remained|fall|falls|fell)\s+(?:quiet|silent)|(?:say|says|said)\s+nothing|(?:nod|nods|nodded)\s+along|(?:wait|waits|waited)\s+for\s+${HEARD_WORD}\s+to\s+(?:finish|continue|go\s+on|speak|talk)|(?:gesture|gestures|gestured|motion|motions|motioned|wave|waves|waved|nod|nods|nodded)\s+for\s+${HEARD_WORD}\s+to\s+(?:continue|go\s+on|keep\s+talking|speak|talk|explain))`;
// The English words a character settles in to hear someone out with, or
// says they speak with: "I sit and say", "Kara leans back and listens", "I
// tell Borin", "I lean in to listen". Said alone they ask nothing and try
// nothing.
const SETTLE_VERB = String.raw`(?:(?:\p{L}+ly|just|simply|only)\s+)?(?:${HEARING_VERB}|(?:(?:sit|sits|sat)(?:\s+(?:down|back))?|(?:lean|leans|leaned)\s+(?:back|in|forward)|(?:settle|settles|settled)(?:\s+(?:in|back))?)(?:\s+\p{L}+ly)?(?:\s+to\s+(?:listen|hear\s+${HEARD_WORD}\s+out))?|(?:nod|nods|nodded)|(?:smile|smiles|smiled)|say|says|said|reply|replies|replied|answer|answers|answered|(?:tell|tells|told)\s+[\p{L}'-]+)`;
// The one settling in is the speaker or their character, never "you":
// "You sit down and listen" tells someone else what to do.
const SETTLE = String.raw`(?!you\b)[\p{L}'-]+\s+${SETTLE_VERB}(?:\s*,?\s+(?:and\s+then|and|then)\s+${SETTLE_VERB})*`;
const HEARING = new RegExp(`\\b${HEARING_VERB}`, "iu");
// A word that only answers before the rest ("Alright, go on", "Sure, I'm
// listening"), or a whole sentence of one ("Okay. Go on.").
const INTERJECTION = String.raw`(?:okay|ok|alright|all\s+right|sure|fine|very\s+well|well|yes|aye|right|hmm+|mm+)`;
const LEADING_INTERJECTION = new RegExp(`^${INTERJECTION}\\s*,?\\s+(?=\\S)`, "iu");
const ONLY_INTERJECTION = new RegExp(`^${INTERJECTION}[\\s,.!…]*$`, "iu");
// Words that only invite the other to go on talking: "I'm all ears", "Go
// on", "Tell me more", with a name or "please" beside them. "Go on, give me
// the key" and "I'm all ears, but you pay first" say more, and are not this.
const HEAR_OUT = String.raw`(?:(?:i'm|im|i\s+am|we're|we\s+are)\s+(?:all\s+ears|listening)|(?:please\s*,?\s*)?(?:go\s+on|go\s+ahead|carry\s+on|continue|keep\s+talking|tell\s+me\s+more|let's\s+hear\s+it)(?:\s*,?\s*please)?)`;
const SETTLES = new RegExp(`^${SETTLE}[\\s,.!…]*$`, "iu");
const HEARS = new RegExp(`^(?:${SETTLE}\\s*[,:]?\\s+)?${HEAR_OUT}(?<called>(?:\\s*,\\s*[\\p{L}'-]+){0,2})(?:\\s*,?\\s+${SETTLE})?[\\s,.!…]*$`, "iu");
// A word set off by a comma beside the invitation is the one spoken to
// ("Go on, Borin") or a softener ("Go on, then"); a lower-case word is a
// second order ("Go on, confess"), which is more than listening.
const CALLED = /^(?:\p{Lu}[\p{L}'-]*|then|please|friend)$/u;

type SentenceKind = "question" | "tag" | "listen" | "settle" | null;

// What each sentence of a line is. Every script reads a question mark; an
// English table also reads who asks, an indirect question, and, when
// `hearing`, words that only listen and the settling in around them.
function sentenceKinds(text: string, english: boolean, hearing: boolean): SentenceKind[] {
  const parts = text
    .split(/(?<=[.!?。！？؟\n])\s*/)
    .map((part) => part.trim())
    .filter((part) => /[\p{L}\p{N}]/u.test(part));
  return parts.map((part): SentenceKind => {
    if (/[?？؟]["'”’)\]]*$/.test(part)) {
      return "question";
    }
    // The quote mark a question closed with opens the tag's part.
    const bare = part.replace(/^["'”’“‘)\]\s]+/, "");
    if (!english) {
      return null;
    }
    if (ASK_INDIRECT.test(bare)) {
      return "question";
    }
    if (ASK_TAG.test(bare)) {
      return "tag";
    }
    if (!hearing) {
      return null;
    }
    // Speech marks, double or single, are only where the words were said:
    // 'I sit and say, "I'm all ears."' reads as I sit and say, I'm all ears.
    const quoted = part
      .replace(/[’‘]/g, "'")
      .replace(/["“”]/g, " ")
      .replace(/(^|\s)'|'(?=[\s,.!…]|$)/g, "$1 ")
      .replace(/\s+/g, " ")
      .trim();
    if (ONLY_INTERJECTION.test(quoted)) {
      return "settle";
    }
    const plain = quoted.replace(LEADING_INTERJECTION, "");
    const heard = HEARS.exec(plain);
    if (heard) {
      const called = (heard.groups?.called ?? "").split(",").map((word) => word.trim()).filter(Boolean);
      return called.every((word) => CALLED.test(word)) ? "listen" : null;
    }
    if (SETTLES.test(plain)) {
      return HEARING.test(plain) ? "listen" : "settle";
    }
    return null;
  });
}

// A line that only asks: every sentence of it ends in a question mark, in
// any script, or at an English table only says who asks. A line of tags
// alone ("I ask.") asks nothing.
export function onlyAsks(text: string, english = true): boolean {
  const kinds = sentenceKinds(text, english, false);
  return kinds.includes("question") && kinds.every((entry) => entry !== null);
}

// A line that only asks or only hears someone out: every sentence asks, says
// who asks, invites the other to go on ("I'm all ears", "Go on"), or settles
// in to listen ("I sit back"), and one of them asks or listens. Issue #896:
// 'I sit and say, "I'm all ears."' got a Persuasion check toward the one
// speaking. The fight-turn reader keeps onlyAsks: a listener in a fight has
// still not said what their turn is.
export function onlyAsksOrListens(text: string, english = true): boolean {
  const kinds = sentenceKinds(text, english, true);
  return kinds.some((entry) => entry === "question" || entry === "listen") && kinds.every((entry) => entry !== null);
}

// Whether every one of the character's lines only asks or listens: no Hand
// card, and nothing said beside it. A roll to sway someone is the answer to
// an attempt, and a question or an ear is none (SRD 5.1, Ability Checks:
// the GM calls for one when a character tries something whose outcome is in
// doubt), so the AI answers in character and the player decides whether to
// press. No line at all is not this: the GM may still call for a check the
// scene forces.
export function onlyAsked(lines: readonly Pick<WordLine, "content" | "card">[], english: boolean): boolean {
  return lines.length > 0 && lines.every((line) => !line.card && onlyAsksOrListens(line.content, english));
}

// The skills social_check rolls: the checks that try to change a mind.
const SWAY_SKILLS = new Set(["persuasion", "deception", "intimidation"]);

// Whether a request_roll's skill is one that sways someone.
export function swaySkill(skill: string | undefined): boolean {
  return SWAY_SKILLS.has(textKey(skill ?? ""));
}

// The refusal of a roll to sway someone the player only asked a question of
// or listened to.
export function askedSwayRefusal(name: string): string {
  return `${name}'s player only asked a question or listened, and that sways no one, so nothing was rolled. Answer in character, as the one spoken to feels about the party, and do not narrate a check. If the player then presses, argues or bargains, that attempt is the roll.`;
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
    const saidDuring = during.some((line) => !asking(line) || asksToAct(line.content));
    const saidBefore = before.length > 0 && englishActs(before.map((line) => line.content).join("\n"), options.names);
    if (holds && !acts) {
      return { spoke: true, declares: false, holds, holdQuote, why: during.length ? "held" : "before_fight" };
    }
    // Words in the fight that only turn an action down leave the rest of the
    // turn to the player: the move and the bonus action may still follow, so
    // the turn ends only when they say so (issue 761). A question with a "not"
    // in it only asks, and is read as one below.
    const told = during.filter((line) => !asking(line)).map((line) => line.content).join("\n");
    if (englishDeclines(told) && !actsBesideDeclined(all, options.names) && !englishEndsTurn(told)) {
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
    // An end said in the fight is the player's word, as in English.
    if (read.acts || (read.ends && during.length)) {
      return { spoke: true, declares: true, holds, holdQuote, why: null };
    }
    const why = !during.length ? "before_fight" : read.declines ? "declined" : "asked";
    return { spoke: true, declares: false, holds, holdQuote, why };
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
