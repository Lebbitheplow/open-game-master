// Issue #1055: an enemy on a mount is one token on the board, the rider's,
// drawn in the mount's space. A goblin on a Large warhorse and a goblin on a
// wolf used to be four tokens on four squares; here they are two, and the
// warhorse's pair is twice as wide as the wolf's.
import { check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "enemy-riders",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    const bench = ids.bench2.riders;
    const setTheme = (mode) => page.evaluate((choice) => {
      window.localStorage.setItem("odm.theme", choice);
      // What applyTheme does: the app's screens do not reload between pages.
      document.documentElement.dataset.theme = choice;
      document.documentElement.style.colorScheme = choice;
    }, mode);
    const tokens = page.locator(`${root}[data-token-id]`).locator("visible=true");
    try {
      for (const mode of ["dark", "light"]) {
        await t.open(`/campaigns/${bench.id}`);
        await setTheme(mode);
        await t.open(`/campaigns/${bench.id}`);
        if (t.viewport === "phone") {
          const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Battle", exact: true }).locator("visible=true").first();
          await eventually(() => tab.isVisible(), { timeoutMs: 30_000, label: "the phone's bar" });
          await t.tap(tab);
        }
        await eventually(async () => (await tokens.count()) >= bench.tokens, { timeoutMs: 30_000, label: "the board's tokens" });
        // The fight's title card plays over the board as the page opens.
        const card = page.getByText("Roll initiative", { exact: true }).locator("visible=true");
        await eventually(async () => (await card.count()) === 0, { timeoutMs: 30_000, label: "the title card gone" });
        // The Hand lies over the lower board: put away, the tokens show.
        const hide = page.locator(`${root}button`, { hasText: /^Hide$/i }).locator("visible=true").first();
        if (await hide.count()) {
          await t.tap(hide);
        }
        await untilStill(page).catch(() => undefined);
        // The hero and two riders: neither mount has a token of its own.
        const widths = await tokens.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
        check(widths.length === bench.tokens, `the board draws ${bench.tokens} tokens for a hero and two mounted goblins (${widths.length})`);
        const [narrow, wide] = [Math.min(...widths), Math.max(...widths)];
        check(wide >= narrow * 1.6, `the pair on the Large warhorse is drawn in its mount's space (${Math.round(wide)}px beside ${Math.round(narrow)}px)`);
        await t.shot(mode);
      }
    } finally {
      await setTheme("dark");
    }
  },
};
