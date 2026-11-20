// Issue 1047: a program that cannot play the full rules (the Antigravity
// CLI, HarnessStatus.reducedTools) is left off the admin page's list of
// agent programs, says why, comes back only through Add it anyway, and
// warns once chosen. Nothing is saved: the rig only looks.
import { check, eventually, sleep } from "../lib.mjs";

export default {
  name: "admin-agent-reduced",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root } = t;
    await t.open("/admin");
    const section = page.locator(`${root}#admin-harness`).first();
    await eventually(() => section.locator('[role="radio"]').count(), { timeoutMs: 60_000, label: "the agent program cards" });
    const agy = section.locator('[role="radio"]').filter({ hasText: "Antigravity CLI" });
    check((await agy.count()) === 0, "the Antigravity CLI is not on the list by default");
    const note = section.locator("p").filter({ hasText: /cannot play the full rules, so it is left off the list/ }).first();
    await eventually(() => note.count(), { label: "the note naming the program left off" });
    check(/Antigravity CLI/.test(await note.innerText()), "the note names the Antigravity CLI");
    await note.scrollIntoViewIfNeeded();
    await sleep(1_200);
    await t.shot("left-off");

    const add = note.getByRole("button", { name: "Add it anyway" });
    const box = await add.boundingBox();
    check(box && box.height >= 32, `Add it anyway is a real target (${box?.height}px tall)`);
    await t.tap(add);
    await eventually(() => agy.count(), { label: "the Antigravity CLI card after Add it anyway" });
    await t.tap(agy.first());
    const warning = section.locator('[role="alert"]').filter({ hasText: /cannot play the full rules/ }).first();
    await eventually(() => warning.count(), { label: "the warning once it is chosen" });
    check(/does not support or test this/.test(await warning.innerText()), "the warning says it is not supported or tested");
    // The card the admin added, and the warning, both arrive moving.
    check((await agy.count()) === 1, "the Antigravity CLI card is on the list once added");
    await warning.scrollIntoViewIfNeeded();
    await sleep(1_200);
    await t.shot("warned");
  },
};
