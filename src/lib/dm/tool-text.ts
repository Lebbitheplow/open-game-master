// Pure helpers for spotting DM tool calls that leaked into narration as
// literal text. Four leak shapes exist: bracket style
// ("[request_roll characterId=... kind=custom]"), the model's NATIVE
// XML dialect ("<tool_call><function=enemy_attack><parameter=enemyId>..."),
// which reaches us whenever llama-server's extraction misses it, an agent
// program's call written out in the Anthropic style (invokeToolCallRegex
// below), and bare JSON arguments (findBareJsonObjects below). A card's line,
// or another line of the server's, copied back from the conversation
// (withoutServerLines below) is no call, and goes the same way. Kept
// dependency-free so client components can import it; the name list mirrors
// the tools registered in src/lib/dm/prompt.ts, src/lib/dm/mutations.ts
// (MUTATION_TOOL_NAMES), src/lib/dm/encounter-tools.ts, src/lib/dm/
// map-tools.ts, and src/lib/image-tool.ts.

export const DM_TOOL_NAME_PATTERN =
  "request_roll|group_check|check_notice|apply_hazard|set_npc|npc_reaction|social_check|roll_treasure|damage_object|travel|request_player_input|move_party|update_location|record_event|complete_beat|recall_story|search_lore|read_card|write_campaign_note|send_whisper|generate_image|apply_damage|heal|stabilize|take_rest|award_xp|party_award|modify_gold|grant_item|remove_item|handle_item|set_enemy_condition|clear_enemy_condition|set_condition|clear_condition|use_item|purchase|use_resource|use_spell_slot|learn_spell|update_sheet|start_encounter|add_enemies|add_companion|dismiss_companion|pc_attack|cast_at_enemy|cast_at_player|cast_buff|damage_enemy|enemy_attack|enemy_flees|declare_intent|aoe_damage|move_token|take_action|use_reaction|end_turn|end_encounter|summon_pet|pet_attack|damage_pet|dismiss_pet|lift|set_lifestyle|downtime|afflict";

export function toolTextRegex(): RegExp {
  return new RegExp(`\\[(${DM_TOOL_NAME_PATTERN})\\b([^\\]]*)\\]`, "g");
}

// An agent program behind the harness provider sometimes writes a call into
// its final message instead of making it (issue 794): an invoke tag with a
// name attribute holding parameter tags with theirs, perhaps in a
// function_calls wrapper, the tags perhaps namespaced. A tag only counts with
// its name attribute, so "<invoke the gods>" in a story stays. An invoke that
// never closes is output cut short, and nothing after it is story.
const NS = "(?:[\\w-]+:)?";
const INVOKE_PATTERNS = [
  `<${NS}function_calls\\b[^>]*>[\\s\\S]*?</${NS}function_calls\\s*>`,
  `<${NS}invoke\\s+name\\s*=[^>]*>[\\s\\S]*?</${NS}invoke\\s*>`,
  `<${NS}invoke(?:\\s+name\\s*(?:=[\\s\\S]*)?|\\s*)$`,
  `<${NS}parameter\\s+name\\s*=[^>]*>[\\s\\S]*?</${NS}parameter\\s*>`,
  `</?${NS}function_calls\\b[^>]*(?:>|$)`,
  `</${NS}invoke\\s*>`,
  `<${NS}parameter\\s+name\\s*=[^>]*>`,
  `</${NS}parameter\\s*>`,
];

export function invokeToolCallRegex(): RegExp {
  return new RegExp(INVOKE_PATTERNS.join("|"), "gi");
}

// XML tool-call leaks: the Anthropic-style dialect above, whole <tool_call>
// blocks, bare <function=...> blocks
// (the wrapper is sometimes dropped), then any orphaned tags left behind by
// truncation. Order matters: block patterns first so orphan matching only
// sees leftovers.
export function xmlToolCallRegex(): RegExp {
  return new RegExp(
    [
      ...INVOKE_PATTERNS,
      "<tool_call>[\\s\\S]*?</tool_call>",
      "<function=[^>]*>[\\s\\S]*?</function>",
      "<parameter=[^>]*>[\\s\\S]*?</parameter>",
      "</?tool_call>",
      "<function=[^>]*>",
      "</function>",
      "<parameter=[^>]*>",
      "</parameter>",
    ].join("|"),
    "gi",
  );
}

// Removes any leaked tool-call text; players should never see or hear it.
// Hand-written roll markers: the server appends real "[roll:<uuid>]"
// markers to finished narration so the UI can inline dice cards, and the
// model sometimes imitates the syntax ("[roll:enemy_attack_cultist]").
// Anything in roll-marker shape that is not exactly a server uuid is fake
// bookkeeping text that rolled nothing; players must never see it.
export function fakeRollMarkerRegex(): RegExp {
  return /\[roll:(?![0-9a-f-]{36}\])[^\]]*\]/gi;
}

