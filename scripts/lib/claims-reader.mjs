// The claims reader's calls (src/lib/dm/claims.ts) answered apart from a
// suite's scripted replies, so a fake model that counts a turn's calls never
// counts these, and a scripted reply is never spent on one.
export const READER_PROMPT_START = "You read one passage of a tabletop RPG game master's narration";

export function isReaderRequest(body) {
  return String(body.messages?.[0]?.content ?? "").startsWith(READER_PROMPT_START);
}

// One non-streamed reply carrying `claims` (none by default).
export function answerReader(res, claims = []) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ claims }) } }],
    }),
  );
}

// The voice-knowledge reader (src/lib/dm/voice-knowledge-logic.ts
// knowledgeReading): one read per narration with quoted lines the narrator
// wrote, when the table keeps the outcome check and the NPC minds on.
export const KNOWLEDGE_PROMPT_START = "You check what characters voiced by a game master could know";

export function isKnowledgeRequest(body) {
  return String(body.messages?.[0]?.content ?? "").startsWith(KNOWLEDGE_PROMPT_START);
}

// One non-streamed reply carrying `leaks` (none by default).
export function answerKnowledge(res, leaks = []) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ leaks }) } }] }));
}
