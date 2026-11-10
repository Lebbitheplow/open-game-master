// Builder sweep, part 2: what a content pack subclass's text says it trains
// its character in is what the builder and the server grant.
//
// The authored subclasses carry their training in a table
// (src/lib/srd/subclass-training.ts); a pack subclass's is read out of its
// prose by trainingFromText. For every feature of every pack subclass whose
// text has a sentence that gives proficiency, each skill and each tool that
// sentence names must be granted outright or be among the picks the grant
// offers. A row is one such feature.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { hasPack } from "./lib/enforce-world.mjs";
import { openCreation } from "./lib/enforce-creation.mjs";
import { expand, sweepRows } from "./lib/sweep-builder-rows.mjs";
import { asBrowser, key, openSweepBuilder } from "./lib/sweep-builder.mjs";
import * as known from "./lib/sweep-builder-known.mjs";

const rows = sweepRows("test-enforce-sweep-builder-training-text", { KNOWN: hasPack ? expand(known.KNOWN_TRAINING_TEXT ?? []) : {}, SKIP: {} });
const creation = await openCreation();
const sb = await openSweepBuilder({ world: creation.world, user: creation.player });
const { subclassGrants } = await import("../src/lib/srd/subclass-training.ts");
const { classFeaturesFor, subclassFeatureDescription, subclassNamesFor } = await import("../src/lib/srd/features.ts");
const { KNOWN_TOOLS } = await import("../src/lib/srd/feat-grant-text.ts");
const { SRD_SKILLS } = await import("../src/lib/srd/index.ts");

// The sentences of a feature's text that give proficiency.
const GIVES = /\b(?:gain|gains|have|has|become|are)\b[^.]*\bproficien(?:cy|t)\b/i;
const sentences = (text) => String(text).replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).filter((sentence) => GIVES.test(sentence));
const names = (sentence, list) => list.filter((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(sentence));

let features = 0;
for (const klass of sb.classes) {
  const bundled = new Set(subclassNamesFor(klass.id).map(key));
  for (const subclass of (await sb.subclassesOf(klass.id)).filter((entry) => !bundled.has(key(entry.name)))) {
    // As the builder reads them: the pack's tables are the browser's.
    const entry = [{ id: klass.id, level: 20, subclass: subclass.name }];
    const grants = asBrowser(() => subclassGrants(entry));
    const base = new Set(classFeaturesFor(klass.id, "", 20).map((feature) => key(feature.name)));
    for (const feature of classFeaturesFor(klass.id, subclass.name, 20).filter((candidate) => !base.has(key(candidate.name)))) {
      const text = subclassFeatureDescription(klass.id, subclass.name, feature.name) ?? "";
      const giving = sentences(text);
      const skills = [...new Set(giving.flatMap((sentence) => names(sentence, SRD_SKILLS.map((skill) => skill.name))))];
      const tools = [...new Set(giving.flatMap((sentence) => names(sentence, KNOWN_TOOLS)))];
      if (!skills.length && !tools.length) continue;
      features += 1;
      await rows.row(`training-text:${klass.id}/${subclass.name}/${feature.name}`, async () => {
        const grant = grants.find((candidate) => key(candidate.name) === key(feature.name) && key(candidate.subclass) === key(subclass.name));
        const quote = giving.join(" ").slice(0, 260);
        assert.ok(grant, `the text gives proficiency and the engine grants nothing for this feature: "${quote}"`);
        const spec = grant.spec;
        const skillIds = new Set([...spec.fixedSkills, ...spec.skillsFrom].map(key));
        const anySkill = (spec.skills > 0 || (spec.any > 0 && spec.anyKinds.includes("skills"))) && !spec.skillsFrom.length;
        const lostSkills = skills.filter((name) => !anySkill && !skillIds.has(key(SRD_SKILLS.find((skill) => skill.name === name).id)));
        const toolNames = new Set([...spec.fixedTools, ...spec.toolsFrom].map(key));
        const anyTool = (spec.tools > 0 || (spec.any > 0 && spec.anyKinds.includes("tools"))) && !spec.toolsFrom.length;
        const lostTools = tools.filter((name) => !anyTool && !toolNames.has(key(name)));
        assert.ok(
          !lostSkills.length && !lostTools.length,
          `the text names ${[...lostSkills, ...lostTools].join(", ")} and the grant neither gives nor offers ${lostSkills.length + lostTools.length === 1 ? "it" : "them"}: "${quote}" :: grant ${JSON.stringify({ fixedSkills: spec.fixedSkills, skillsFrom: spec.skillsFrom, skills: spec.skills, fixedTools: spec.fixedTools, toolsFrom: spec.toolsFrom, tools: spec.tools, any: spec.any, anyKinds: spec.anyKinds })}`,
        );
      });
    }
  }
}
console.log(`${features} pack subclass features give a skill or a tool by name`);

creation.world.close();
rows.finish();