// A reply the model just wrote, before finalize() places the real markers,
// holds none of the server's: every "[roll:...]" in it is the model's, even
// one with a real id. Qwen3.6-35B copied ids from the markers in earlier
// narration (issue #531); a copied id would show that old roll's card in
// the new passage, and the draft showed the marker raw.
export function withoutRollMarkers(text: string): string {
  return text.replace(/\[roll:[^\]]*\][ \t]*/gi, "");
}

// Another line of the server's a model copies into its reply: the one it
// reads under a player's words for a card from the Hand, or for a reaction
// in the player's own words (src/lib/dm/intent-logic.ts describeIntent).
// Qwen3.6-35B answered an off-hand attack with the card line of the attack
// before it and nothing else, and the table read "[Card played for
// characterId=...: an attack with Scimitar at ... (enemyId=...)." (issue
// 900). The line is one line. A copy that never closes its bracket goes to
// the end of its line: the model cut it short, or the turn's tidy took its
// last sentence for naming a tool (narration-tidy-logic.ts withoutToolTalk),
// which is how the table came to read the half above.
const CARD_LINE =
  /\[(?:Card played(?: for characterId=[^\s:\]]+)?:|A reaction(?: for characterId=[^\s,\]]+)?, in their player's words above:)[^\]\n]*(?:\][ \t]*|(?=\n)|$)/g;

export function withoutCardLines(text: string): string {
  return text.replace(CARD_LINE, "");
}

// The other lines the server writes into the model's conversation, which a
// model copies back the same way, each by the tag it opens with: the
// transcript's own (src/lib/dm/prompt.ts buildDmMessages: a player's "[Name |
// attempt]" line, a table note, the lead's direction, a settled offer), the
// state the turn adds ("[GAME STATE UPDATE]", pinned memories), and the
// corrections it sends ("[System] Tools are closed...", a closing "[Variety]"
// note). Each runs to the end of its line, as the server wrote it. A
// "[System]" line goes only by the openings of the server's own, so a story's
// "[System] You have gained a level" stays. The tags are the server's words,
// the same at every table, whatever language the narration is in.
const SYSTEM_OPENINGS = [
  "Direct instruction from the party lead",
  "Narrate this moment again",
  "That reply ",
  "The Game Master ran this stretch",
  "The newest table talk asks you",
  "The party lead has asked",
  "Tools are closed",
  "You have not yet privately answered",
  "Your last attempt at this turn",
  "Your narration ",
  // intent-logic.ts intentCorrection, INTENT_CORRECTION_MARK.
  "[^\\n]*?, and nothing resolved it",
];
const SERVER_TAGS = [
  "Table note\\]",
  "[^\\]\\n|]{1,80}\\|\\s*attempt\\]",
  "Authoritative direction from the party lead;",
  "An offer was settled by the player's own answer;",
  "GAME STATE UPDATE\\]",
  "PINNED MEMORIES\\]",
  "SCENE CONTINUE - the party lead pressed Continue",
  "Variety\\]",
  // An agent program's transcript (src/lib/harness/render.ts renderTurn).
  "engine\\] ",
  `System\\] (?:${SYSTEM_OPENINGS.join("|")})`,
].join("|");
const SERVER_LINE = new RegExp(`\\[(?:${SERVER_TAGS})[^\\n]*(?:\\n|$)`, "g");
// The label an agent program's transcript gives the GM's own lines: written
// above its narration, it is a label, and the narration under it stays.
const GM_LABEL = /\[Game Master\][ \t]*/g;

// What a reply holds of the server's own lines, cut: the card line and every
// tagged line above.
export function withoutServerLines(text: string): string {
  return text.replace(CARD_LINE, "").replace(SERVER_LINE, "").replace(GM_LABEL, "");
}

// The ids those lines carry ("characterId=2efa...", "(enemyId=2105..., 2)"),
// cut wherever they sit: a model that copies a line in other words, or in the
// table's language ("[Carta giocata per characterId=..."), keeps its ids, and
// no story writes one. Cut only once a call written as a bracket has been
// read (salvageTextualToolCalls), which needs them.
const ID_KEYS = ["characterId", "characterIds", "enemyId", "enemyIds", "targetEnemyId", "targetEnemyIds", "targetCharacterIds", "toCharacterId", "casterCharacterId", "healerId"];
const ID_KEY = `(?:${ID_KEYS.join("|")})`;
const ID_ARGUMENT_SOURCE = `[ \\t]*\\((?:[^()\\n]*?[\\s,])?${ID_KEY}=[^()\\n]*\\)|[ \\t]*\\b(?:for )?${ID_KEY}=[^\\s,;:)\\]]+`;

