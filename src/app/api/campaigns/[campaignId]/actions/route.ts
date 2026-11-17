import { z } from "zod";
import { ACTION_MAX_CHARS, formatCount, textLength } from "@/lib/text-limits";
import { requestT } from "@/lib/request-locale";
import { resolveActionCharacter } from "@/lib/player-characters";
import { currentPcId } from "@/lib/character-seat";
import { getActiveEncounter } from "@/lib/db/encounters";
import { isErrorResponse, requireVoice } from "@/lib/campaign-api";
import {
  allocateSeq,
  campaignSeats,
  canAct,
  claimRecap,
  getFloor,
  combatOwnsFloor,
} from "@/lib/db/campaigns";
import { countMessages, insertCampaignMessage, listRecentMessages } from "@/lib/db/messages";
import { getSheetById, getSheetForUser, listSheets } from "@/lib/db/sheets";
import { aiTurnNamedBySeat, commandedSheet, dominatedRefusal, gmCompanionReactor, gmCompanionTurn } from "@/lib/dm/companion-command";
import { openHits } from "@/lib/dm/last-hit";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { allyReactions } from "@/lib/battlemap/hand-react";
import { aiTurnRefusal } from "@/lib/workshop/test-seats-logic";
import type { ActKind } from "@/lib/dm/can-act";
import { heroFell } from "@/lib/characters/fallen-logic";
import { answerSpotlight } from "@/lib/dm/spotlight-answer";
import { requestDmTurn } from "@/lib/dm/loop";
import { settleTableWait, waitsForTable } from "@/lib/dm/table-wait";
import { holdsPostForTable } from "@/lib/dm/table-wait-logic";
import { coverInEffect } from "@/lib/dm/delegation";
import { hasHumanDm, isDmSeat } from "@/lib/dm/viewer";
import { invokeEngine } from "@/lib/dm/invoke";
import { handsFullForPlayer } from "@/lib/dm/gear-hands";
import { claimNarrationSeq } from "@/lib/dm/narration-slot";
import { enqueueDmJob } from "@/lib/dm/queue";
import { runResumeRecap } from "@/lib/dm/recap";
import { RECAP_AFTER_MS } from "@/lib/dm/session-hold-logic";
import { sessionHoldOn } from "@/lib/dm/session-hold";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { TYPED_REACTION, directCardCalls, drawStopsCast, isStoredCast, isTypedReaction, parseMessageIntent, type MessageIntent } from "@/lib/dm/intent-logic";
import { takeBackItemCast } from "@/lib/dm/item-use";
import { refusedPartsLine } from "@/lib/dm/action-parts-logic";
import { directContextFor } from "@/lib/dm/direct-context";
import { addressesDm } from "@/lib/dm/ooc-question";
import { spokenLine } from "@/lib/dm/speech";
import { cardMoment, intentRefusal } from "@/lib/dm/intent-check";
import { concentrationSwapFor } from "@/lib/dm/concentration-confirm";
import { inCoordination } from "@/lib/dm/coordination";
import { confirmsSwap } from "@/lib/dm/concentration-confirm-logic";
import { tableAuthors } from "@/lib/db/homebrew";
import { refuseDuringBreak } from "@/lib/dm/table-break";
import { isSecretActionBody, secretActionResponse } from "@/lib/dm/secret-action-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The length is checked after the shape, so a long move hears its limit
// rather than "Invalid action." (issue 207).
const actionSchema = z.object({
  content: z.string().trim().min(1),
  characterId: z.string().trim().min(1).optional(),
  kind: z.enum(["do", "say", "ooc"]).default("do"),
  // The card the Hand played, beside the sentence it wrote. Optional: typed
  // actions and older clients send none, and a malformed one is dropped
  // rather than refusing the action (src/lib/dm/intent-logic.ts).
  intent: z.unknown().optional(),
  // The player's yes to a cast that ends their running concentration spell
  // (issue 252), naming exactly what they agreed to: it answers only while
  // the character, the running spell and the new one are still those.
  concentrationAck: z
    .object({
      characterId: z.string().trim().min(1).max(80),
      current: z.string().trim().min(1).max(120),
      next: z.string().trim().min(1).max(120),
    })
    .optional(),
  // Words typed for a hero's reaction (issue 685): the composer's Speaking
  // as names the hero, the one whose turn it is or another of theirs. Taken
  // off the hero's turn as a reaction card is, while a hit is open and their
  // reaction unspent, and marked as a reaction so it is no word on their own
  // turn. Never with a card.
  reaction: z.boolean().optional(),
});

