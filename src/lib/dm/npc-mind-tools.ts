// The narrator's three doors into the NPC minds (src/lib/dm/npc-mind.ts),
// offered only at a table that has them (gameSettings.npcMinds).

export const NPC_MIND_TOOL_NAMES = ["npc_speak", "npc_inform", "npc_past", "npc_hear"] as const;

export const npcMindTools = [
  {
    type: "function",
    function: {
      name: "npc_speak",
      description:
        "Give a first-tier character (a party companion, or an NPC the roster marks first tier) their turn, as you would a player: their own mind says what they say and try to do. Call it BEFORE giving them any words or decision, and voice exactly what it returns. Second-tier NPCs are refused: you voice them yourself. Their mind knows only what they have perceived or been told, so give `perceives` as what they directly see and hear now (the heroes' words verbatim), never facts they could not perceive.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "The NPC or companion who answers." },
          perceives: { type: "string", description: "What they see and hear at this moment, in plain words; quote what was said to them. The scene, not your verdict on it: no rulings on what is proven or unproven, no hint at how they should answer." },
          alsoPresent: {
            type: "array",
            items: { type: "string" },
            description: "Other tracked NPCs in the scene who perceive the same moment and hear the answer.",
          },
          away: {
            type: "boolean",
            description: "True to cut to them where they are, apart from the party (left behind, or gone their own way): they catch up on the time apart and answer there, without the heroes. Leave it out once they are back with the party: a companion who was apart then catches up and rejoins.",
          },
          place: { type: "string", description: "With away: where they are, when the roster does not already say." },
        },
        required: ["name", "perceives"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "npc_inform",
      description:
        "Record what an NPC of either tier learns from someone: news by messenger, letter or gossip, or an introduction (the source is whoever introduced themselves). They learn it now, from that source, as something they were told (it may be false). Call it only when the story actually brings it to them.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "The NPC who learns it." },
          source: { type: "string", description: "Who or what told them (a name, 'a courier', 'a rumour')." },
          news: { type: "string", description: "What they are told, as it was told." },
          witnessed: { type: "boolean", description: "True only if they saw it happen themselves." },
        },
        required: ["name", "source", "news"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "npc_hear",
      description:
        "Words said aloud in the scene (by a character you voice, or by a hero) reach the tracked NPCs around only as far as they could hear them. For each listener say how far: near (heard for sure), far (across the room, a weak voice, noise: their Perception decides against dc, rolled in secret) or out_of_earshot. Those who hear remember the words verbatim; the rest know at most that someone spoke. Not for a first-tier character you are about to give a turn with npc_speak: put the words in their perceives instead.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          speaker: { type: "string", description: "Who spoke." },
          words: { type: "string", description: "Their words, verbatim." },
          place: { type: "string", description: "Where it was said." },
          listeners: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string", description: "A tracked NPC nearby." },
                reach: { type: "string", enum: ["near", "far", "out_of_earshot"] },
                dc: { type: "integer", description: "With far: how hard to make out (10 easy, 13 a weak voice across a room, 15 whispered or through rain and walls). Default 13." },
                listening: { type: "boolean", description: "With far: true if they are listening on purpose (a roll instead of passive Perception)." },
              },
              required: ["name", "reach"],
            },
          },
        },
        required: ["speaker", "words", "listeners"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "npc_past",
      description:
        "Set a new NPC's past and the figure whose manner inspires them, before they first speak or act, and their tier at any point of the story. A past cannot be added once they have lived part of the story. The inspiration lends temperament and voice only, never that figure's names, world or powers.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "The NPC." },
          inspiration: { type: "string", description: "A figure whose manner they borrow, e.g. 'a scheming dark lord' or a famous character." },
          past: { type: "array", items: { type: "string" }, description: "Facts of their life before play that they remember." },
          firstTier: {
            type: "boolean",
            description: "True for a character the story hinges on (the prisoner, the rival, the patron, the one hiding the secret): they get their own mind and play like a player. At most as many as the table allows besides the party's companions (the rules say how many). Set it whenever the story makes someone matter; false gives them back to you when their part is over.",
          },
        },
        required: ["name"],
      },
    },
  },
] as const;

// What the narrator is told at a table with minds.
export const NPC_MINDS_RULES =
  "NPC tiers: first-tier characters (party companions, and NPCs the roster marks first tier) are played by their own minds, like players at the table: whenever one is in the scene, give them a turn with npc_speak after the players act and before you narrate the outcome. When time passes over the scene (take_rest, pass_time, travel, downtime), each first-tier character on stage lives that stretch too: call npc_speak telling them how long passes and what goes on around them, and narrate the stretch from what they choose, never deciding it for them. Second-tier NPCs (everyone else) you voice yourself, from their personality and only what the roster says they learned; they know a hero's name only once the roster lists it. " +
  "A first-tier mind knows only what they perceived or were told: call npc_speak with what they perceive right now, then voice exactly what it returns; never write their lines yourself. Write perceives as the moment itself, the way a player at the table hears it: where they are, what happens, what is said to them word for word. Never add your own rulings on it ('its authenticity is unverified', 'it was not stated who signed it') or tell them how to answer ('answer from what you know and want to reveal'): weighing what they heard, and choosing how to answer, is theirs. Words said aloud reach only those who could hear them: when a character you voice or a hero speaks with tracked NPCs around who are not the ones answering, call npc_hear with each listener's distance (near, far or out_of_earshot), never deciding yourself that someone far off heard; whatever it says, they know only that. Never give an NPC of either tier knowledge they have no source for: news reaches someone absent only through npc_inform, from a named source. Lay down a new NPC's past with npc_past before they first act; never invent a past relationship later. Their intent is an attempt: resolve it with the engine's tools. " +
  "A first-tier character apart from the party (left behind when it split) is still a player: when the story cuts to them, or reaches anyone from where they are, call npc_speak with away: true; when the party is back with them, call it without away and they rejoin. Either way they first live the time apart on the engine's dice: apply what they did to others with your usual tools before narrating. " +
  "In a fight, a first-tier companion nobody at the table commands chooses its own turn: when the initiative reaches it, call npc_speak first (the server gives it its own sheet and the fight as it sees it), then carry out exactly the intent it returns with the combat tools and end_turn; the server refuses that companion's actions until its mind has chosen. " +
  "The few characters the story hinges on (whoever holds its secret, a prisoner, a rival, a patron) deserve their own minds: when one first appears, set them up with set_npc, then npc_past with their past and firstTier: true, before they first speak. Tiers follow the story: when a second-tier character grows into one the story hinges on (they become an ally at the heroes' side, a rival, the keeper of a lead), promote them with npc_past and firstTier: true alone (no past: they keep what they lived, and remember what you had them say); when a first-tier character's part is over (they leave the story for good, or it no longer turns on them), give them back to you with firstTier: false, which frees their place. " +
  "Every character in the world, first tier or second, friend or foe, wants above all to stay alive; their other goals come after. Play the foes and NPCs you voice that way: a thinking creature that is badly hurt, outnumbered or clearly losing retreats, hides, surrenders, bargains or flees (enemy_flees for one, end_encounter for a surrender or a rout) instead of fighting to the death. Only the mindless, the compelled, the cornered with no way out, or a nature that truly demands it (a zealot, a guardian bound to its post) fight on to the end.";
