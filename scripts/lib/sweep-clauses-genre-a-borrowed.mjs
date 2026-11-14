// A genre feature that shares its name with another class's feature must not
// run that feature's hook: the feature-effects table answers by name alone,
// and the authored layer lends a class feature the row of another class's
// subclass feature of the same name (authored-effects.ts heldAuthored,
// "borrowed"). This walks every feature of the genre on a level 20 holder
// and lists each one that an engine table answers for with something its own
// text does not say. What is seen today is KNOWN_BORROWED; anything else
// fails the suite.
import assert from "node:assert/strict";

const SRC = new URL("../../src/", import.meta.url);
const key = (name) => name.toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").trim();

// Thought Shield (the Great Old One's resistance, answered by name) and Voice
// of Authority (the Order Domain's reaction, borrowed) are held now: a genre
// class never borrows another class's row, and a classed entry wins its name.
export const KNOWN_BORROWED = {};

export async function borrowedHooks({ rig, test, gap, features, discover, seen }) {
  const fx = await import(new URL("lib/srd/feature-effects.ts", SRC).href);
  const found = new Map();
  for (const classId of new Set(features.map((feature) => feature.classId))) {
    rig.fresh();
    const sheet = rig.world.sheet(rig.hero(classId, 20).id);
    const typed = fx.effectsFor({ class: sheet.class, features: sheet.features, campaignId: sheet.campaignId });
    const rows = rig.authored.heldAuthored(sheet);
    for (const feature of features.filter((entry) => entry.classId === classId)) {
      const own = (effect) => effect.kind === "narrative" || (effect.kind === "extra_attack" && /^Attack (twice|three times)/.test(feature.text));
      const answers = [
        // An entry written for this very class (its `classes` names it) is the
        // feature's own hook, not another class's.
        ...typed.filter((entry) => key(entry.feature) === key(feature.name) && !own(entry.effect) && !(entry.def.classes ?? []).includes(classId.replace(/_/g, " "))).map((entry) => `feature effect ${entry.effect.kind}${entry.effect.types ? ` (${entry.effect.types.join(", ")})` : ""}, from "${String(entry.def.guidance ?? "").slice(0, 90)}"`),
        ...rows.filter((entry) => key(entry.name) === key(feature.name) && entry.entry?.subclass !== "genre").map((entry) => `the authored row of ${entry.entry?.subclass} (${Object.keys(entry.entry ?? {}).filter((part) => part !== "subclass").join(", ")})`),
      ];
      if (answers.length) found.set(feature.key, answers.join("; "));
    }
  }
  if (discover) {
    for (const [id, what] of found) seen[`borrowed:${id}`] = `fail: ${what}`;
    return;
  }
  await test("no feature is answered by a hook written for another class's feature, beyond the known ones", () => {
    const unknown = [...found].filter(([id]) => !KNOWN_BORROWED[id]).map(([id, what]) => `${id}: ${what}`);
    assert.deepEqual(unknown, [], unknown.join(" | "));
  });
  for (const [id, meta] of Object.entries(KNOWN_BORROWED)) {
    if (!features.some((feature) => feature.key === id)) continue;
    await gap(`borrowed:${id}`, meta, () => assert.ok(!found.has(id), `${id} is answered by ${found.get(id)}`));
  }
}