export function withoutIdArguments(text: string): string {
  return text.replace(new RegExp(ID_ARGUMENT_SOURCE, "g"), "");
}

// The same cuts as the reply streams to the table's draft
// (src/lib/story-prompt.ts createStreamingArtifactFilter), before the turn
// tidies it: what a line cut so far matches, and where a line that may yet
// be one starts, to be held until it is known. A card line waits for its
// bracket to close or its line to end, a tagged line (and any "[System]"
// line) for its end, an id for the character after it, and any other bracket
// for 80 characters or its close: the server's tags are all opened within
// them.
export const SERVER_TEXT_STREAM_SOURCE = [
  `\\[(?:Card played(?: for characterId=[^\\s:\\]]+)?:|A reaction(?: for characterId=[^\\s,\\]]+)?, in their player's words above:)[^\\]\\n]*(?:\\][ \\t]*|(?=\\n))`,
  `\\[(?:${SERVER_TAGS})[^\\n]*(?=\\n)`,
  GM_LABEL.source,
  `[ \\t]*\\((?:[^()\\n]*?[\\s,])?${ID_KEY}=[^()\\n]*\\)`,
  `[ \\t]*\\b(?:for )?${ID_KEY}=[^\\s,;:)\\]]+(?=[\\s,;:)\\]])`,
].join("|");
const PARTIAL_SERVER_TEXT = [
  /\[[^\]\n]{0,80}$/,
  /\[(?:Card played|A reaction)[^\]\n]*$/,
  new RegExp(`\\[(?:${SERVER_TAGS})[^\\n]*$`),
  // A "[System]" line is known by the words after its tag, and goes only at
  // its end when those are the server's.
  /\[(?:System|engine)\][^\n]*$/,
  new RegExp(`[ \\t]*\\((?:[^()\\n]*?[\\s,])?${ID_KEY}=[^)\\n]*$`),
  new RegExp(`[ \\t]*\\b(?:for )?${ID_KEY}=[^\\s,;:)\\]]*$`),
];

export function partialServerTextStart(text: string): number {
  const starts = PARTIAL_SERVER_TEXT.map((pattern) => text.search(pattern)).filter((start) => start >= 0);
  // A word still arriving that may be the head of an id's key: "enemyI".
  const word = /\(?\b[A-Za-z]+$/.exec(text);
  if (word && ID_KEYS.some((key) => `${key}=`.startsWith(word[0].replace(/^\(/, "")))) {
    starts.push(word.index);
  }
  return starts.length ? Math.min(...starts) : -1;
}

// A third leak shape: a call's arguments written into the reply as a bare
// JSON object, with no tool name ('{"characterIds":[...],"prompt":"..."}'),
// alone or glued to the end of the prose (gpt-oss on vLLM, PR #53), or the
// whole call as '{"name":"...","arguments":{...}}' without the <tool_call>
// wrapper. Narration never carries JSON, so every object that parses is
// found: the salvage in src/lib/dm/rolls.ts decides which of them were calls,
// and stripToolText removes them all.
export type BareJsonObject = { start: number; end: number; value: Record<string, unknown> };

export function findBareJsonObjects(text: string): BareJsonObject[] {
  const found: BareJsonObject[] = [];
  const opener = /\{\s*"/g;
  for (let match = opener.exec(text); match; match = opener.exec(text)) {
    const end = balancedObjectEnd(text, match.index);
    if (end < 0) {
      continue;
    }
    try {
      const value = JSON.parse(text.slice(match.index, end)) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        found.push({ start: match.index, end, value: value as Record<string, unknown> });
        opener.lastIndex = end;
      }
    } catch {
      // Not JSON after all; look for the next opener inside it.
    }
  }
  return found;
}

// Where the object opening at `start` closes, skipping braces inside
// strings, or -1 when it never does.
function balancedObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === "\\") {
        index += 1;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return -1;
}

// Cuts the given spans out of the text, tidying the gap each leaves.
export function cutSpans(text: string, spans: Array<{ start: number; end: number }>): string {
  if (!spans.length) {
    return text;
  }
  let out = "";
  let cursor = 0;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    out += text.slice(cursor, span.start);
    cursor = Math.max(cursor, span.end);
  }
  out += text.slice(cursor);
  return out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function stripToolText(text: string): string {
  const cleaned = withoutIdArguments(
    withoutServerLines(text).replace(toolTextRegex(), "").replace(xmlToolCallRegex(), "").replace(fakeRollMarkerRegex(), ""),
  ).replace(/[ \t]{2,}/g, " ");
  const objects = findBareJsonObjects(cleaned);
  return objects.length ? cutSpans(cleaned, objects) : cleaned;
}
