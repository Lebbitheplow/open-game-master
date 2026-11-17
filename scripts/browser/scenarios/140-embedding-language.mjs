// Issue #984 (PR #985): a table playing in a language the server's embedding
// model cannot read is warned in the lobby, to whoever can fix it, with a
// "Table language" button that opens the settings on the Language row, and
// the warning leaves live once the table is back in English. The seeded
// server runs the default English-only model; a server whose model did not
// load says that instead, which this run accepts too.
import { check, eventually } from "../lib.mjs";

const WARNING = /The GM's memory (cannot read Italian|is not running)/;

export default {
  name: "embedding-language",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    const setLanguage = async (tableLanguage) => {
      const saved = await api.patch(`${base}/api/campaigns/${ids.lobbyId}/settings`, { data: { tableLanguage } });
      check(saved.ok(), `setting the table language to ${tableLanguage} answered ${saved.status()}`);
    };
    // Viewports share one seeded world: every run leaves the lobby in English.
    await setLanguage("italian");
    try {
      await t.open(`/campaigns/${ids.lobbyId}`);
      const banner = page.locator(`${root}div`, { hasText: WARNING }).filter({ has: page.getByRole("button", { name: "Table language" }) }).last();
      // The first ask loads the embedding model, which takes a while on a cold server.
      await eventually(() => banner.isVisible(), { timeoutMs: 120_000, label: "the warning in the lobby" });
      const text = (await banner.innerText()).replace(/\s+/g, " ");
      check(/Italian|did not load/.test(text), `the warning names the language or the failed model (${text})`);
      await banner.scrollIntoViewIfNeeded();
      await t.shot("warned");

      // The button lands on the Language row of the table's settings.
      await t.tap(banner.getByRole("button", { name: "Table language" }));
      const row = page.locator(`${root}[data-settings-row="table-language"]`).locator("visible=true").first();
      await eventually(() => row.evaluate((element) => element.hasAttribute("data-flash")), { timeoutMs: 15_000, label: "the Language row flashed" });
      // A smooth scroll takes a moment to land.
      await eventually(
        () =>
          row.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return box.bottom > 0 && box.top < window.innerHeight;
          }),
        { timeoutMs: 10_000, label: "the Language row brought into view" },
      );
      const line = page.locator(`${root}p[role="status"]`, { hasText: /reads only English|did not load/ }).locator("visible=true");
      await eventually(() => line.count(), { timeoutMs: 15_000, label: "the warning line under Language" });
      await t.shot("language-row");
    } finally {
      await setLanguage("english");
    }

    // Back in English: the warning leaves without a reload.
    await eventually(
      () => page.locator(`${root}div`, { hasText: WARNING }).filter({ has: page.getByRole("button", { name: "Table language" }) }).count().then((count) => count === 0),
      { timeoutMs: 30_000, label: "the warning gone once the table plays in English" },
    );
  },
};
