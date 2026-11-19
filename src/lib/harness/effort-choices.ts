// The efforts the admin card offers for an agent program. Its model pickers
// list what the program reports, and so does this: the story effort offers
// what the chosen story model lists (a blank story model being the program's
// own default), without being narrowed by the bookkeeping model (which has its
// own `utilityEffortChoices` picker). A model whose efforts the program does
// not say narrows nothing; the run checks what it actually gets. Pure, so
// scripts/test-harness-logic.mjs can pin it.

import { HARNESS_EFFORTS, type HarnessConfig, type HarnessStatus } from "./types.ts";

type Program = Pick<HarnessStatus, "models" | "defaultEfforts">;

export function effortChoices(program: Program, config: Pick<HarnessConfig, "model"> & Partial<Pick<HarnessConfig, "utilityModel">>): HarnessConfig["effort"][] {
  const listed = (id: string) => program.models.find((entry) => entry.id === id)?.efforts;
  const story = config.model ? listed(config.model) : program.defaultEfforts;
  return ["", ...HARNESS_EFFORTS.filter((effort) => !story || story.includes(effort))];
}

// The bookkeeping effort's choices: what the bookkeeping model lists (the
// story model when none is set), blank being the story's effort.
export function utilityEffortChoices(program: Program, config: Pick<HarnessConfig, "model" | "utilityModel">): HarnessConfig["utilityEffort"][] {
  const listed = (id: string) => program.models.find((entry) => entry.id === id)?.efforts;
  const efforts = config.utilityModel ? listed(config.utilityModel) : config.model ? listed(config.model) : program.defaultEfforts;
  return ["", ...HARNESS_EFFORTS.filter((effort) => !efforts || efforts.includes(effort))];
}

// A model change keeps the effort only where the new models still offer it.
export function withOfferedEffort<T extends Pick<HarnessConfig, "model" | "utilityModel" | "effort"> & Partial<Pick<HarnessConfig, "utilityEffort">>>(program: Program, config: T): T {
  const story = effortChoices(program, config).includes(config.effort) ? config : { ...config, effort: "" };
  return !story.utilityEffort || utilityEffortChoices(program, story).includes(story.utilityEffort) ? story : { ...story, utilityEffort: "" };
}
