import type { ParsedToolCall } from "@/lib/dm/rolls";
import { cutSpans, findBareJsonObjects } from "@/lib/dm/tool-text";
import { argumentLinesAreCall, findArgumentLines, findFunctionCalls } from "@/lib/dm/written-calls";

// gpt-oss on vLLM sometimes writes a call into its reply as bare JSON instead
// of a structured tool call: just the arguments ('{"characterIds":[...],
// "prompt":"..."}'), alone or glued to the end of its prose, or the whole call
// ('{"name":"move_token","arguments":{...}}'). Players read the first kind
// verbatim, and a reply that was only the JSON closed the turn on the
// empty-turn line (PR #53). Like the bracket and XML salvages in rolls.ts,
// every such object is cut from the narration, and the ones that name a call
// unambiguously run as one: the named tool when it is offered, or else the one
// offered tool whose parameters take every key and whose required keys are
// all present. An object that fits no tool, or several, is cut and dropped.

type ToolShape = { name: string; properties: Set<string>; required: string[] };

function toolShapes(tools: unknown[]): Map<string, ToolShape> {
  const shapes = new Map<string, ToolShape>();
  for (const tool of tools) {
    const fn = (tool as { function?: { name?: unknown; parameters?: unknown } })?.function;
    if (!fn || typeof fn.name !== "string") {
      continue;
    }
    const parameters = (fn.parameters ?? {}) as { properties?: Record<string, unknown>; required?: unknown };
    shapes.set(fn.name, {
      name: fn.name,
      properties: new Set(Object.keys(parameters.properties ?? {})),
      required: Array.isArray(parameters.required) ? parameters.required.map(String) : [],
    });
  }
  return shapes;
}

function asArguments(value: unknown): Record<string, unknown> | null {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
}

function asToolCall(
  value: Record<string, unknown>,
  shapes: Map<string, ToolShape>,
): { name: string; args: Record<string, unknown> } | null {
  if (typeof value.name === "string" && shapes.has(value.name)) {
    const args = asArguments(value.arguments ?? value.parameters ?? {});
    if (args) {
      return { name: value.name, args };
    }
  }
  const keys = Object.keys(value);
  if (!keys.length) {
    return null;
  }
  const fits = [...shapes.values()].filter(
    (shape) => keys.every((key) => shape.properties.has(key)) && shape.required.every((key) => key in value),
  );
  return fits.length === 1 ? { name: fits[0].name, args: value } : null;
}

// The same for a call written as a function ("request_player_input(...)") or
// as argument lines ("characterIds: [...]" over "prompt: ..."), issue 1025:
// a named tool runs when it is offered, unnamed lines when they fit one tool
// alone, by the rule above. Every function form is cut, and every block of
// lines that is a call or holds what no story writes (written-calls.ts
// argumentLinesAreCall); a story's own "Note: ..." line stays.
export function salvageWrittenCalls(text: string, tools: unknown[]): { text: string; calls: ParsedToolCall[] } {
  if (!text) {
    return { text, calls: [] };
  }
  const shapes = toolShapes(tools);
  const calls: ParsedToolCall[] = [];
  const add = (call: { name: string; args: Record<string, unknown> } | null) => {
    if (call) {
      calls.push({ id: `text-salvaged-${calls.length}`, name: call.name, rawArguments: JSON.stringify(call.args) });
    }
  };
  const functions = findFunctionCalls(text);
  for (const written of functions) {
    add(written.args ? asToolCall({ name: written.tool, arguments: written.args }, shapes) : null);
  }
  const spoken = functions.length ? cutSpans(text, functions) : text;
  const cut = findArgumentLines(spoken).filter((block) => {
    const call = asToolCall(block.tool ? { name: block.tool, arguments: block.args } : block.args, shapes);
    add(call);
    return call !== null || argumentLinesAreCall(block);
  });
  return { text: cut.length ? cutSpans(spoken, cut) : spoken, calls };
}

export function salvageJsonToolCalls(
  text: string,
  tools: unknown[],
): { text: string; calls: ParsedToolCall[] } {
  if (!text || !text.includes("{")) {
    return { text, calls: [] };
  }
  // The structured story reply ({"storyText": ...}) is extractStoryText's.
  const objects = findBareJsonObjects(text).filter(
    (object) => !("storyText" in object.value) && !("story_text" in object.value),
  );
  if (!objects.length) {
    return { text, calls: [] };
  }
  const shapes = toolShapes(tools);
  const calls: ParsedToolCall[] = [];
  for (const object of objects) {
    const call = asToolCall(object.value, shapes);
    if (call) {
      calls.push({ id: `json-salvaged-${calls.length}`, name: call.name, rawArguments: JSON.stringify(call.args) });
    }
  }
  return { text: cutSpans(text, objects), calls };
}
