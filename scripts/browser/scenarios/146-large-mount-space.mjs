// Issue #1055: a character on a Large mount fills the mount's space. Ilse
// rides a warhorse and her token used to stand in one square of the four the
// horse fills; here it is drawn two squares a side, twice as wide as her
// squire's beside her, by day and by night, on the website and on a phone.
import { check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "large-mount-space",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    const bench = ids.bench2.mounted;
    const setTheme = (mode) => page.evaluate((choice) => {
      window.localStorage.setItem("odm.theme", choice);
      // What applyTheme does: the app's screens do not reload between pages.
      document.documentElement.dataset.theme = choice;
      document.documentElement.style.colorScheme = choice;
    }, mode);
    const tokens = page.locator(`${root}[data-token-id]`).locator("visible=true");
    const widthOf = (id) => page.locator(`${root}[data-token-id="${id}"]`).locator("visible=true").first().evaluate((node) => node.getBoundingClientRect().width);
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
        const [rider, onFoot] = [await widthOf(bench.rider), await widthOf(bench.onFoot)];
        check(rider >= onFoot * 1.6, `the rider on the Large warhorse is drawn in the horse's space (${Math.round(rider)}px beside her squire's ${Math.round(onFoot)}px)`);
        await t.shot(mode);
      }
    } finally {
      await setTheme("dark");
    }
  },
};
