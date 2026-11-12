// A Lore bard's expertise in its college's skills survives "Fill what's
// left" (play-test 2026-11-09). Bard 10, College of Lore, the class skills,
// the college's Arcana, History and Nature, and expertise in Performance and
// the three college skills, all picked by hand; then the fill. The builder's
// own check of the picks, run when the fill chose the species and the
// background, did not count the college's skills, so it dropped History
// and Nature from the expertise and the fill put others in their place,
// under a banner that said nothing chosen was changed.
//
// The picks are laid in a kept draft (builderDraft.ts) and resumed, as a
// player coming back to the builder would.
import { check, eventually, currentStep } from "../lib.mjs";

const visible = (page, root, text) =>
  page.locator(`${root}button`).filter({ hasText: text }).locator("visible=true");

const KEY = "odm:builder-draft:library";
const COLLEGE = ["arcana", "history", "nature"];
const EXPERTISE = ["performance", ...COLLEGE];

const draft = (page) => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), KEY);

// A reload in a browser; in the app, leaving for the library and coming back.
async function reopen(t) {
  if (t.app) await t.open("/characters");
  await t.open("/characters/new");
}

export default {
  name: "fill-keeps-expertise",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root } = t;
    const active = `${root}section[data-active]`;
    await t.open("/characters/new");
    // A draft an earlier viewport left is not this one's.
    const fresh = visible(page, root, /^Start fresh$/);
    if (await fresh.count()) await t.tap(fresh.first());
    const bard = page.locator(`${active} .creator-card[aria-label^="Bard"]`).locator("visible=true").first();
    await bard.waitFor({ state: "visible", timeout: 30_000 });
    await t.tap(bard);
    // The pick writes a draft 400 ms later; it is rewritten with the rest
    // of the hand-made picks.
    await eventually(async () => (await draft(page))?.fields?.classId === "bard", { label: "the bard kept on the device" });
    await page.evaluate(
      ({ key, college, expertise }) => {
        const kept = JSON.parse(window.localStorage.getItem(key) ?? "null");
        const fields = {
          ...kept.fields,
          level: 10,
          subclass: "College of Lore",
          chosenSkills: ["performance", "persuasion", "deception"],
          featChoices: { "Bonus Proficiencies (Lore)": { skills: college } },
          expertisePicks: expertise,
        };
        window.localStorage.setItem(key, JSON.stringify({ ...kept, savedAt: Date.now(), step: "calling", fields }));
      },
      { key: KEY, college: COLLEGE, expertise: EXPERTISE },
    );
    await reopen(t);
    const resume = visible(page, root, /^Resume$/);
    await eventually(() => resume.count(), { timeoutMs: 15_000, label: "the Resume offer" });
    await t.tap(resume.first());
    await eventually(async () => /^Step 1:/.test(await currentStep(page, root)), { timeoutMs: 10_000, label: "resumed on the class step" });
    const expertise = page.locator(`${active} [data-builder-target="expertise"]`).locator("visible=true").first();
    await expertise.waitFor({ state: "visible", timeout: 15_000 });
    check(!/still to choose/.test(await expertise.innerText()), "the four expertise picks are made before the fill");

    // The class step owes nothing now; the species and background are owed
    // on the next, where the fill is offered.
    const was = await currentStep(page, root);
    await t.tap(visible(page, root, /^\s*Continue/i).first());
    await eventually(async () => (await currentStep(page, root)) !== was, { label: "the Ancestry step" });
    const fill = page.locator(`${active} [data-quick-fill]`).locator("visible=true");
    await eventually(() => fill.count(), { timeoutMs: 10_000, label: "Fill what's left" });
    await t.tap(fill.first());
    const readback = page.locator(`${root}[data-quick-readback]`).locator("visible=true");
    await eventually(() => readback.count(), { timeoutMs: 20_000, label: "the read-back" });
    const said = (await readback.first().innerText()).replace(/\s+/g, " ");
    check(!/Expertise:/.test(said), `the fill picked no expertise (${said.slice(0, 300)})`);
    await t.tap(visible(page, root, /^Keep them$/).first());

    // The species and background the fill chose, with the expertise as the
    // player left it.
    const kept = await eventually(
      async () => {
        const fields = (await draft(page))?.fields;
        return fields?.raceId && fields?.backgroundId ? fields : null;
      },
      { timeoutMs: 10_000, label: "the filled build kept on the device" },
    );
    check(JSON.stringify(kept.expertisePicks) === JSON.stringify(EXPERTISE), `the expertise is as picked (${kept.expertisePicks.join(", ")})`);
    const twice = [...(kept.racialSkills ?? []), ...(kept.backgroundSkills ?? [])].filter((skill) => COLLEGE.includes(skill));
    check(twice.length === 0, `no skill the college gave was picked again (${twice.join(", ")})`);
    // Back on the class step, the panel shows the four picks with nothing owed.
    await t.tap(page.locator(`${root}button[aria-label^="Back to step 1:"]`).locator("visible=true").first());
    await eventually(async () => /^Step 1:/.test(await currentStep(page, root)), { timeoutMs: 10_000, label: "back on the class step" });
    await expertise.waitFor({ state: "visible", timeout: 15_000 });
    await eventually(async () => !/still to choose/.test(await expertise.innerText()), { timeoutMs: 5_000, label: "the expertise panel with nothing owed" });
    await expertise.evaluate((node) => node.scrollIntoView({ block: "center" }));
    await t.shot("expertise-after-fill");
    // The kept draft is this run's; the next viewport starts fresh.
    await page.evaluate((key) => window.localStorage.removeItem(key), KEY);
  },
};
