// A GM-made companion can arrive with the wrong skills and no expertise, and
// the lead had nothing at the table to put it right. On the Command Table
// the lead opens Pip's options, Adjust stats, and finds the scores, the
// saving throws and every skill's training there. Setting a skill to Expert
// saves it to Pip's sheet (viewports share one world, so a later pass flips
// it back to Trained), and the section passes axe.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const scenario = {
  name: "lead-adjust-training",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    await t.open(`/campaigns/${ids.commandTableId}`);
    const card = page.locator(`${root}[data-party-card="${ids.pip}"]`).locator("visible=true").first();
    for (const selector of [`${root}[data-tour="tab-party"]`, `${root}.cine-party button`]) {
      if (await card.count()) break;
      const door = page.locator(selector).locator("visible=true").first();
      if (await door.count()) {
        await t.tap(door);
        await eventually(() => card.count(), { timeoutMs: 800 }).catch(() => 0);
      }
    }
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "Pip's party card" });
    await untilStill(page);

    const sheetOf = async () => {
      const table = await (await api.get(`${base}/api/campaigns/${ids.commandTableId}`)).json();
      return (table.sheets ?? []).find((sheet) => sheet.id === ids.pip);
    };
    const before = await sheetOf();
    const wasExpert = (before?.proficiencies?.expertise ?? []).includes("insight");

    await t.tap(card.getByRole("button", { name: /^Options for / }));
    await t.tap(page.getByRole("menuitem", { name: "Adjust stats" }));
    const dialog = page.getByRole("dialog", { name: /^Adjust / });
    await eventually(() => dialog.count(), { label: "the Adjust dialog" });
    const insight = dialog.getByRole("radiogroup", { name: "Insight" });
    await eventually(() => insight.count(), { label: "Insight's training in the dialog" });
    check(
      (await dialog.getByRole("radiogroup").count()) === 18,
      "every one of the eighteen skills has its training",
    );
    check((await dialog.getByRole("switch", { name: /saving throw$/ }).count()) === 6, "a switch for each saving throw");
    if (t.viewport === "phone") {
      // A finger's height on a phone (AGENTS.md): each kind of control here,
      // measured once the dialog's entrance has finished.
      await untilStill(page);
      for (const [label, control] of [
        ["Insight's Expert", insight.getByRole("radio", { name: "Expert" })],
        ["the Strength saving throw's row", dialog.getByRole("switch", { name: "Strength saving throw" }).locator("xpath=..")],
        ["Strength's stepper", dialog.getByRole("button", { name: "Raise Strength" }).locator("xpath=..")],
      ]) {
        const box = await control.boundingBox();
        check(Boolean(box && box.height >= 39.5), `${label} is a finger's height on a phone (${box?.height}px)`);
      }
    }
    await dialog.getByRole("heading", { name: "Scores and training" }).scrollIntoViewIfNeeded();
    await untilStill(page);
    await t.shot("training");

    const serious = (list) => list.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    const found = serious(await axeViolations(page, '[role="dialog"]'));
    check(!found.length, `axe finds nothing serious in the dialog (${found.map((violation) => violation.id).join(", ")})`);
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    const day = serious(await axeViolations(page, '[role="dialog"]'));
    check(!day.length, `and nothing serious by day (${day.map((violation) => violation.id).join(", ")})`);
    await t.shot("training-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

    const wanted = wasExpert ? "Trained" : "Expert";
    await t.tap(insight.getByRole("radio", { name: wanted }));
    check((await insight.getByRole("radio", { name: wanted }).getAttribute("aria-checked")) === "true", `Insight shows ${wanted}`);
    await insight.scrollIntoViewIfNeeded();
    await untilStill(page);
    await t.shot("insight-set");
    const saved = page.waitForResponse((response) => response.url().includes(`/sheets/${ids.pip}`) && response.request().method() === "PATCH");
    await t.tap(dialog.getByRole("button", { name: "Save" }));
    check((await saved).ok(), "the correction saves");
    await eventually(async () => !(await dialog.count()), { label: "the dialog closing" });

    const after = await sheetOf();
    check(after?.proficiencies?.skills?.includes("insight"), "Pip is trained in Insight");
    check(
      (after?.proficiencies?.expertise ?? []).includes("insight") === !wasExpert,
      `Insight's expertise is ${wasExpert ? "taken back" : "kept"}`,
    );
  },
};

export default scenario;
