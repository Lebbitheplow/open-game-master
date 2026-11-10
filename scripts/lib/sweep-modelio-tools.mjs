// What the modelio sweep suites share: every tool definition a model can be
// handed, by profile and by door, and a walker over a tool's JSON Schema.
//
// Import scripts/lib/enforce-world.mjs first (it points the database at a
// scratch directory), then:
//
//   const universe = await toolUniverse(world);
//   universe.sets          [{ id, door, tools: [{ type, function }] }]
//   universe.byName        Map(name -> the full definition)
//   universe.mcp           [{ id, tools: [{ name, description, inputSchema }] }]
//
// Nothing here is a list of tool names: each set is what the turn's own
// builders return (src/lib/dm/turn.ts dmTurnTools, compactTurnTools,
// dmTurnToolCatalogue; src/lib/harness/render.ts toMcpTools;
// src/lib/agents/workbench.ts workbenchTools), with every gate a table can
// open switched on, so a tool added next month is walked the day it lands.

// A campaign with every gated family on: world simulation (settlements),
// ambience, companions, relationships and romance.
export function everythingOn(campaign) {
  return {
    ...campaign,
    storyArc: campaign.storyArc ?? { title: "Arc", beats: [] },
    gameSettings: {
      ...campaign.gameSettings,
      worldSimulation: true,
      ambienceEnabled: true,
      companions: "full",
      relationships: "on",
      romance: "on",
    },
  };
}

export async function toolUniverse(world) {
  const turn = await import("../../src/lib/dm/turn.ts");
  const profiles = await import("../../src/lib/dm/tool-profiles.ts");
  const prompt = await import("../../src/lib/dm/prompt.ts");
  const { readCardTool } = await import("../../src/lib/dm/prep-card-tool.ts");
  const { runPreparedEncounterTool } = await import("../../src/lib/dm/prepared-encounter-tool.ts");
  const { actionTools } = await import("../../src/lib/dm/action-tools.ts");
  const { toMcpTools } = await import("../../src/lib/harness/render.ts");
  const { workbenchTools } = await import("../../src/lib/agents/workbench.ts");

  const campaign = everythingOn(world.campaign());
  // The tools that wait on table state the scratch world does not hold (a
  // place to stand, prep cards, a prepared fight, a party that slows a fall):
  // taken from their own exports, so they are walked all the same.
  const waiting = [
    prompt.movePartyTool,
    prompt.firstMovePartyTool,
    prompt.recallStoryTool,
    prompt.completeBeatTool,
    readCardTool,
    runPreparedEncounterTool,
    ...actionTools.filter((tool) => tool.function.name === "use_reaction"),
  ].filter(Boolean);

  const sets = [];
  for (const lean of [false, true]) {
    for (const fight of [false, true]) {
      sets.push({
        id: `${lean ? "lean" : "full"}/${fight ? "fight" : "explore"}`,
        door: "chat",
        profile: lean ? "lean" : "full",
        fight,
        tools: turn.dmTurnTools(campaign, fight, true, lean),
      });
    }
  }
  sets.push({ id: "full/waiting", door: "chat", profile: "full", fight: false, tools: waiting });

  // The compact profile: every tool cut as compactTool cuts it, with
  // more_tools naming every group; and the set a call really offers for a
  // quiet table and for a fight (compactTurnTools).
  const allFull = new Map();
  for (const set of sets) {
    for (const tool of set.tools) {
      // The first definition met wins, as toMcpTools keeps it.
      if (!allFull.has(tool.function.name)) allFull.set(tool.function.name, tool);
    }
  }
  const moreTools = profiles.moreToolsTool(Object.keys(profiles.TOOL_GROUPS));
  sets.push({
    id: "compact/every-tool",
    door: "chat",
    profile: "compact",
    fight: false,
    tools: [...[...allFull.values()].map((tool) => profiles.compactTool(tool)), moreTools],
  });
  for (const fight of [false, true]) {
    const signals = { inEncounter: fight, caster: true };
    sets.push({
      id: `compact/${fight ? "fight" : "explore"}`,
      door: "chat",
      profile: "compact",
      fight,
      tools: turn.compactTurnTools(campaign, fight, true, signals, []).tools,
    });
  }
  allFull.set(moreTools.function.name, moreTools);

  // The agent program's door: the whole catalogue as MCP definitions.
  const mcp = [
    { id: "mcp/catalogue-full", tools: toMcpTools([...turn.dmTurnToolCatalogue(campaign, true, false), ...waiting]) },
    { id: "mcp/catalogue-lean", tools: toMcpTools(turn.dmTurnToolCatalogue(campaign, true, true)) },
    {
      id: "mcp/workbench",
      tools: workbenchTools({
        id: "sweep",
        userId: world.owner.id,
        name: "sweep",
        scopes: ["read", "play", "campaigns", "characters", "dm"],
        campaignId: world.campaignId,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        lastUsedAt: null,
        revokedAt: null,
      }),
    },
  ];

  return { campaign, sets, mcp, byName: allFull };
}

