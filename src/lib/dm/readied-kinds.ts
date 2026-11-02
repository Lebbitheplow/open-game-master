// What a Ready can hold, shared by the engine, the DM prompt, the Hand and
// the console (no database here: the Hand's play logic runs in the browser).
//
// SRD 5.1, Ready: "you choose the action you will take in response to that
// trigger, or you choose to move up to your speed in response to it." Ready
// commits to one action, and the release is that action and no other, off
// the character's turn, with their reaction. Until issue 264 the engine held
// a readied attack (or spell) only; every other readied action was accepted
// on the turn and refused when its trigger came.
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";

export const READIED = "readied";

// The actions take_action ready may hold, as `readied`. A spell is readied
// with `spell` instead (readied-spell.ts) and shows as "spell" here.
export const READIABLE = [
  "attack",
  "move",
  "dodge",
  "dash",
  "disengage",
  "hide",
  "help",
  "grapple",
  "shove",
  "search",
  "use_object",
  "escape",
  "improvise",
  "item",
  "stabilize",
  "feature",
] as const;

export type Readiable = (typeof READIABLE)[number] | "spell";

// How each reads in a sentence ("readied a move").
export const READIED_WORDS: Record<Readiable, string> = {
  attack: "an attack",
  spell: "a spell",
  move: "a move (up to their speed)",
  dodge: "Dodge",
  dash: "Dash",
  disengage: "Disengage",
  hide: "Hide",
  help: "Help",
  grapple: "a grapple",
  shove: "a shove",
  search: "Search",
  use_object: "Use an Object",
  escape: "an escape from a grapple",
  improvise: "an improvised action",
  item: "the use of an item",
  stabilize: "stabilizing a creature",
  feature: "a class feature that takes an action",
};

// The tool that releases each, named in replies to the DM.
export const RELEASE_TOOLS: Record<Readiable, string> = {
  attack: "pc_attack",
  spell: "the spell's own tool (pc_attack, cast_at_enemy, cast_buff, aoe_damage, heal)",
  move: "move_token to the chosen square (the player may also walk from the board)",
  dodge: "take_action dodge",
  dash: "take_action dash",
  disengage: "take_action disengage",
  hide: "take_action hide",
  help: "take_action help",
  grapple: "take_action grapple",
  shove: "take_action shove",
  search: "take_action search",
  use_object: "take_action use_object",
  escape: "take_action escape",
  improvise: "take_action improvise",
  item: "use_item",
  stabilize: "stabilize",
  feature: "use_resource, or the feature's own tool",
};

export type ReadiedHeld = { holds: Readiable; trigger: string; spell?: string };

// What a character holds readied, or null. A readied condition written
// before `holds` existed (and the one the feat reactions plant around an
// off-turn pc_attack: Mage Slayer, Sentinel, Retaliation) is an attack.
export function readiedHeld(sheet: { conditions: string[]; conditionMeta?: unknown }): ReadiedHeld | null {
  const name = sheet.conditions.find((entry) => entry.trim().toLowerCase() === READIED);
  if (!name) {
    return null;
  }
  const meta = (sheet.conditionMeta as ConditionMetaMap | undefined)?.[name];
  const holds: Readiable = meta?.spell
    ? "spell"
    : (READIABLE as readonly string[]).includes(meta?.holds ?? "")
      ? (meta?.holds as Readiable)
      : "attack";
  return { holds, trigger: meta?.source ?? "their trigger", ...(meta?.spell ? { spell: meta.spell } : {}) };
}
