import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { currentTurnId } from "@/lib/dm/job-control";
import type { ItemCastCredit, ItemCastStore } from "@/lib/srd/item-cast-credit";
import { textKey } from "@/lib/language/text-logic";

// The spells items have paid for and their tools have not yet cast
// (src/lib/srd/item-cast-credit.ts), kept in the database the way a turn's
// last hits are (src/lib/dm/last-hit.ts). Held in memory, a restart between
// use_item and the spell's tool lost the credit: the cast then spent a slot
// of the caster's own, or was refused, and the charge or scroll it had taken
// never came back. One row per character; deleteCampaign clears them by hand,
// a chapter rewind drops them, and "Revert this turn" forgets the turn's own
// (forgetTurnItemCasts).

const db = getDatabase;

function read(sheetId: string): ItemCastCredit[] {
  const row = db().prepare(`SELECT payload_json FROM item_cast_credits WHERE character_id = ?`).get(sheetId) as { payload_json: string } | undefined;
  const list = row ? parseJson<ItemCastCredit[] | null>(row.payload_json, null) : null;
  return Array.isArray(list) ? list : [];
}

function write(sheetId: string, credits: ItemCastCredit[]) {
  if (!credits.length) {
    db().prepare(`DELETE FROM item_cast_credits WHERE character_id = ?`).run(sheetId);
    return;
  }
  const campaign = db().prepare(`SELECT campaign_id FROM character_sheets WHERE id = ?`).get(sheetId) as { campaign_id: string } | undefined;
  db()
    .prepare(
      `INSERT INTO item_cast_credits (character_id, campaign_id, payload_json, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (character_id)
       DO UPDATE SET payload_json = excluded.payload_json, created_at = excluded.created_at`,
    )
    .run(sheetId, campaign?.campaign_id ?? "", JSON.stringify(credits), nowIso());
}

type MetaEntry = { spell?: string; source?: string; others?: MetaEntry[] };

// Whether a condition this character's casting of the spell laid still holds
// on a character at their table or a creature in their fight: an item's
// numbers for a spell that runs on others only (Sanctuary on an ally) last
// while it does (item-cast-credit.ts runningItemSpell). Read from the rows,
// not the sheet modules, which reach this store.
function holds(sheetId: string, spell: string): boolean {
  const campaign = db().prepare(`SELECT campaign_id FROM character_sheets WHERE id = ?`).get(sheetId) as { campaign_id: string } | undefined;
  if (!campaign) {
    return false;
  }
  const rows = [
    ...(db().prepare(`SELECT condition_meta_json FROM character_sheets WHERE campaign_id = ?`).all(campaign.campaign_id) as Array<{ condition_meta_json: string | null }>),
    ...(db()
      .prepare(
        `SELECT e.condition_meta_json FROM encounter_enemies e JOIN encounters n ON n.id = e.encounter_id
         WHERE n.campaign_id = ? AND n.status = 'active'`,
      )
      .all(campaign.campaign_id) as Array<{ condition_meta_json: string | null }>),
  ];
  const key = textKey(spell);
  return rows.some((row) =>
    Object.values(parseJson<Record<string, MetaEntry>>(row.condition_meta_json, {})).some((entry) =>
      [entry, ...(entry?.others ?? [])].some((one) => one?.source === sheetId && typeof one.spell === "string" && textKey(one.spell) === key),
    ),
  );
}

const STORE: ItemCastStore = { read, write, turn: currentTurnId, holds };
globalThis.__odmItemCastStore = STORE;

// "Revert this turn" took back what the turn's use_item spent (the sheet's
// own revert) and what its spells did: a credit the turn wrote is for a cast
// that no longer happened, and goes; one a later turn's cast took is waiting
// again, since the item that paid for it stays spent.
export function forgetTurnItemCasts(campaignId: string, turnId: string) {
  const rows = db().prepare(`SELECT character_id, payload_json FROM item_cast_credits WHERE campaign_id = ?`).all(campaignId) as Array<{ character_id: string; payload_json: string }>;
  for (const row of rows) {
    const list = parseJson<ItemCastCredit[] | null>(row.payload_json, null) ?? [];
    const next = list
      .filter((credit) => credit.turnId !== turnId)
      .map((credit) => {
        if (credit.usedTurn !== turnId) return credit;
        const waiting = { ...credit };
        delete waiting.usedAt;
        delete waiting.usedTurn;
        delete waiting.running;
        return waiting;
      });
    if (JSON.stringify(next) !== JSON.stringify(list)) {
      write(row.character_id, next);
    }
  }
}

// A chapter rewound, or a table deleted: nothing it paid for is waiting.
export function forgetCampaignItemCasts(campaignId: string) {
  db().prepare(`DELETE FROM item_cast_credits WHERE campaign_id = ?`).run(campaignId);
}