// A refusal's words: the request's language (requestT), the way the read
// routes answer (ea431ca6). Panels and alerts show the server's error raw.
type T = (key: string, vars?: Record<string, string | number>) => string;

// A hero who fell acts no more (issue 655): the words are the session's own
// (table.session.fallen, keyed when the composer learned them).
function fallenRefusal(t: T, name: string): string {
  return t("{name} has fallen. Use OOC for table talk until your new hero joins.", { name });
}

// The engine's refusal words, carried into the reader's keys AT THIS
// BOUNDARY — the sources ride the AI protocol and are never edited here
// (can-act.ts, action-budget.ts, cast-guard.ts, cast-rules.ts; the same
// discipline as src/lib/battlemap/hand-core.ts, which mirrors can-act's
// KIND_WORDS for the Hand's own gates). Sentences are matched exactly; a
// sentence the mapping has not met keeps the engine's English.

// can-act.ts names the act in its sentences (KIND_WORDS there); intent-check.ts
// kindOf judges a card as the same kinds. Mirrored, so a drift there makes the
// match miss and the refusal falls back to the engine's English.
const KIND_WORDS: Record<ActKind, string> = {
  action: "take an action",
  bonus: "take a bonus action",
  reaction: "take a reaction",
  attack: "attack",
  cast: "cast a spell",
  move: "move",
  free: "act",
};

// intent-check.ts kindOf: the ActKind a Hand card is judged as.
function kindOfIntent(intent: MessageIntent): ActKind {
  switch (intent.card) {
    case "attack":
    case "rider":
      return "attack";
    case "spell":
      return "cast";
    case "feature":
      return "free";
    case "basic":
      return intent.action === "end-turn" ? "free" : intent.action === "stand-up" || intent.action === "dismount" ? "move" : intent.bonus ? "bonus" : "action";
    case "reaction":
      return "reaction";
    // A shield's action, a draw's object interaction or a free drop: the
    // tool charges the right one; here only whether they may act at all.
    case "gear":
      return intent.action === "use" ? "action" : "free";
  }
}

