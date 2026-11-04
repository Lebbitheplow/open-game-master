// The encounter tools the AI DM is offered, as the model reads them: their
// descriptions and argument schemas. Split from encounter-tools.ts, which
// offers them (encounterTools) and handles every call.

import { sceneIds } from "@/lib/ambience/catalog";
import { BUILDING_SIDES, MAX_OPENINGS } from "@/lib/battlemap/building";
import { GENDERS } from "@/lib/gender";
import { ENCOUNTER_OUTCOMES } from "@/lib/dm/encounter-logic";
import { waypointProperty } from "@/lib/dm/waypoint-logic";
import { ADVANTAGE_SOURCES } from "@/lib/dm/pc-attack-options";

export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const startEncounterTool: ToolDef = {
  type: "function",
  function: {
    name: "start_encounter",
    description:
      "Begin combat with real, server-tracked enemies. The server refuses more than 8 combatants, or a fight past the XP ceiling for this party and difficulty.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        enemies: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              monster: {
                type: "string",
                description: "Monster slug or name ('goblin', 'Gutter Punk').",
              },
              name: {
                type: "string",
                description: "In-world display name, to reskin one for this setting.",
              },
              count: { type: "integer", minimum: 1, maximum: 8 },
              cr: {
                type: "number",
                description:
                  "Only for an invented enemy with no matching monster: its challenge rating.",
              },
              returning: { type: "string", description: "An earlier fight's enemyId." },
              race: { type: "string", description: "A humanoid's people (elf, dwarf...), for their face." },
              gender: { type: "string", enum: [...GENDERS] },
            },
            required: ["monster"],
          },
        },
        summary: { type: "string", description: "One line on what this fight is." },
        absent: {
          type: "array",
          items: { type: "string" },
          description:
            "Too far to reach it in a few rounds, or unaware of it; behind a door is NOT absent. They roll no initiative and get no place in the order and no token until request_roll kind=initiative brings them in. Someone close but out of sight hears the fight, rolls initiative now and acts on their own turn. Omit it when everyone is near.",
        },
        ambush: {
          type: "string",
          enum: ["enemies", "party"],
          description:
            "Who lay hidden in wait: 'enemies' when they jump the party, 'party' when it springs the trap. Those surprised lose their first turn.",
        },
        surprised: {
          type: "string",
          enum: ["none", "enemies", "party"],
          description:
            "A whole side the story already caught off guard, overriding ambush. Default: 'none'.",
        },
        scene: {
          type: "string",
          enum: sceneIds(),
          description:
            "The map's ground, if not the place's own. Such as the road outside town for an ambush. Omit it and the map follows the place.",
        },
        distanceFeet: {
          type: "integer",
          minimum: 5,
          description:
            "Feet to the nearest enemy at the start, when the story says. 5 for a foe at arm's length, 10 for one two paces off, 30 across a room. The battle map places them there, or as far off as it holds and the result says so. Omit it and an ambush or a fight indoors opens 30 feet apart, anything else across the field.",
        },
        lair: {
          type: "boolean",
          description: "True in a legendary creature's lair. The lair then acts on initiative 20 (lair_action).",
        },
        from: {
          type: "string",
          enum: ["ahead", "behind"],
          description:
            "Against the travel formation: 'ahead' (the default) or 'behind'. The formation (GAME STATE) only places the party, with no surprise or bonus: ahead puts its front nearest them, behind its rear.",
        },
        building: {
          type: "object",
          description:
            "Party inside a building, enemies outside on enemySide. A besieged house, a barricaded inn: the door faces them. The board draws it on the outdoor ground of scene, or on open ground if the place itself is indoors or underground; a scene that is indoors or underground is refused. Enemies open 30 feet from the party unless distanceFeet says, and the result says how far when a wall keeps them farther.",
          properties: {
            enemySide: { type: "string", enum: [...BUILDING_SIDES] },
            openings: {
              type: "integer",
              maximum: MAX_OPENINGS,
              description: "A door, then windows. At least 1. Default: 2. A window is seen and shot through, and only a flier or a jump crosses it.",
            },
          },
          required: ["enemySide"],
        },
      },
      required: ["enemies"],
    },
  },
};

export const enemyAttackTool: ToolDef = {
  type: "function",
  function: {
    name: "enemy_attack",
    description:
      "Resolve an enemy's attack on a character, on the enemy's own turn: once end_turn hands it to you (or it acts first in the round); before its turn comes it only reacts or takes a legendary action. The server rolls it from the enemy's stat block against the target's real AC, applies the damage, and reads what bears on the roll (conditions, light, Pack Tactics, Sanctuary). Never invent an enemy's numbers or use request_roll for enemy attacks.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        enemyId: { type: "string", description: "Exact enemyId from GAME STATE." },
        targetCharacterId: {
          type: "string",
          description: "Exact characterId from GAME STATE.",
        },
        attack: {
          type: "string",
          description: "Attack name from the enemy's attack list. Default: its Multiattack routine, or its first attack.",
        },
        advantage: {
          type: "string",
          enum: ["none", "advantage", "disadvantage"],
          description: "Situational advantage the server cannot see: needs advantageSource 'other' and advantageReason. Conditions, light, cover, range, flanking, spells and Pack Tactics are the server's already.",
        },
        advantageSource: {
          type: "string",
          enum: [...ADVANTAGE_SOURCES],
          description:
            "Where the advantage or disadvantage comes from; only 'other' counts.",
        },
        advantageReason: { type: "string", description: "The circumstance behind advantage, in a few words." },
        nonlethal: {
          type: "boolean",
          description: "Melee, to take them alive: dropped to 0 HP they are stable, not dying.",
        },
        targetMount: { type: "boolean", description: "At the target's mount instead." },
      },
      required: ["enemyId", "targetCharacterId"],
    },
  },
};

export const endEncounterTool: ToolDef = {
  type: "function",
  function: {
    name: "end_encounter",
    description:
      "End the active encounter when it resolves any way other than every enemy dying: flight, surrender, parley, or party defeat. Victory by killing every enemy ends automatically.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...waypointProperty,
        outcome: { type: "string", enum: [...ENCOUNTER_OUTCOMES] },
        reason: { type: "string", description: "Short in-fiction cause." },
      },
      required: ["outcome"],
    },
  },
};

export const endTurnTool: ToolDef = {
  type: "function",
  function: {
    name: "end_turn",
    description:
      "Mark the current character's combat turn as complete. THIS is what advances the initiative: an attack alone never ends a turn, because the character may still have movement or a bonus action. Call it when the player has spent or declined the rest of their turn (or their whole declared turn is resolved). The server advances the initiative after your narration and posts a note naming the next turn. Never announce whose turn is next yourself.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: "Exact characterId from GAME STATE." },
      },
      required: ["characterId"],
    },
  },
};
