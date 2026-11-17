import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { SECRET_KINDS, SECRET_SKILLS } from "@/lib/dm/pact-logic";
import { declareSecretAction } from "@/lib/dm/pact-players";
import { refuseDuringBreak } from "@/lib/dm/table-break";
import { translate } from "@/lib/messages-logic";
import { requestT } from "@/lib/request-locale";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The /actions route's secret mode (issue 503 Phase 7): an action a player
// in a pact takes where the table does not see it. Nothing is posted to the
// transcript and no DM turn wakes; the server holds it, rolls it hidden
// (src/lib/dm/pact-players.ts declareSecretAction), and the answer goes to
// the player alone. It comes out when the pact moves or someone catches it.
const secretSchema = z.object({
  characterId: z.string().trim().min(1).max(80).optional(),
  secret: z.object({
    kind: z.enum(SECRET_KINDS),
    text: z.string().trim().max(300).default(""),
    skill: z.enum(SECRET_SKILLS).optional(),
    targetId: z.string().trim().max(80).optional(),
    item: z.string().trim().max(120).optional(),
  }),
});

export function isSecretActionBody(raw: unknown): boolean {
  return Boolean(raw && typeof raw === "object" && "secret" in (raw as Record<string, unknown>));
}

// The refusals' words in the asker's language (the pact panel shows them
// raw): the request rides in from the actions route, so the break and the
// session holds answer in it too. The pact engine's own sentences
// (pact-logic.ts, pact-players.ts, shared with the storyteller's routes) are
// matched exactly at this boundary and never edited; a sentence the mapping
// has not met keeps the engine's English. Each mapping, refusal → key:
//   no pact acts on this table        → refusal.secretNoPactTable
//   attack needs the Turn setting     → refusal.secretNeedsTurnAttack
//   harming sabotage needs it too     → refusal.secretNeedsTurnHarm
//   "{name} is in no pact …"          → refusal.secretNoPact
//   the fight holds secrets           → refusal.secretWaitFight
//   no target named                   → refusal.secretSayTarget
//   "{name} carries nothing called …" → refusal.secretNoItem
function secretErrorKey(error: string, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (error === "This table keeps its companions, so no pact acts.") {
    return t("This table keeps its companions, so no pact acts.");
  }
  if (error === "Attacking another player's character needs a table set to Turn; this one is set to Leave.") {
    return t("Attacking another player's character needs a table set to Turn; this one is set to Leave.");
  }
  if (error === "Sabotage that harms needs a table set to Turn; this one allows only harmless sabotage.") {
    return t("Sabotage that harms needs a table set to Turn; this one allows only harmless sabotage.");
  }
  const noPactTail = " is in no pact, so has nothing to do in secret.";
  if (error.endsWith(noPactTail)) {
    return t("{name} is in no pact, so has nothing to do in secret.", { name: error.slice(0, error.length - noPactTail.length) });
  }
  if (error === "A secret action waits until the fight is over.") {
    return t("A secret action waits until the fight is over.");
  }
  if (error === "Say whose character, another at this table.") {
    return t("Say whose character, another at this table.");
  }
  const carries = error.indexOf(' carries nothing called "');
  if (carries > 0 && error.endsWith('".')) {
    return t("{name} carries nothing called \"{item}\".", {
      name: error.slice(0, carries),
      item: error.slice(carries + ' carries nothing called "'.length, error.length - 2),
    });
  }
  return error;
}

export function secretActionResponse(campaign: Campaign, userId: string, selected: CharacterSheet, raw: unknown, request?: Request): Response {
  // The asker's language when the route hands the request over; English
  // otherwise (campaign-api.ts refusalT is the pattern).
  const t = request
    ? requestT(request)
    : (key: string, vars?: Record<string, string | number>) => translate("en", key, vars);
  const parsed = secretSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: t("A secret action needs a kind (steal, scheme, harm or attack) and what you do.") }, { status: 400 });
  }
  const paused = refuseDuringBreak(campaign.id, undefined, request);
  if (paused) {
    return paused;
  }
  const named = parsed.data.characterId ? getSheetById(parsed.data.characterId) : null;
  const sheet = named && named.campaignId === campaign.id && named.userId === userId && !named.isCompanion ? named : selected;
  const outcome = declareSecretAction(campaign, sheet, parsed.data.secret);
  if ("error" in outcome) {
    return Response.json({ error: secretErrorKey(outcome.error, t) }, { status: outcome.status });
  }
  return Response.json(outcome);
}
