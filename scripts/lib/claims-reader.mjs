// The claims reader's calls (src/lib/dm/claims.ts) answered apart from a
// suite's scripted replies, so a fake model that counts a turn's calls never
// counts these, and a scripted reply is never spent on one.
export const READER_PROMPT_START = "You read one passage of a tabletop RPG game master's narration";

export function isReaderRequest(body) {
  return String(body.messages?.[0]?.content ?? "").startsWith(READER_PROMPT_START);
}

// The read of an exchange for things and money changing hands
// (src/lib/dm/item-claims.ts readItemMoves): it rides the claims reader's
// system prompt, so it is a reader request too, and its message says which.
// A fake model that scripts the claims reader's answers tells the two apart
// with this, so neither read spends the other's.
export function isItemRead(body) {
  return isReaderRequest(body) && String(body.messages?.[1]?.content ?? "").startsWith("Ask: item\n");
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