// A card the engine refuses before anything is posted (intent-check.ts asks
// can-act.ts, cast-guard.ts and action-budget.ts). Each mapping, refusal → key:
//   dead (can-act)                   → table.hand.gate.dead
//   down, 0 HP (can-act)             → table.hand.gate.down
//   incapacitated, by a condition    → table.hand.gate.stopped
//   incapacitated, by a spell's hold → table.hand.gate.spellHeld
//   surprised, a reaction            → table.hand.gate.surprisedReaction
//   surprised, the first round       → table.hand.gate.surprised
//   no_initiative                    → table.hand.gate.noInitiative
//   not_your_turn                    → table.hand.gate.notYourTurn
//   the reaction spent (action-budget, what = the feature or "The reaction")
//                                    → table.hand.gate.reactionSpent
// The cast guard's own refusals (the spell not held, a raging or polymorphed
// caster, untrained armor, the components, the slot and the turn's room for
// the casting) keep the engine's English: no reader key exists for them, the
// Hand's cards show them as written too (hand-spells.ts passes them through),
// and they are the AI protocol's words.
function engineRefusalKey(error: string, kind: ActKind, name: string, what: string, t: T): string {
  const act = KIND_WORDS[kind] ?? KIND_WORDS.free;
  const doing = ({ "action": t("take an action"), "bonus": t("take a bonus action"), "reaction": t("take a reaction"), "attack": t("attack"), "cast": t("cast a spell"), "move": t("move"), "free": t("act") } as Record<string, string>)[kind] ?? String(kind);
  if (error === `${name} is dead and cannot ${act}. Only magic that raises the dead brings them back.`) {
    return t("{name} is dead and cannot {what}. Only magic that raises the dead brings them back.", { name, what: doing });
  }
  if (error === `${name} is at 0 HP and cannot ${act}. They act again once they are healed above 0.`) {
    return t("{name} is at 0 HP and cannot {what}. They act again once they are healed above 0.", { name, what: doing });
  }
  const heldPrefix = `${name} is `;
  const stoppedTail = ` and cannot ${act} until the condition ends.`;
  if (error.startsWith(heldPrefix) && error.endsWith(stoppedTail)) {
    const condition = error.slice(heldPrefix.length, error.length - stoppedTail.length);
    if (condition) {
      return t("{name} is {condition} and cannot {what} until the condition ends.", { name, condition, what: doing });
    }
  }
  const spellHeldTail = ` and cannot ${act} while it lasts.`;
  if (error.startsWith(heldPrefix) && error.endsWith(spellHeldTail)) {
    const held = error.slice(heldPrefix.length, error.length - spellHeldTail.length);
    if (held) {
      return t("{name} is {held} and cannot {what} while it lasts.", { name, held, what: doing });
    }
  }
  if (error === `${name} is surprised and has no reaction until their first turn has passed.`) {
    return t("{name} is surprised and has no reaction until their first turn has passed.", { name });
  }
  if (error === `${name} is surprised and cannot ${act} in the first round. They act from round 2.`) {
    return t("{name} is surprised and cannot {what} in the first round. They act from round 2.", { name, what: doing });
  }
  if (error === `Initiative is still being rolled, so ${name} cannot ${act} yet. Roll initiative for every character first.`) {
    return t("Initiative is still being rolled, so {name} cannot {what} yet. Roll initiative for every character first.", { name, what: doing });
  }
  const turnTail = `'s turn, not ${name}'s. Off their own turn a character can only use their reaction. What they declared waits for their turn.`;
  if (error.startsWith("It is ") && error.endsWith(turnTail)) {
    // The sentence is "It is {who}" + this tail; the tail already opens with
    // "'s turn", so the who is everything between the prefix and the tail.
    const who = error.slice("It is ".length, error.length - turnTail.length);
    if (who) {
      return t("It is {who}'s turn, not {name}'s. Off their own turn a character can only use their reaction. What they declared waits for their turn.", { who: who === "someone else" ? t("someone else") : who, name });
    }
  }
  const reactionSpent = `${name} has already used their reaction; it comes back at the start of their next turn. ${what} does not happen.`;
  if (error === reactionSpent) {
    return t("{name} has already used their reaction; it comes back at the start of their next turn. {what} does not happen.", { name, what: intentFeature(what, t) });
  }
  return error;
}

// The spend the reaction refusal names: a feature's own name, else the word.
function intentFeature(what: string, t: T): string {
  return what === "The reaction" ? t("The reaction") : what;
}

// A character dominated by the other side (companion-command.ts). Mapping:
//   "{name} is dominated: the GM plays {name} until the charm ends. Use OOC
//    for table talk." → board.side.dominated + refusal.oocTail
// (the sentence's first half is already keyed for the board's own line).
function dominatedKey(error: string, name: string, t: T): string {
  if (error === `${name} is dominated: the GM plays ${name} until the charm ends. Use OOC for table talk.`) {
    return `${t("{name} is dominated: the GM plays {name} until the charm ends.", { name })} ${t("Use OOC for table talk.")}`;
  }
  return error;
}

