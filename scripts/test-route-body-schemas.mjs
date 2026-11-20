// The shared route body schemas (src/lib/schemas, issue #570) take exactly
// what the pages send today and refuse the wrong kinds of value. Each
// accepted body below is copied from its caller, so a schema that grows
// stricter than a real page fails here before a player meets the 400.

import assert from "node:assert/strict";
import { factionBodySchema } from "../src/lib/schemas/faction.ts";
import { loreEntryBodySchema } from "../src/lib/schemas/lore-entry.ts";
import { questBodySchema } from "../src/lib/schemas/quest.ts";
import { reportBundleBodySchema } from "../src/lib/schemas/report-bundle.ts";
import { storyboardBeatBodySchema } from "../src/lib/schemas/storyboard-beat.ts";

function accepts(schema, body, label) {
  const parsed = schema.safeParse(body);
  assert.ok(parsed.success, `${label} should be accepted: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`);
  return parsed.data;
}

function refuses(schema, body, label) {
  assert.equal(schema.safeParse(body).success, false, `${label} should be refused`);
}

// LorePanel.tsx submitDraft, duplicate and togglePin; WorldSetupFields.tsx.
const loreDraft = {
  category: "history",
  title: "The Drowned Bell",
  body: "It rings under the lake at the new moon.",
  tags: ["bell", "lake"],
  visibility: "party",
  imagePath: "",
  audience: null,
  attachmentPath: "",
  style: "plain",
};
assert.deepEqual(accepts(loreEntryBodySchema, loreDraft, "a lore draft"), loreDraft);
accepts(loreEntryBodySchema, { ...loreDraft, audience: ["user-1"] }, "a lore entry for one reader");
accepts(loreEntryBodySchema, { category: "people", title: "Ama", body: "A ferrywoman." }, "the creator's world step");
accepts(loreEntryBodySchema, { pinned: true }, "a pin");
accepts(loreEntryBodySchema, {}, "an empty edit");
refuses(loreEntryBodySchema, { tags: "bell, lake" }, "tags as one string");
refuses(loreEntryBodySchema, { pinned: "yes" }, "a pin as a word");
refuses(loreEntryBodySchema, null, "no object at all");

// DmStoryboardPanel.tsx: { kind, title } to add, the whole card to save.
accepts(storyboardBeatBodySchema, { kind: "scene", title: "The ferry" }, "a new card");
const card = {
  kind: "scene",
  title: "The ferry",
  body: "Ama will not cross after dark.",
  links: { npcId: "npc-1", locationId: "loc-2" },
  edges: ["beat-2"],
  routes: { "beat-2": { kind: "if", label: "they pay" } },
  x: 120,
  y: 340,
};
const saved = accepts(storyboardBeatBodySchema, { id: "beat-1", out: ["beat-2"], in: [], ...card }, "a whole card");
assert.deepEqual(saved, card, "the card's own fields survive the parse; the board's extras do not");
refuses(storyboardBeatBodySchema, { title: "x", x: "120" }, "a position as text");
refuses(storyboardBeatBodySchema, { title: "x", edges: "beat-2" }, "edges as one string");

// FactionsPanel.tsx: the draft with its tags split, or { standing }.
accepts(
  factionBodySchema,
  { name: "The Reed Court", blurb: "", goal: "", attitude: "neutral", power: 1, tags: ["river"], portraitPath: "" },
  "a faction draft",
);
accepts(factionBodySchema, { standing: -2 }, "a standing");
refuses(factionBodySchema, { name: "x", power: "3" }, "power as text");
refuses(factionBodySchema, { name: "x", tags: "river" }, "tags as one string");

// QuestsPanel.tsx: lines on a new quest, the stored rows on an edit.
accepts(questBodySchema, { title: "Find the bell", objectives: ["Ask Ama", "Dive"] }, "a new quest");
accepts(questBodySchema, { objectives: [{ id: "o1", text: "Ask Ama", done: true }] }, "a ticked objective");
accepts(questBodySchema, { status: "done" }, "a status");
accepts(questBodySchema, { visibility: "dm" }, "GM only");
refuses(questBodySchema, { visibility: "everyone" }, "an unknown visibility");
refuses(questBodySchema, { objectives: "Ask Ama" }, "objectives as one string");

// ReportProblemDialog.tsx: one yes or no per server part.
accepts(reportBundleBodySchema, { parts: { setup: true, serverLog: false } }, "the parts asked for");
accepts(reportBundleBodySchema, {}, "the default parts");
refuses(reportBundleBodySchema, { parts: { serverLog: "yes" } }, "a part as a word");

console.log("route-body-schemas: every caller's body is accepted, the wrong kinds refused");
