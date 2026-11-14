import { randomInt, randomUUID } from "node:crypto";
import { getDatabase, nowIso } from "@/lib/db/core";

// Seats from which someone outside the table plays a first-tier mind
// through their own agent (docs/specs/ogm-mind-seats.md). The lead creates a
// seat without naming anyone, so making one reveals nothing; the server
// gives a claimed seat to the first mind that needs one.

export type MindSeat = {
  id: string;
  campaignId: string;
  code: string;
  userId: string;
  npcId: string;
  createdAt: string;
  claimedAt: string;
};

type SeatRow = {
  id: string;
  campaign_id: string;
  code: string;
  user_id: string;
  npc_id: string;
  created_at: string;
  claimed_at: string;
};

// Seats a table may have at once: as many as the minds it can hold
// (four key characters and the companions).
export const MAX_MIND_SEATS = 8;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function toSeat(row: SeatRow): MindSeat {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    code: row.code,
    userId: row.user_id,
    npcId: row.npc_id,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
  };
}

export function listMindSeats(campaignId: string): MindSeat[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM mind_seats WHERE campaign_id = ? ORDER BY created_at, id`)
    .all(campaignId) as SeatRow[];
  return rows.map(toSeat);
}

export function createMindSeat(campaignId: string): MindSeat | null {
  if (listMindSeats(campaignId).length >= MAX_MIND_SEATS) {
    return null;
  }
  const db = getDatabase();
  // The loop covers the UNIQUE code; a collision in 32^10 is a curiosity.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = Array.from({ length: 10 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    const id = randomUUID();
    try {
      db.prepare(`INSERT INTO mind_seats (id, campaign_id, code, created_at) VALUES (?, ?, ?, ?)`).run(id, campaignId, code, nowIso());
    } catch {
      continue;
    }
    return listMindSeats(campaignId).find((seat) => seat.id === id) ?? null;
  }
  return null;
}

// Claims a free seat by its code. A seat already held by someone else is
// refused; claiming one's own seat again is harmless.
export function claimMindSeat(code: string, userId: string): { seat: MindSeat } | { error: string } {
  const row = getDatabase().prepare(`SELECT * FROM mind_seats WHERE code = ?`).get(code.trim().toUpperCase()) as SeatRow | undefined;
  if (!row) {
    return { error: "No seat has that code." };
  }
  if (row.user_id && row.user_id !== userId) {
    return { error: "Someone else already holds that seat." };
  }
  if (!row.user_id) {
    getDatabase().prepare(`UPDATE mind_seats SET user_id = ?, claimed_at = ? WHERE id = ?`).run(userId, nowIso(), row.id);
  }
  return { seat: toSeat({ ...row, user_id: userId }) };
}

export function releaseMindSeat(campaignId: string, seatId: string): boolean {
  return getDatabase().prepare(`DELETE FROM mind_seats WHERE campaign_id = ? AND id = ?`).run(campaignId, seatId).changes > 0;
}

// The claimed seat playing this mind, giving it the oldest free claimed seat
// when it has none. The server picks, never the seat's holder, so no one
// learns from the choice who matters in the story.
export function seatForMind(campaignId: string, npcId: string): MindSeat | null {
  const seats = listMindSeats(campaignId);
  const held = seats.find((seat) => seat.npcId === npcId && seat.userId);
  if (held) {
    return held;
  }
  const free = seats.find((seat) => seat.userId && !seat.npcId);
  if (!free) {
    return null;
  }
  getDatabase().prepare(`UPDATE mind_seats SET npc_id = ? WHERE id = ? AND npc_id = ''`).run(npcId, free.id);
  return { ...free, npcId };
}

export function seatsHeldBy(userId: string): MindSeat[] {
  const rows = getDatabase().prepare(`SELECT * FROM mind_seats WHERE user_id = ? ORDER BY created_at`).all(userId) as SeatRow[];
  return rows.map(toSeat);
}