// Which of the player's characters acts (resolveActionCharacter,
// src/lib/player-characters.ts). Mapping, refusal → key:
//   not one of yours        → refusal.notYourCharacter
//   a companion off its turn → refusal.companionOrders (the name is cut from
//     the engine's "{name} follows your orders …" sentence)
//   select it first         → refusal.selectFirst
//   wait for its turn       → refusal.waitOwnTurn
function actorErrorKey(error: string, t: T): string {
  if (error === "That is not one of your characters.") {
    return t("That is not one of your characters.");
  }
  const ordersTail = " follows your orders on their own turn in a fight; the GM plays them otherwise.";
  if (error.endsWith(ordersTail)) {
    return t("{name} follows your orders on their own turn in a fight; the GM plays them otherwise.", { name: error.slice(0, error.length - ordersTail.length) });
  }
  if (error === "Select that character before acting as them.") {
    return t("Select that character before acting as them.");
  }
  if (error === "Wait for that character's turn in the initiative order. Use OOC for table talk.") {
    return t("Wait for that character's turn in the initiative order. Use OOC for table talk.");
  }
  return error;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  // The refusals read the asker's language: the Hand and the composer show
  // them raw (requestT — x-odm-locale, then Accept-Language).
  const t = requestT(request);
  const context = await requireVoice(campaignId, request);
  if (isErrorResponse(context)) {
    return context;
  }

  const { campaign, user } = context;
  if (campaign.status !== "active") {
    return Response.json({ error: t("The adventure has not started yet.") }, { status: 400 });
  }

  const owned = getSheetForUser(campaignId, user.id);
  const raw = await request.json().catch(() => ({}));
  // A companion nobody commands, or a hero the other side dominates, on its
  // own turn at a table a person runs, is the GM's to play
  // (src/lib/dm/companion-command.ts gmCompanionTurn): its Hand's cards and
  // its End turn come from the GM seat, which may hold no character of its
  // own. Named by the card, never assumed.
  const companionTurn = gmCompanionTurn(campaign, user.id);
  const namedId = raw && typeof raw === "object" ? (raw as { characterId?: unknown }).characterId : undefined;
  // Between its turns, the same seat plays that companion's reaction cards
  // (issue 685): its Shield, its Parry, its Protection for an ally.
  // Held to a reaction card below, once the body is read.
  const rawIntent = raw && typeof raw === "object" ? (raw as { intent?: unknown }).intent : undefined;
  const companionReactor =
    !(companionTurn && namedId === companionTurn.id) && parseMessageIntent(rawIntent)?.card === "reaction" && typeof namedId === "string"
      ? gmCompanionReactor(campaign, user.id, namedId)
      : null;
  const playsCompanion = companionTurn && namedId === companionTurn.id ? companionTurn : companionReactor;
  // At a table the AI runs, that turn is the AI's: the steering seat is told
  // so, rather than "You need a character to act" (test-seats-logic.ts).
  const aiTurn = raw && typeof raw === "object" && (raw as { kind?: unknown }).kind !== "ooc" ? aiTurnNamedBySeat(campaign, user.id, namedId) : null;
  if (aiTurn) {
    return Response.json({ error: aiTurnRefusal(campaign, aiTurn.name) }, { status: 409 });
  }
  const selected = owned ?? playsCompanion;
  if (!selected) {
    return Response.json({ error: t("You need a character to act.") }, { status: 400 });
  }

  // A secret action (issue 503 Phase 7) is held by the server, never posted.
  if (isSecretActionBody(raw)) {
    if (!owned) {
      return Response.json({ error: t("You need a character to act.") }, { status: 400 });
    }
    if (heroFell(owned)) {
      return Response.json({ error: fallenRefusal(t, owned.name) }, { status: 409 });
    }
    return secretActionResponse(campaign, user.id, owned, raw, request);
  }
  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: t("Invalid action.") }, { status: 400 });
  }
  if (textLength(parsed.data.content) > ACTION_MAX_CHARS) {
    // The shared builder (text-limits.ts) stays English for its other
    // consumers; this route maps its sentence at the boundary instead.
    const what = parsed.data.kind === "say" ? t("A line") : parsed.data.kind === "ooc" ? t("Table talk") : t("A move");
    return Response.json(
      {
        error: t("{what} can be up to {max} characters; this one has {length}. Shorten it and send it again.", { what, max: formatCount(ACTION_MAX_CHARS), length: formatCount(textLength(parsed.data.content)) }),
        maxChars: ACTION_MAX_CHARS,
      },
      { status: 400 },
    );
  }

  const { kind } = parsed.data;
  // A table break (src/lib/dm/table-break.ts) stops play where it stands:
  // table talk goes on, nothing in character does, and the floor underneath
  // is left alone so Resume picks up exactly there.
  const paused = kind === "ooc" ? null : refuseDuringBreak(campaignId, undefined, request);
  if (paused) {
    return paused;
  }
  // A character dominated by the other side is the DM's to play until the
  // charm ends (src/lib/dm/companion-command.ts): its player hears why,
  // whoever's turn it is. Table talk is free, and so is the GM seat playing
  // its turn (gmCompanionTurn), which this used to refuse as the player's.
  const named = parsed.data.characterId ? getSheetById(parsed.data.characterId) : null;
  const acting = playsCompanion ?? (named && named.campaignId === campaignId && named.userId === user.id ? named : selected);
  const held = kind === "ooc" || playsCompanion ? null : dominatedRefusal(campaignId, acting);
  if (held) {
    return Response.json({ error: dominatedKey(held, acting.name, t), dominated: true }, { status: 409 });
  }
  const played = kind === "do" ? parseMessageIntent(parsed.data.intent) : null;
  // Words typed as a reaction carry the reaction mark a card carries, and a
  // reaction card naming nothing to resolve is held to the same checks.
  const typedReaction = kind === "do" && (isTypedReaction(played) || (!played && parsed.data.reaction === true));
  const intent = typedReaction ? TYPED_REACTION : played;
  if (companionReactor && intent?.card !== "reaction") {
    return Response.json({ error: `${companionReactor.name} acts on their own turn; between turns only their reaction cards are played.` }, { status: 409 });
  }
  // Floor control: during a spotlight only the named players may act (ooc is
  // always allowed); the floor releases once ALL of them have answered.
  // During a hold nobody may act until the lead releases. This read-modify-
  // write must stay await-free so it is atomic in Node.
  const floor = getFloor(campaignId);
  // A reaction is taken on somebody else's turn (SRD 5.1): a reaction card
  // passes the initiative floor, and the engine's canAct judges it below.
  // The same holds while a person plays the enemies' turns under a hold
  // (src/lib/dm/enemies-due.ts): that is when a Shield or an opportunity
  // attack is wanted most.
  // Words typed for a hero's reaction (the composer's Speaking as) are held to
  // what a reaction card is: a hit still open in the fight (on them, or on an
  // ally a reaction of theirs covers) and their reaction unspent. Anything
  // else is the turn's words.
  if (typedReaction) {
    const reactor = named && named.campaignId === campaignId ? named : null;
    const encounterNow = getActiveEncounter(campaignId);
    // Any hero's open hit once let words through for a hero with nothing to
    // answer: the hit must be on them, or on an ally a reaction they hold
    // covers, as the Hand reads it (hand-react.ts allyReactions).
    const hitOpen =
      reactor !== null &&
      encounterNow !== null &&
      (openHits(campaignId, reactor.id).length > 0 ||
        (activePublicEncounter(campaignId)?.lastHits ?? []).some((hit) => hit.characterId !== reactor.id && allyReactions(reactor, hit).length > 0));
    if (!reactor || !encounterNow || !hitOpen) {
      return Response.json(
        { error: `No hit is open for ${reactor?.name ?? "that character"} to answer now. Send it as the hero whose turn it is, or as table talk.` },
        { status: 409 },
      );
    }
    if (encounterNow.reactionsUsed.includes(reactor.id)) {
      return Response.json(
        { error: `${reactor.name} has already used their reaction; it comes back at the start of their next turn.` },
        { status: 409 },
      );
    }
  }
  const reactionOffTurn = intent?.card === "reaction" && combatOwnsFloor(floor);
  // The GM playing a companion's turn holds that turn: the floor names the
  // companion, not them.
  if (!reactionOffTurn && !(playsCompanion && kind !== "ooc") && !canAct(floor, user.id, kind)) {
    if (floor.mode === "hold") {
      // The enemies hold the floor only while some are still owed a turn
      // (src/lib/dm/enemies-due.ts); a hold over a fight with none due is
      // the storyteller's, and says so.
      const enemiesDue = combatOwnsFloor(floor) && (getActiveEncounter(campaignId)?.legendary.due?.length ?? 0) > 0;
      return Response.json(
        {
          error: enemiesDue
            ? t("The enemies are taking their turns; the GM hands the turn on. Use OOC for table talk.")
            : campaign.dmUserId
              ? t("The GM has not opened responses yet. Use OOC for table talk.")
              : t("The party lead has not opened responses yet. Use OOC for table talk."),
          floor,
        },
        { status: 409 },
      );
    }
    if (floor.mode === "initiative") {
      return Response.json(
        {
          error: t("It is {name}'s turn in the initiative order. Use OOC for table talk.", { name: floor.currentName || t("another character") }),
          floor,
        },
        { status: 409 },
      );
    }
    const waitingOn =
      floor.mode === "spotlight"
        ? listSheets(campaignId)
            .filter(
              (entry) =>
                floor.userIds.includes(entry.userId) &&
                !floor.respondedUserIds.includes(entry.userId) &&
                !heroFell(entry),
            )
            .map((entry) => entry.name)
            .join(", ")
        : "";
    return Response.json(
      {
        error: waitingOn
          ? t("The GM is waiting on {names}. Use OOC for table talk.", { names: waitingOn })
          : t("It is not your moment to act."),
        floor,
      },
      { status: 409 },
    );
  }

  // Which of the player's characters acts (src/lib/player-characters.ts):
  // the one named, else the one whose turn it is, else the selected one.
  // The floor has already said whether this player may act at all, so a
  // refusal here is only ever about the wrong sibling. The initiative
  // pointer binds only while the fight owns the floor: a table the DM opened
  // mid-fight is free to act as whoever it has selected.
  const actor = playsCompanion && kind !== "ooc" ? { sheet: playsCompanion } : resolveActionCharacter({
    sheets: listSheets(campaignId),
    userId: user.id,
    selectedId: selected.id,
    characterId: parsed.data.characterId,
    initiativeId: kind !== "ooc" && combatOwnsFloor(floor) ? currentPcId(getActiveEncounter(campaignId)) : undefined,
    reaction: intent?.card === "reaction",
    multiCharacter: campaign.gameSettings.multiCharacter,
  });
  if ("error" in actor) {
    return Response.json({ error: actorErrorKey(actor.error, t), floor }, { status: actor.status });
  }
  const { sheet } = actor;
  // A companion's reaction from its commander: the server's word on who
  // commands it (a commander who left, or a companion turned on the party,
  // commands nobody), not the sheet's field the screen read.
  if (sheet.isCompanion && !playsCompanion && !commandedSheet(campaign, user.id, sheet.id)) {
    return Response.json({ error: `${sheet.name} is not under your command; the GM plays them.`, floor }, { status: 409 });
  }
  // A hero who fell acts no more (issue 655): the composer says so, and a
  // connected agent or an older screen posting for them is told the same,
  // rather than the GM narrating the dead. Table talk stays open.
  if (kind !== "ooc" && !playsCompanion && heroFell(sheet)) {
    return Response.json({ error: fallenRefusal(t, sheet.name), floor }, { status: 409 });
  }
  // A card the engine would refuse is refused here, with the engine's own
  // reason and before anything is posted, so the Hand never marks spent a
  // card that was never going to resolve (src/lib/dm/intent-check.ts). The
  // engine's sentences are carried into the reader's words at the boundary
  // above (engineRefusalKey); unknown wording keeps the engine's English.
  if (intent) {
    const refusal = intentRefusal(campaign, sheet, intent);
    if (refusal) {
      return Response.json(
        { error: engineRefusalKey(refusal, kindOfIntent(intent), sheet.name, intent.feature ?? "The reaction", t) },
        { status: 409 },
      );
    }
  }
  // A character in the plan the party is coordinating puts its move there,
  // not straight to the DM (issue 254): the plan resolves as one beat, and a
  // move posted beside it would wake the DM before it. Table talk is free.
  if (kind !== "ooc" && inCoordination(campaignId, sheet.id)) {
    return Response.json(
      { error: t("The party is coordinating its next move; put {name}'s part in the plan above the box, or ask the lead to set the plan aside.", { name: sheet.name }), coordinating: true },
      { status: 409 },
    );
  }
    // A cast that would end the character's running concentration spell is
  // asked about first (issue 252): nothing is posted, no floor is spent and
  // no DM turn wakes until the player says yes, and the yes is checked
  // against the state now, so an old answer cannot authorise another cast.
  const swap = concentrationSwapFor(sheet, { intent, content: parsed.data.content, kind }, tableAuthors(campaignId));
  if (swap && !confirmsSwap(swap, parsed.data.concentrationAck)) {
    // The question the clients answer from the confirmConcentration FIELDS
    // (concentration-prompt.ts); the error is the same words, in the asker's
    // language, for a reader without the dialog.
    return Response.json(
      { error: t("Casting {next} will end {name}'s concentration on {current}. Replace {current}?", { next: swap.next, name: sheet.name, current: swap.current }), confirmConcentration: { ...swap, characterName: sheet.name } },
      { status: 409 },
    );
  }
  // A card the DM plays for a character they hold, at a table they run (a
  // test fight a person runs, issue 553): the one who would adjudicate it
  // played it, so the engine resolves it now, with the same call an AI turn
  // makes before it narrates (directCardCall), and nothing waits in the DM's
  // queue for the DM. A card the engine cannot resolve whole (a summon whose
  // creatures the GM picks, an Entangle that catches whoever stands in it) is
  // posted below and queued as any player's is, for the console.
  // A co-GM adjudicates as the GM does (isDmSeat), and plays a companion's
  // turn as the GM may (gmCompanionTurn): their cards resolve the same way.
  const dmSeats = campaignSeats(campaign);
  const direct =
    intent && kind === "do" && hasHumanDm(dmSeats) && isDmSeat(dmSeats, user.id)
      ? directCardCalls(intent, sheet.id, directContextFor(campaignId, intent, tableAuthors(campaignId), sheet.id))
      : null;
  if (direct) {
    // A casting shared out among creatures is one call with every creature
    // in its list (src/lib/dm/action-parts-logic.ts): one slot, each
    // creature resolved in order. A creature refused while the rest landed
    // is said, and the card is spent: played again, it would reach the
    // others twice.
    const refused: string[] = [];
    for (const call of direct) {
      const resolved = await invokeEngine(campaign, { kind: "human", userId: user.id }, call);
      if (!resolved.ok) {
        // The DM seat resolving its own play hears the engine's tool words
        // (the AI protocol's own refusals, invoke's surface): these stay
        // English, as they read on the DM console.
        // The spell did not happen: what its item spent comes back.
        if (intent && isStoredCast(intent)) {
          takeBackItemCast(campaign, sheet.id, intent.spell ?? "");
        }
        // The tool's words are the storyteller's: a person reads them here.
        return Response.json({ error: handsFullForPlayer(resolved.error) }, { status: 409 });
      }
      const line = refusedPartsLine(resolved.result);
      if (line) {
        refused.push(line);
      }
      // A scroll misread: the item's use failed, and no spell's tool follows it.
      const stop = drawStopsCast(call.name, resolved.result);
      if (stop) {
        refused.push(stop.error);
        break;
      }
    }
    return Response.json({ resolved: true, ...(refused.length ? { refused: refused.join(" ") } : {}) });
  }
  const spotlightStillWaiting = kind !== "ooc" && answerSpotlight(campaignId, floor, user.id);

  const content =
    kind === "say"
      ? spokenLine(parsed.data.content)
      : kind === "ooc"
        ? `(ooc) ${parsed.data.content}`
        : parsed.data.content;

  const isFirstAction = countMessages(campaignId) === 0;

  // Returning after a long break: enqueue a "Previously..." recap before
  // this action's DM turn (claimRecap makes it at most once per gap).
  const lastMessages = listRecentMessages(campaignId, 1);
  const lastMessage = lastMessages[lastMessages.length - 1];
  // The same gap a session started after a long one is recapped for
  // (src/lib/dm/session-hold-logic.ts).
  const RECAP_IDLE_MS = RECAP_AFTER_MS;
  // Assisted mode, DM stepped away: the AI answers for the counted stretch
  // they handed over, so the branch below is the one that already exists for
  // an AI-run table rather than a third path.
  const covering = coverInEffect(
    campaign.gameSettings.dmMode,
    campaign.gameSettings.dmAssist,
    campaign.dmCover,
  );
  const humanDm = hasHumanDm(campaignSeats(campaign)) && !covering;
  // A person's table gets the recap too: it is a utility call that wakes no
  // DM turn, and recap.ts writes the DM's own secret track for exactly them.
  // Between sessions the recap is the next session's to open with
  // (src/lib/dm/session-hold.ts startSession), not table talk's.
  if (
    lastMessage &&
    !sessionHoldOn(campaignId) &&
    Date.now() - new Date(lastMessage.createdAt).getTime() > RECAP_IDLE_MS &&
    claimRecap(campaignId, lastMessage.seq)
  ) {
    enqueueDmJob(campaignId, () => runResumeRecap(campaignId));
  }

  // A reply to narration still streaming lands after it, not above it: the
  // narration claims the seq before this one (src/lib/dm/narration-slot.ts).
  claimNarrationSeq(campaignId);
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "player",
    userId: user.id,
    characterId: sheet.id,
    content,
    // Stamped with where the fight stands, whatever the client sent: a turn
    // that reads the card later gives it back once the fight has moved past
    // it (issue 931, direct-card-logic.ts cardStillDue).
    intent: intent ? { ...intent, declared: cardMoment(campaignId) } : intent,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });

  // OOC table talk does not wake the DM; everything else requests a
  // narration turn, except while a spotlight still waits on other players:
  // the single coalesced turn fires with the last answer and reads all the
  // queued messages. Requests coalesce: rapid actions share one turn (plus
  // at most one follow-up for actions landing mid-turn) instead of stacking.
  //
  // With a person in the DM seat there is no turn to wake. The action is an
  // intent: it sits in the DM's queue until they adjudicate it, and all the
  // table sees is that it landed. The message row and the floor bookkeeping
  // above are identical either way, which is what keeps one transcript.
  //
  // A person's queue takes every action as it lands, a spotlight answer
  // included: the coalescing that waits for the last answer is the AI turn's,
  // and holding answers back from a person lost all but the last of them.
  //
  // Table talk naming "@DM" is a question for the DM and wakes the AI for an
  // out-of-character answer (src/lib/dm/ooc-question.ts); a person in the
  // seat reads it where it lands.
  const askedDm = kind === "ooc" && addressesDm(parsed.data.content);
  if (humanDm ? kind !== "ooc" || isFirstAction : (kind !== "ooc" && !spotlightStillWaiting) || askedDm || isFirstAction) {
    if (humanDm) {
      publishPersisted(campaignId, "dm_intent_queued", {
        messageId: message.id,
        userId: user.id,
        characterId: sheet.id,
        seq,
      });
    } else if (holdsPostForTable({ floorBefore: floor.mode, kind, isFirstAction, waits: waitsForTable(campaign) })) {
      // Wait for the table (src/lib/dm/table-wait.ts): an open-floor post
      // joins the gathering beat, and the one turn that answers it runs when
      // the last present player has acted or passed, or the time runs out.
      // A spotlight answer never lands here: floor is the floor before this
      // post, so the answer that releases a spotlight wakes the DM below.
      if (settleTableWait(campaignId)) {
        requestDmTurn(campaignId);
      }
    } else {
      // Under a running cover, requestDmTurn itself spends one of the DM's
      // handed-over answers per enqueued turn (and none on a coalesced one),
      // so a burst of actions costs the DM one answer and not five.
      requestDmTurn(campaignId);
    }
  }

  return Response.json({ messageId: message.id }, { status: 202 });
}
