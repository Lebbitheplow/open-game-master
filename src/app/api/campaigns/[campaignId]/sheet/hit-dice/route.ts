import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { refuseDuringBreak } from "@/lib/dm/table-break";
import { getCampaignById } from "@/lib/db/campaigns";
import { claimRestDie, inShortRestWindow, restDieLeft } from "@/lib/db/clock";
import { dicePreferencesOf } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { listSheets } from "@/lib/db/sheets";
import { ownSheetFor } from "@/lib/character-seat";
import { entryDice } from "@/lib/dice";
import { parkReasonFor } from "@/lib/dice/held-rolls";
import { hitDiceRoll, partyChefDie, partySongOfRestDie, spendHitDice } from "@/lib/dm/hit-dice";
import { hearsSong } from "@/lib/dm/mt-srd-bard";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A player spends their own hit dice at the end of a short rest (SRD 5.1,
// Short Rest: the player rolls a die, adds Constitution, and may decide to
// spend another after each roll). The DM's take_rest opens the choice for
// every character whose player is at the table; it closes when the clock
// next moves. A player never writes the spent count or the hit points
// themselves. `characterId` names which of the player's own characters
// spends (the sheet on screen); unnamed, the selected one.
//
// Whose dice: this is the player's own request, with no call of the GM's to
// hold and no turn for a roll card to wait on, so the dice are taken where
// the player asks. A seat on physical dice is told what to roll (GET) and
// sends the faces with the spend (`faces`); the server rolls for every other
// seat, and for any spend that sends none ("Roll digitally instead", an
// older screen, an agent's seat). Before this the server rolled every hit
// die of a seat that was told it rolls its own (issue 902).
const spendSchema = z.object({
  dice: z.number().int().min(1).max(20),
  characterId: z.string().max(80).optional(),
  // One entry for each die of the roll GET described: a face, or "digital"
  // for a die the server draws (the pending-roll route's own shape).
  faces: z
    .array(z.union([z.number().int().min(1).max(100), z.literal("digital")]))
    .min(1)
    .max(60)
    .optional(),
});

const refuse = (error: string, status = 409) => Response.json({ error }, { status });

// Whether this player enters the faces of their own dice: they asked to roll
// real dice, at a table that allows them.
function typesFaces(campaignId: string, userId: string): boolean {
  const preferences = dicePreferencesOf(campaignId, userId);
  return parkReasonFor(preferences.dicePolicy, preferences.member) === "real_dice";
}

// The one die a song and a meal each add to this character's next spend, if
// the rest still owes it to them: a creature that spends hit dice gets each
// once a rest. Read here and claimed only once a spend lands, so showing a
// player what to roll, or a spend the rules refuse, uses neither up.
function restDice(campaignId: string, sheet: CharacterSheet): { songDie: string | null; chefDie: string | null } {
  const party = listSheets(campaignId);
  const song = partySongOfRestDie(party);
  const chef = partyChefDie(party);
  return {
    // "Who can hear your performance" (mt-srd-bard.ts), as the GM's spend
    // asks it (rest-tools.ts): a deafened listener gets no song's die.
    songDie: song && hearsSong(sheet) && restDieLeft(campaignId, sheet.id, "sung") ? song : null,
    chefDie: chef && restDieLeft(campaignId, sheet.id, "fed") ? chef : null,
  };
}

// Whether the asking player's character is in the short-rest window now, so
// the sheet offers "Spend a hit die" only while the engine would take it.
// For a seat on physical dice it also says what the next hit die rolls, so
// the sheet can ask for those dice: the expression the spend will score, and
// which of its dice a song or a meal added.
export async function GET(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const asked = new URL(request.url).searchParams.get("characterId")?.slice(0, 80);
  const sheet = ownSheetFor(campaignId, context.user.id, asked);
  const open = Boolean(sheet && !getActiveEncounter(campaignId) && inShortRestWindow(campaignId, sheet.id));
  if (!open || !sheet || !typesFaces(campaignId, context.user.id)) {
    return Response.json({ open });
  }
  const extra = restDice(campaignId, sheet);
  const ask = hitDiceRoll(sheet, 1, extra);
  return Response.json({
    open,
    ...(ask
      ? {
          roll: {
            expression: ask.expression,
            extras: [
              ...(extra.songDie ? [{ die: extra.songDie, from: "Song of Rest" }] : []),
              ...(extra.chefDie ? [{ die: extra.chefDie, from: "the cook's meal" }] : []),
            ],
          },
        }
      : {}),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = spendSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Send the number of hit dice to spend, 1 or more, and with faces one whole number for each die rolled." }, { status: 400 });
  }
  // A short rest's hit dice roll and heal: play, which waits out a break.
  const paused = refuseDuringBreak(campaignId);
  if (paused) {
    return paused;
  }
  const sheet = ownSheetFor(campaignId, context.user.id, parsed.data.characterId);
  if (!sheet) {
    return Response.json(
      { error: parsed.data.characterId ? "That is not one of your characters." : "You have no character in this campaign." },
      { status: 404 },
    );
  }
  if (getActiveEncounter(campaignId)) {
    return refuse("Hit dice are spent at the end of a short rest, and a fight is going on.");
  }
  if (!inShortRestWindow(campaignId, sheet.id)) {
    return refuse(
      `Hit dice are spent at the end of a short rest. ${sheet.name} is not resting now; ask the GM for a short rest and spend them when it ends.`,
    );
  }
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }
  // Song of Rest and a Chef's meal: one extra die each for a creature that
  // spends hit dice, once per rest. The GM's own spend added the meal's die
  // (rest-tools.ts) and this route never did, so a player who chose their
  // own hit dice ate the meal for nothing.
  const extra = restDice(campaignId, sheet);
  const sent = parsed.data.faces;
  if (sent?.some((face) => face !== "digital") && !typesFaces(campaignId, context.user.id)) {
    // As a roll card refuses them (pending-rolls/[pendingRollId]/route.ts).
    return refuse(
      "These hit dice are rolled by the server: typed dice count only for a player rolling real dice at a table that allows them. Spend the hit die without them.",
      403,
    );
  }
  if (sent) {
    // What the sheet asked for may have changed while the dice were in the
    // air: the song's die went to an earlier spend, a level changed the
    // modifier. The faces are scored against the roll as it is now, and one
    // that no longer fits is asked for again rather than guessed at.
    const ask = hitDiceRoll(sheet, parsed.data.dice, extra);
    const sides = ask ? entryDice(ask.expression) : [];
    if (ask && sides.length !== sent.length) {
      return refuse(
        `The dice for this hit die changed while you rolled: it is ${ask.expression} now, ${sides.length} ${sides.length === 1 ? "die" : "dice"}, and ${sent.length} came in. No hit die was spent; roll what the sheet shows now.`,
      );
    }
    const wrong = sent.findIndex((face, index) => face !== "digital" && face > sides[index]);
    if (wrong >= 0) {
      return refuse(`Die ${wrong + 1} is a d${sides[wrong]}: enter a whole number from 1 to ${sides[wrong]}. No hit die was spent.`, 400);
    }
  }
  const spent = spendHitDice({
    campaign,
    turnId: null,
    sheetId: sheet.id,
    requested: parsed.data.dice,
    ...extra,
    reason: `Short rest: hit dice spent by ${context.user.username}`,
    requestedBy: "player",
    ...(sent ? { faces: sent.map((face) => (face === "digital" ? null : face)) } : {}),
  });
  if ("error" in spent) {
    return refuse(spent.error);
  }
  if (extra.songDie) {
    claimRestDie(campaignId, sheet.id, "sung");
  }
  if (extra.chefDie) {
    claimRestDie(campaignId, sheet.id, "fed");
  }
  return Response.json({ ok: true, ...spent });
}
