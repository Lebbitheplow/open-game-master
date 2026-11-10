"use client";

import { TriangleAlert } from "lucide-react";
import type { ToolCallHealth } from "@/lib/tool-call-health";

// The text model's health line (a server that refuses function tools
// is asked again without them, src/lib/model-client.ts toolsDropped): shown
// only when the GM's last call ran without its tools, so the admin learns why
// the GM narrated and rolled nothing. Nothing to choose, so no control.
export function ToolsDroppedLine({ health }: { health: ToolCallHealth | null }) {
  if (!health?.dropped) {
    return null;
  }
  const when = new Date(health.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <p role="status" className="mt-3 flex items-start gap-1.5 text-xs text-amber-200" data-tools-dropped>
      <TriangleAlert className="mt-px size-3.5 shrink-0 text-amber-300" aria-hidden="true" />
      <span>
        The GM&apos;s last turn ({when}) ran without its tools: the model server refused them, so nothing was rolled,
        moved or applied. Turn on tool calling on that server (for llama.cpp&apos;s llama-server, start it with --jinja).
      </span>
    </p>
  );
}
