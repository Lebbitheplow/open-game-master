// What every card of the GM's monsters' hand shares (monster-hand.ts and
// monster-hand-legendary.ts): the enemy it is drawn for, its id key, a save's
// short word, and the fields an action card starts from. Pure.

import type { PublicEnemyActions } from "@/lib/dm/enemy-actions-view";

export type MonsterHandEnemy = {
  id: string;
  name: string;
  status: string;
  conditions: string[];
  actions?: PublicEnemyActions;
};

const SAVE_WORDS: Record<string, string> = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };

export function saveWord(code: string): string {
  return SAVE_WORDS[code.trim().toLowerCase()] ?? code.toUpperCase();
}

export function cardKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export const BASE = {
  cost: "action" as const,
  resource: "",
  condition: "",
  heals: false,
  compose: false,
};
