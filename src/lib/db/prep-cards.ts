import { getDatabase, nowIso } from "@/lib/db/core";
import { normalizePrepRole, type PrepCard, type PrepRole } from "@/lib/dm/prep-logic";

// The prep cards a campaign keeps from the storyboards imported into it
// (issues #301 and #302): every card whole, under the id it had on the
// board. The arc's beats and planned events carry a line each and point back
// here by card id, which is what lets a prompt stay bounded while nothing an
// author wrote is lost. See src/lib/dm/prep-logic.ts for the pure half.

type Row = {
  id: string;
  campaign_id: string;
  card_id: string;
  source_id: string;
  source_title: string;
  kind: string;
  title: string;
  body: string;
  cues: string;
  trigger: string;
  role: string;
  created_at: string;
  updated_at: string;
};

const COLUMNS = "id, campaign_id, card_id, source_id, source_title, kind, title, body, cues, trigger, role, created_at, updated_at";

function mapRow(row: Row): PrepCard {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    cardId: row.card_id,
    sourceId: row.source_id,
    sourceTitle: row.source_title,
    kind: row.kind,
    title: row.title,
    body: row.body,
    cues: row.cues,
    trigger: row.trigger,
    role: normalizePrepRole(row.role),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type PrepCardInput = {
  cardId: string;
  sourceId: string;
  sourceTitle: string;
  kind: string;
  title: string;
  body: string;
  cues?: string;
  trigger?: string;
  role: PrepRole;
};

// Writes or updates the campaign's copy of each card. A card imported again
// keeps its row (and the arc's references to it) and takes the board's
// latest words.
export function upsertPrepCards(campaignId: string, cards: PrepCardInput[]): number {
  if (!cards.length) {
    return 0;
  }
  const db = getDatabase();
  const now = nowIso();
  const statement = db.prepare(
    `INSERT INTO campaign_prep_cards
       (id, campaign_id, card_id, source_id, source_title, kind, title, body, cues, trigger, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (campaign_id, card_id) DO UPDATE SET
       source_id = excluded.source_id, source_title = excluded.source_title, kind = excluded.kind,
       title = excluded.title, body = excluded.body, cues = excluded.cues, trigger = excluded.trigger,
       role = excluded.role, updated_at = excluded.updated_at`,
  );
  const write = db.transaction((rows: PrepCardInput[]) => {
    for (const card of rows) {
      statement.run(
        crypto.randomUUID(),
        campaignId,
        card.cardId,
        card.sourceId,
        card.sourceTitle,
        card.kind,
        card.title,
        card.body,
        card.cues ?? "",
        card.trigger ?? "",
        card.role,
        now,
        now,
      );
    }
  });
  write(cards);
  // A first card puts read_card on the narrator's tool list (issue 942,
  // src/lib/dm/turn-warmup.ts scheduleNextTurnCheck).
  globalThis.__odmTurnHeadHook?.(campaignId);
  return cards.length;
}

export function listPrepCards(campaignId: string): PrepCard[] {
  return (
    getDatabase()
      .prepare(`SELECT ${COLUMNS} FROM campaign_prep_cards WHERE campaign_id = ? ORDER BY created_at, rowid`)
      .all(campaignId) as Row[]
  ).map(mapRow);
}

export function countPrepCards(campaignId: string): number {
  const row = getDatabase().prepare(`SELECT COUNT(*) AS n FROM campaign_prep_cards WHERE campaign_id = ?`).get(campaignId) as { n: number };
  return row.n;
}

// A campaign clone carries the arc (src/lib/db/campaign-clone.ts), so it
// carries the cards the arc's lines point at, under fresh row ids and the
// same card ids.
export function copyPrepCards(fromCampaignId: string, toCampaignId: string): number {
  const cards = listPrepCards(fromCampaignId);
  return upsertPrepCards(
    toCampaignId,
    cards.map((card) => ({
      cardId: card.cardId,
      sourceId: card.sourceId,
      sourceTitle: card.sourceTitle,
      kind: card.kind,
      title: card.title,
      body: card.body,
      cues: card.cues,
      trigger: card.trigger,
      role: card.role,
    })),
  );
}
