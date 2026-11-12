import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { getCampaignById } from "@/lib/db/campaigns";
import {
  getPdfImport,
  readDraft,
  readFonts,
  readModelAnswers,
  readOutline,
  readPages,
  readPictures,
  saveDraft,
  saveModelAnswers,
  setImportState,
  type PdfImport,
} from "@/lib/db/pdf-imports";
import { requestUtilityMessage } from "@/lib/dm/model";
import { arcTextTimeoutMs, utilityContextTokens } from "@/lib/model-client";
import { configuredDefaultStorySettings } from "@/lib/runtime-defaults";
import { stripReasoningArtifacts } from "@/lib/story-prompt";
import { runInUsageScope } from "@/lib/usage/scope";
import { settleItemsAndSpells, settleMonsters } from "@/lib/pdf-import/equivalents";
import { settleNames } from "@/lib/pdf-import/matches";
import { buildDraftSliced, type Draft } from "@/lib/pdf-import/draft-logic";
import { describePictures } from "@/lib/pdf-import/picture-logic";
import {
  chunkChars,
  chunkMessages,
  chunksOf,
  equivalentMessages,
  mergeFindings,
  NO_FINDINGS,
  readChunkReply,
  readEquivalents,
  type Chunk,
  type EquivalentAsk,
  type ChunkFindings,
} from "@/lib/pdf-import/ai-logic";
import type { StorySettings } from "@/lib/types";

// The import job: the book's layout read into a draft, then, when the GM
// asked for it and a model is there, the book read piece by piece by the
// model, each answer kept as it arrives. One import runs at a time on a
// server (they are long, and a second would only halve both); the rest
// wait their turn. A server that restarts mid-job resumes it the next time
// anyone looks (`resumeIfStranded`), asking the model only for the pieces
// it had not answered.

declare global {
  var __odmPdfImportBoot: string | undefined;
  var __odmPdfImportQueues: Map<string, Promise<void>> | undefined;
  var __odmPdfImportRunning: Set<string> | undefined;
}

function boot(): string {
  globalThis.__odmPdfImportBoot ??= randomUUID();
  return globalThis.__odmPdfImportBoot;
}

function running(): Set<string> {
  globalThis.__odmPdfImportRunning ??= new Set();
  return globalThis.__odmPdfImportRunning;
}

// After this many pieces in a row fail to reach the model, it is not
// coming back: the job keeps what the layout gave and says so.
const UNREACHABLE_AFTER = 3;

export function startImportJob(id: string): void {
  if (running().has(id)) return;
  running().add(id);
  setImportState(id, { state: "working", boot: boot(), step: "Waiting for your other import to finish", reason: "" });
  // One book at a time per account, so one long model read waits only its
  // own importer's next book; the model calls themselves queue behind the
  // tables on the backend (background: true).
  const owner = getPdfImport(id)?.userId ?? "";
  const queues = (globalThis.__odmPdfImportQueues ??= new Map<string, Promise<void>>());
  const previous = queues.get(owner) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => runImport(id))
    .catch((error) => {
      console.error("[pdf-import] job failed", error);
      if (getPdfImport(id)) setImportState(id, { state: "failed", reason: "The import stopped on an error. Try again, or import without the model." });
    })
    .finally(() => {
      running().delete(id);
      if (queues.get(owner) === next) queues.delete(owner);
    });
  queues.set(owner, next);
}

// A job the last server process was running when it stopped.
export function resumeIfStranded(item: PdfImport): void {
  if (item.state === "working" && item.boot !== boot() && !running().has(item.id)) startImportJob(item.id);
}

function cancelled(id: string): boolean {
  const current = getPdfImport(id);
  return !current || current.state !== "working";
}

async function runImport(id: string): Promise<void> {
  const item = getPdfImport(id);
  if (!item || item.state !== "working") return;
  let draft = readDraft(id);
  if (!draft) {
    setImportState(id, { step: "Reading the book's layout", done: 0, total: 0 });
    const pages = readPages(id);
    if (!pages.length) {
      setImportState(id, { state: "failed", reason: "No pages arrived from this book. Pick the PDF again." });
      return;
    }
    draft = await buildDraftSliced({ fileName: item.fileName, title: item.title, pageCount: item.pageCount, outline: readOutline(id), fonts: readFonts(id), pages }, describePictures(pages, readPictures(id), readOutline(id)));
    settleMonsters(draft);
    settleItemsAndSpells(draft);
    saveDraft(id, draft);
  }
  if (cancelled(id)) return;
  if (item.useModel && !draft.model) {
    draft = await readWithModel(item, draft);
    if (!draft) return;
    // What the model found (its people, fights and treasure) set beside
    // SRD 5.1 too; the model picks the equivalent of a creature no name
    // settles.
    settleItemsAndSpells(draft);
    setImportState(id, { step: "Matching creatures to SRD 5.1" });
    await settleNames(draft, draft.model?.used ? (asks) => pickEquivalents(item, asks) : null);
    saveDraft(id, draft);
  } else if (!draft.settled) {
    await settleNames(draft, null);
    draft.settled = true;
    saveDraft(id, draft);
  }
  if (cancelled(id)) return;
  setImportState(id, { state: "review", step: "", title: item.title || draft.title });
}

