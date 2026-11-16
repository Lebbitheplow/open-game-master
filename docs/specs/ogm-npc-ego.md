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

## Open

- Whether the Ego should ask the voice again before choosing for it.
- Fear and pain as drives.
