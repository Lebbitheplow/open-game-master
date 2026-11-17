// Trial of the items reader on recorded turns (docs/specs/ogm-domain-owners.md
// slice 3): for each turn, the sheets as they stood when it began, the hero's
// words, the stage's outcomes and the final narration go to the real reader
// model; every move it names is checked against those sheets the way the
// items owner would (holder present, thing held). Nothing is written: it runs
// on a copy of the database.
//
//   SQLITE_DB_PATH=/tmp/copy.sqlite OGM_EGO_MODEL=... node scripts/trial-items-reader.mjs <campaignId> <firstTurnId> [count]
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const [campaignId, firstTurn, countArg] = process.argv.slice(2);
const { getDatabase, parseJson } = await import("../src/lib/db/core.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { requestDmMessage } = await import("../src/lib/dm/model.ts");
const { egoChoice } = await import("../src/lib/dm/npc-mind.ts");
const { thingNamed } = await import("../src/lib/dm/npc-stage-logic.ts");
const logic = await import("../src/lib/dm/items-reader-logic.ts");
const { stripReasoningArtifacts } = await import("../src/lib/story-prompt.ts");
const { withoutLeadingStopWords } = await import("../src/lib/language/language.ts");
const { textKey } = await import("../src/lib/language/text-logic.ts");

const db = getDatabase();
const campaign = getCampaignById(campaignId);
const keyOf = (word) => withoutLeadingStopWords(textKey(word), campaign.gameSettings.tableLanguage);
const turns = db.prepare(`SELECT id, created_at, conversation_json FROM dm_turns WHERE campaign_id = ? AND created_at >= (SELECT created_at FROM dm_turns WHERE id LIKE ?) ORDER BY created_at LIMIT ?`).all(campaignId, `${firstTurn}%`, Number(countArg ?? 10));
const sheets = db.prepare(`SELECT id, name, equipment_json, sheet_kind FROM character_sheets WHERE campaign_id = ?`).all(campaignId);
const castName = new Map(db.prepare(`SELECT name, cast_sheet_id FROM npcs WHERE campaign_id = ? AND cast_sheet_id IS NOT NULL`).all(campaignId).map((row) => [row.cast_sheet_id, row.name]));
const lineOf = (item) => `${item.name}${(item.qty ?? 1) > 1 ? ` x${item.qty}` : ""}`;

// A sheet as it stood when turn k began: the first image a later turn kept of it.
function startOf(sheet, k) {
  for (const turn of turns.slice(k)) {
    const row = db.prepare(`SELECT before_json FROM turn_rows WHERE turn_id = ? AND tbl = 'character_sheets' AND row_id = ?`).get(turn.id, sheet.id);
    if (row?.before_json) {
      return parseJson(JSON.parse(row.before_json).equipment_json ?? "[]", []);
    }
  }
  return parseJson(sheet.equipment_json, []);
}

let lastDmSeq = db.prepare(`SELECT MAX(seq) AS seq FROM campaign_messages WHERE campaign_id = ? AND author_type = 'dm' AND created_at < ?`).get(campaignId, turns[0].created_at).seq ?? 0;
for (const [k, turn] of turns.entries()) {
  const dm = db.prepare(`SELECT seq, content, speaker_json FROM campaign_messages WHERE campaign_id = ? AND dm_turn_id = ? AND author_type = 'dm' ORDER BY seq`).all(campaignId, turn.id);
  const firstDm = dm[0]?.seq ?? Infinity;
  const heroLines = db
    .prepare(`SELECT m.content, s.name FROM campaign_messages m LEFT JOIN character_sheets s ON s.id = m.character_id WHERE m.campaign_id = ? AND m.author_type = 'player' AND m.seq > ? AND m.seq < ? ORDER BY m.seq`)
    .all(campaignId, lastDmSeq, firstDm)
    .map((row) => ({ name: row.name ?? "?", text: row.content.trim() }));
  lastDmSeq = dm.at(-1)?.seq ?? lastDmSeq;
  const narration = dm.map((row) => {
    const speaker = parseJson(row.speaker_json ?? "null", null);
    return speaker?.name ? `${speaker.name}: ${row.content}` : row.content;
  }).join("\n\n");
  const conversation = parseJson(turn.conversation_json ?? "[]", []);
  const stage = conversation
    .filter((message) => message.role === "user" && String(message.content ?? "").startsWith("[Table note] After the players, every character on stage"))
    .map((message) => String(message.content).split("\n").filter((line) => /^\d+\. /.test(line)).join("\n"))
    .join("\n");
  const held = new Map(sheets.map((sheet) => [sheet.sheet_kind === "cast" ? castName.get(sheet.id) ?? sheet.name : sheet.name, startOf(sheet, k)]));
  const people = sheets.map((sheet) => {
    const name = sheet.sheet_kind === "cast" ? castName.get(sheet.id) ?? sheet.name : sheet.name;
    return { name, hero: sheet.sheet_kind !== "cast", carries: held.get(name).map(lineOf) };
  });
  const made = db
    .prepare(`SELECT a.kind, a.delta_json, s.name FROM sheet_audit a JOIN character_sheets s ON s.id = a.character_id WHERE a.turn_id = ? AND a.kind IN ('grant_item', 'use_item')`)
    .all(turn.id)
    .map((row) => `${castName.get(row.name) ?? row.name}: ${row.kind.replace(/_item$/, "")} ${(parseJson(row.delta_json, {}).name ?? parseJson(row.delta_json, {}).item) || ""}`);
  // What the master made this turn was on the sheet before the reader ran.
  for (const row of db.prepare(`SELECT a.delta_json, s.name, s.id FROM sheet_audit a JOIN character_sheets s ON s.id = a.character_id WHERE a.turn_id = ? AND a.kind = 'grant_item'`).all(turn.id)) {
    const name = castName.get(row.id) ?? row.name;
    const delta = parseJson(row.delta_json, {});
    const thing = delta.name ?? delta.item;
    if (thing && held.has(name)) {
      held.get(name).push({ name: thing, qty: delta.qty ?? 1 });
      people.find((person) => person.name === name)?.carries.push(thing);
    }
  }
  const prompt = logic.renderItemsReaderPrompt({ people, ground: [], heroLines, narration, stage, recorded: made });
  const started = Date.now();
  const result = await requestDmMessage(campaign.settings, [{ role: "system", content: logic.ITEMS_READER_SYSTEM }, { role: "user", content: prompt }], { meta: { task: "items_reader" }, timeoutMs: 180_000, mindChoice: egoChoice() });
  const parsed = logic.parseItemMoves(stripReasoningArtifacts(String(result.message?.content ?? "")));
  console.log(`\n=== turn ${k + 1} (${turn.id.slice(0, 8)}) ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`hero: ${heroLines.map((line) => `${line.name}: ${line.text}`).join(" | ").slice(0, 400)}`);
  if (made.length) console.log(`made by the master's rules: ${made.join("; ")}`);
  if (!parsed.ok) {
    console.log(`UNREADABLE: ${result.error ?? parsed.error}`);
    continue;
  }
  for (const move of parsed.moves) {
    const plan = logic.planItemMove(move, people, keyOf);
    const holder = plan.kind === "pickup" ? null : plan.kind === "refused" ? null : plan.from;
    const ok = plan.kind === "refused" ? `REFUSED (${plan.why})` : holder && !thingNamed((held.get(holder) ?? []).map((item) => item.name), plan.thing, keyOf) ? `REFUSED (${holder} has no ${plan.thing})` : "ok";
    console.log(`  ${move.thing}: ${move.from || "∅"} → ${move.to || "gone"}  [${ok}]`);
  }
  if (!parsed.moves.length) console.log("  (no moves)");
}