function settingsFor(item: PdfImport): StorySettings {
  const campaign = item.campaignId ? getCampaignById(item.campaignId) : null;
  return campaign?.settings ?? configuredDefaultStorySettings();
}

// The key a piece's answer is kept under: what the piece holds.
export function answerKey(chunk: Pick<Chunk, "title" | "text">): string {
  return createHash("sha1").update(`${chunk.title}\n${chunk.text}`).digest("hex").slice(0, 20);
}

async function readWithModel(item: PdfImport, draft: Draft): Promise<Draft | null> {
  const settings = settingsFor(item);
  const window = await utilityContextTokens(settings).catch(() => 16_384);
  const chunks = chunksOf(draft.sections, chunkChars(window));
  const outline = draft.sections.filter((section) => section.level === 1).map((section) => section.title);
  // Answers are kept by what the piece holds, not its place in the book: a
  // model with another window cuts the book differently, and its pieces
  // must not take the old answers of other pages. A piece the model failed
  // is asked again on the next run.
  const answers = readModelAnswers(item.id) as Record<string, ChunkFindings | { failed: string }>;
  const keyOf = answerKey;
  const answered = (chunk: Chunk) => "npcs" in ((answers[keyOf(chunk)] ?? {}) as object);
  const doneCount = () => chunks.filter(answered).length;
  let failedInRow = 0;
  let lastError = "";
  setImportState(item.id, { total: chunks.length, done: doneCount() });
  for (const chunk of chunks) {
    if (answered(chunk)) continue;
    if (cancelled(item.id)) return null;
    setImportState(item.id, { step: `Reading "${chunk.title || "the opening"}" with the model`, done: doneCount() });
    const answer = await askChunk(item, settings, draft.title, outline, chunk);
    if ("error" in answer) {
      failedInRow += 1;
      lastError = answer.error;
      answers[keyOf(chunk)] = { failed: answer.error };
      if (failedInRow >= UNREACHABLE_AFTER && !chunks.some(answered)) {
        saveModelAnswers(item.id, answers);
        return {
          ...draft,
          model: { used: false, chunks: chunks.length, failed: chunks.length, note: `The model could not read the book (${lastError}). The import kept what the book's layout gives.` },
        };
      }
    } else {
      failedInRow = 0;
      answers[keyOf(chunk)] = answer.found;
    }
    saveModelAnswers(item.id, answers);
    setImportState(item.id, { done: doneCount() });
  }
  const read = chunks.filter(answered).map((chunk) => ({ chunk, found: answers[keyOf(chunk)] as ChunkFindings }));
  const failed = chunks.length - read.length;
  const merged = mergeFindings(draft, read.length ? read : [{ chunk: chunks[0], found: NO_FINDINGS }]);
  return {
    ...merged,
    model: {
      used: true,
      chunks: chunks.length,
      failed,
      note: failed ? `The model could not read ${failed} of the book's ${chunks.length} pieces${lastError ? ` (${lastError})` : ""}; what they hold is still in the GM's lore.` : "",
    },
  };
}

async function askChunk(item: PdfImport, settings: StorySettings, title: string, outline: string[], chunk: Chunk): Promise<{ found: ChunkFindings } | { error: string }> {
  const messages = chunkMessages(title, outline, chunk);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await runInUsageScope({ userId: item.userId, ...(item.campaignId ? { campaignId: item.campaignId } : {}) }, () =>
      requestUtilityMessage(
        settings,
        attempt ? [...messages, { role: "user", content: "Answer again with only the JSON object, nothing before or after it." }] : messages,
        // Background: a table mid-turn on the same backend goes first.
        { meta: { task: "pdf_import" }, timeoutMs: arcTextTimeoutMs(), background: true },
      ),
    );
    if (result.error) {
      const body = (await result.error.json().catch(() => ({}))) as { error?: string };
      return { error: body.error || "the model did not answer" };
    }
    const found = readChunkReply(stripReasoningArtifacts(String(result.message?.content ?? "")));
    if (found) return { found };
  }
  return { error: "the model's answer was not readable" };
}

// The model's pick of each unmatched creature's SRD 5.1 equivalent, a few
// creatures at a time (each with its own list) so a 16K window holds them.
async function pickEquivalents(item: PdfImport, asks: EquivalentAsk[]): Promise<Map<string, string>> {
  const settings = settingsFor(item);
  const out = new Map<string, string>();
  for (let at = 0; at < asks.length; at += 6) {
    const batch = asks.slice(at, at + 6);
    const result = await runInUsageScope({ userId: item.userId, ...(item.campaignId ? { campaignId: item.campaignId } : {}) }, () =>
      requestUtilityMessage(settings, equivalentMessages(batch), { meta: { task: "pdf_import" }, timeoutMs: arcTextTimeoutMs(), background: true }),
    );
    if (result.error) break;
    for (const [name, srd] of readEquivalents(stripReasoningArtifacts(String(result.message?.content ?? "")), batch)) out.set(name, srd);
  }
  return out;
}
