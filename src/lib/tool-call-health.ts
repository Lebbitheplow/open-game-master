// Whether the GM's last model call that offered tools ran with them, for the
// admin text-model panel. A server that refuses function tools is asked
// again without them (src/lib/model-client.ts, toolsDropped): the turn then
// narrates with nothing rolled, moved or applied, and before this nothing
// said so outside the server log. Process memory only, as the speed notes
// are (src/lib/speed-status.ts); a restart starts it empty.
export type ToolCallHealth = {
  // The call was answered with its tools taken off.
  dropped: boolean;
  at: number;
};

const store = ((globalThis as { __odmToolCallHealth?: { last: ToolCallHealth | null } }).__odmToolCallHealth ??= { last: null });

export function noteToolCallHealth(dropped: boolean): void {
  store.last = { dropped, at: Date.now() };
}

export function toolCallHealth(): ToolCallHealth | null {
  return store.last;
}
