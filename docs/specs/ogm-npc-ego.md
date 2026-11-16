# NPC minds: drive, voice, Ego

Status: experiment (the raft sandbox, 2026-11-16). It may fail; the aim is
characters worth watching.

## Problem

A small uncensored model alone plays a voice well and decides badly. Seven
minds on Gemma 4 12B, forty hours without water beside a full barrel, stroked
a ring, clenched a key and spoke of hunger for three turns. Nobody asked,
bargained, stole or struck.

## Shape

| Part | Who | What it does |
| --- | --- | --- |
| Senses | server | What is here, what the mind carries, its body, what it did last. |
| Drive (Es) | server, numbers | `dominantDrive`: thirst fills in 60 hours, hunger in 120. Above 40 it is named; from 60 it cannot wait. Below that the character's own want leads. |
| Voice | the character's model | Free text in character: SAY, DO, THINK, LYING. |
| Nature (Super-io) | the NPC's record | Role, trait, temperament: what they would and would not do. |
| Ego | the narrator's model | Reads the impulse and returns one real action with a target. A gesture or a repeated deed is not an action: the Ego then chooses the step this character would take toward the drive, within its nature, using only what the ground holds. |
| Engine | server | Resolves the action with rules and dice; the result is what the mind perceives next. |

## Rules

- The Ego never rewrites the spoken words.
- The Ego never softens: theft, threats and blows stand.
- Another's thing reaches the Ego only if the mind has seen or heard of it
  (`knowsOfThing`): a hidden vial stays hidden.
- An intent that repeats one of the last four deeds is refused once
  (`repeatsDeed`) and asked again.
- A reply already in the engine's JSON (a mind seat, a JSON-native model)
  stands as it is.
- Lives off screen are only transcribed: no ground, no choosing.

## The stage (`gameSettings.npcStage`, off by default)

One narrator doing everything chose two or three of seven minds a turn, wrote
their senses itself, and left their actions "about to happen". At a staged
table the work is split, and the server holds the order:

| Role | Who | Task |
| --- | --- | --- |
| Players' referee | the narrator, as before | Resolves the players' action with the engine's tools and narrates it. |
| Director | server | After that, every first-tier mind in the scene takes a turn. Their voices and Egos run side by side on the same moment; the referee then rules on them one by one, in an order that rotates. What the others did reaches a mind next turn. |
| Senses | server | What the table was just told; the referee also sees how each earlier action of this moment ended. |
| Voice, Ego | as above | |
| Referee | the narrator's model, one small prompt | Says whether the action is uncertain, its DC and modifier, and both outcomes. The server rolls the d20 and picks the branch. Never kills. |
| Record | server | Drank, ate, things gained and lost, wounded or unconscious, written to the NPC's sheet. |
| Narrator | the narrator | Handed the facts in order: tells them, changes and omits none. |

An action aimed at a hero is not judged by the referee: it reaches the
narrator as an attempt to resolve with the engine's tools. A fight keeps the
old flow. The stage does not run while an encounter is active.

## Open


- Whether the Ego should ask the voice again before choosing for it.
- Fear and pain as drives.

## Local models

The voices run on llama.cpp with Metal (`llama-server --parallel 4
--reasoning-budget 0`), reached as the table's `custom` utility endpoint, so
several minds are served at once. Gemma 4 thinks before answering unless its
reasoning is switched off, and then spends its whole budget on the thought.
