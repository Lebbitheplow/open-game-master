// Issue 909: an admin who pressed Reset on their own row in Users was
// signed out before the temporary password could be read, and in the
// desktop app could not get back into their own world. Their own row offers
// no Reset button, and the row's menu greys Reset password out, as it does
// Delete user; other accounts keep both.
import { check, eventually } from "../lib.mjs";

export default {
  name: "admin-own-reset",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root } = t;
    await t.open("/admin");
    const users = page.locator(`${root}[role="radiogroup"][aria-label="Admin section"]`).getByRole("radio", { name: "Users" }).first();
    await eventually(() => users.count(), { timeoutMs: 30_000, label: "the Users section of the admin console" });
    await t.tap(users);

    const rows = page.locator(`${root}li.plate-row`);
    const own = rows.filter({ hasText: "(you)" }).first();
    await eventually(() => own.count(), { label: "the admin's own row" });
    const resetButton = (row) => row.getByRole("button", { name: /^\s*Reset\s*$/ });
    check((await resetButton(own).count()) === 0, "the admin's own row has no Reset button");

    const total = await rows.count();
    check(total > 1, "the seed has another account to compare with");
    let others = 0;
    for (let at = 0; at < total; at += 1) {
      const row = rows.nth(at);
      if (/\(you\)/.test(await row.innerText())) continue;
      others += 1;
      check((await resetButton(row).count()) === 1, "another account keeps its Reset button");
    }
    check(others > 0, "another account was checked");

    await t.tap(own.getByRole("button", { name: /^More actions for/ }));
    const item = page.getByRole("menuitem", { name: "Reset password" }).locator("visible=true").first();
    await eventually(() => item.count(), { label: "Reset password in the row's menu" });
    const off = (await item.isDisabled()) || (await item.getAttribute("aria-disabled")) === "true";
    check(off, "Reset password is greyed out for the admin's own account");
    // The menu fades in; the picture waits for it.
    await page.waitForTimeout(500);
    await t.shot("own-row");
  },
};
