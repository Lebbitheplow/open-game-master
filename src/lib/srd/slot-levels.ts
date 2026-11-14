// Expended spell slots back, up to a number of slot levels ("regain expended
// slot levels equal to your INT modifier": Aether Capacitor, Aetheric
// Battery). The highest expended slot that still fits is
// taken first, then the next, so the levels are spent as a player spending
// them for the biggest slots would.
//
// Pure: the authored spend (src/lib/dm/authored-spend-effects.ts) writes it.
export type SlotTable = Record<string, { max: number; used: number }>;

export function regainSlotLevels(slots: SlotTable, levels: number): { slots: SlotTable; regained: number[] } {
  const next: SlotTable = Object.fromEntries(Object.entries(slots).map(([level, state]) => [level, { ...state }]));
  const regained: number[] = [];
  let left = Math.max(0, Math.floor(levels));
  const order = Object.keys(next).map(Number).filter((level) => level > 0).sort((a, b) => b - a);
  for (const level of order) {
    while (left >= level && next[String(level)].used > 0) {
      next[String(level)].used -= 1;
      left -= level;
      regained.push(level);
    }
  }
  return { slots: next, regained };
}