// Every schema node of a tool's parameters, depth first: the root, each
// property, each list's items, each branch of a union. visit(node, path,
// parent) where path reads "pc_attack.attacks[].weapon".
export function walkSchema(schema, path, visit, parent = null) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    visit(schema, path, parent);
    return;
  }
  visit(schema, path, parent);
  if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
    for (const [key, child] of Object.entries(schema.properties)) {
      walkSchema(child, `${path}.${key}`, visit, schema);
    }
  }
  if (schema.items !== undefined) {
    if (Array.isArray(schema.items)) {
      schema.items.forEach((child, index) => walkSchema(child, `${path}[${index}]`, visit, schema));
    } else {
      walkSchema(schema.items, `${path}[]`, visit, schema);
    }
  }
  for (const union of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(schema[union])) {
      schema[union].forEach((child, index) => walkSchema(child, `${path}<${union}${index}>`, visit, schema));
    }
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    walkSchema(schema.additionalProperties, `${path}{}`, visit, schema);
  }
}

// One shape for a chat tool and an MCP tool: { name, description, parameters }.
export function toolShape(tool) {
  return tool.function
    ? { name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters }
    : { name: tool.name, description: tool.description, parameters: tool.inputSchema };
}

// The strictest readers' rules, one code each. Returns [{ code, path, say }]
// for one tool. Each rule names the reader that refuses the shape:
//
//   array-items       llama.cpp's gpt-oss template reads param_spec['items']
//                     for every array; without the key the lookup returns
//                     the dict's method and the render throws (0.32.0, #861).
//   object-properties Gemini refuses an OBJECT with no properties ("should be
//                     non-empty for OBJECT type"); OpenAI strict wants every
//                     object closed.
//   node-type         Gemini and the Gemma template (value['type'] | upper)
//                     read a type on every node.
//   type-list         a type written as a list is a union those readers do
//                     not take.
//   enum-empty        every reader refuses an enum with no values.
//   enum-type         an enum value of another type than the node's.
//   enum-duplicate    OpenAI refuses a repeated enum value.
//   required-missing  a required name that is no property: OpenAI answers 400
//                     ("required is required to be supplied and to be an
//                     array including every key in properties" in strict;
//                     Anthropic and Gemini refuse the unknown name).
//   required-shape    required that is not a list of strings.
//   default-type      a default of another type than the node's (gpt-oss
//                     concatenates an enum's default to a string).
//   bounds            minimum over maximum, minItems over maxItems.
//   tuple-items       items as a list (a tuple), which the templates index
//                     as a mapping.
//   name              a tool or property name outside ^[a-zA-Z0-9_-]{1,64}$.
//   no-description    a tool with no description (gpt-oss: "// " + undefined).
export function lintTool(tool) {
  const { name, description, parameters } = toolShape(tool);
  const issues = [];
  const add = (code, path, say) => issues.push({ code, path, say });
  if (typeof name !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) add("name", String(name), `tool name ${JSON.stringify(name)}`);
  if (typeof description !== "string" || !description.trim()) add("no-description", name, "the tool has no description");
  if (!parameters || typeof parameters !== "object") {
    add("object-properties", name, "the tool has no parameters object");
    return issues;
  }
  if (parameters.type !== "object") add("node-type", name, `the root's type is ${JSON.stringify(parameters.type)}`);
  walkSchema(parameters, name, (node, path, parent) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      add("node-type", path, `a schema node that is ${JSON.stringify(node)}`);
      return;
    }
    const union = ["anyOf", "oneOf", "allOf"].some((key) => Array.isArray(node[key]));
    if (Array.isArray(node.type)) {
      add("type-list", path, `type ${JSON.stringify(node.type)}`);
    } else if (typeof node.type !== "string" && !union) {
      add("node-type", path, `no type (keys: ${Object.keys(node).join(", ") || "none"})`);
    }
    if (node.type === "array") {
      if (node.items === undefined) add("array-items", path, "an array with no items");
      else if (Array.isArray(node.items)) add("tuple-items", path, "items is a list");
      else if (!node.items || typeof node.items !== "object") add("array-items", path, `items is ${JSON.stringify(node.items)}`);
    }
    if (node.type === "object") {
      // An object open by declaration (additionalProperties true) says so to
      // its reader: a whole sheet and odm_dm_invoke's args stay open, their
      // route's schema the contract (maintainer decision R13,
      // /tmp/odm-gapstudy/WAVE1.md: "sheet and args stay open objects with
      // additionalProperties true").
      const open = node.additionalProperties === true || (node.additionalProperties && typeof node.additionalProperties === "object");
      if (!node.properties || typeof node.properties !== "object" || Array.isArray(node.properties)) {
        if (!open) add("object-properties", path, "an object with no properties");
      } else if (!Object.keys(node.properties).length && node !== parameters && !open) {
        add("object-properties", path, "an object whose properties are empty");
      }
      for (const key of Object.keys(node.properties ?? {})) {
        if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(key)) add("name", `${path}.${key}`, `property name ${JSON.stringify(key)}`);
      }
    }
    if (node.required !== undefined) {
      if (!Array.isArray(node.required) || node.required.some((entry) => typeof entry !== "string")) {
        add("required-shape", path, `required is ${JSON.stringify(node.required)}`);
      } else {
        const known = Object.keys(node.properties ?? {});
        for (const entry of node.required) {
          if (!known.includes(entry)) add("required-missing", path, `required names "${entry}", which is no property`);
        }
        if (new Set(node.required).size !== node.required.length) add("required-shape", path, "required repeats a name");
      }
    }
    if (node.enum !== undefined) {
      if (!Array.isArray(node.enum) || !node.enum.length) {
        add("enum-empty", path, `enum is ${JSON.stringify(node.enum)}`);
      } else {
        if (new Set(node.enum.map((value) => JSON.stringify(value))).size !== node.enum.length) add("enum-duplicate", path, "enum repeats a value");
        const wrong = node.enum.filter((value) => !fitsType(value, node.type));
        if (wrong.length) add("enum-type", path, `enum values ${JSON.stringify(wrong)} are not ${node.type}`);
      }
    }
    if (node.default !== undefined) {
      if (!fitsType(node.default, node.type)) add("default-type", path, `default ${JSON.stringify(node.default)} is not ${node.type}`);
      if (Array.isArray(node.enum) && !node.enum.includes(node.default)) add("default-type", path, `default ${JSON.stringify(node.default)} is not in the enum`);
    }
    if (typeof node.minimum === "number" && typeof node.maximum === "number" && node.minimum > node.maximum) add("bounds", path, `minimum ${node.minimum} over maximum ${node.maximum}`);
    if (typeof node.minItems === "number" && typeof node.maxItems === "number" && node.minItems > node.maxItems) add("bounds", path, `minItems ${node.minItems} over maxItems ${node.maxItems}`);
    if (typeof node.minLength === "number" && typeof node.maxLength === "number" && node.minLength > node.maxLength) add("bounds", path, `minLength ${node.minLength} over maxLength ${node.maxLength}`);
    void parent;
  });
  return issues;
}

function fitsType(value, type) {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    default:
      return true;
  }
}

// Every JSON Schema keyword a tool uses, with how often.
export function keywordCensus(tools) {
  const census = new Map();
  for (const tool of tools) {
    const { name, parameters } = toolShape(tool);
    walkSchema(parameters, name, (node) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) return;
      for (const key of Object.keys(node)) {
        census.set(key, (census.get(key) ?? 0) + 1);
      }
    });
  }
  return census;
}
