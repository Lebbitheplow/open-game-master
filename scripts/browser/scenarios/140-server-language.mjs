// The server's language (issue #919, mcerina's point there: a non-English
// table needs the embedding model changed): Admin > Settings picks it by its
// flag, every row shows a flag beside the language's own name, and picking
// one says what saving will do to the GM's memory. The rig does not save:
// switching models would download the multilingual one in the background.
import { check, eventually } from "../lib.mjs";

export default {
  name: "server-language",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root } = t;
    await t.open("/admin");
    const section = page.locator(`${root}#admin-language`).first();
    await eventually(() => section.count(), { timeoutMs: 30_000, label: "the Language section" });
    const trigger = section.locator('button[aria-label="Server language"]').first();
    await trigger.scrollIntoViewIfNeeded();
    check(/English/.test(await trigger.innerText()), "the server plays in English to start");
    check((await trigger.locator("svg").count()) >= 1, "the chosen language shows its flag");
    const box = await trigger.boundingBox();
    check(box && box.height >= 40, `the picker is finger-sized (${box?.height}px)`);
    await t.shot("language-closed");

    await t.tap(trigger);
    const rows = page.getByRole("menuitemradio").locator("visible=true");
    await eventually(async () => (await rows.count()) === 15, { label: "fifteen languages in the list" });
    const french = rows.filter({ hasText: "Français" }).first();
    check(/French/.test(await french.innerText()), "a row names the language in English too");
    check((await french.locator("svg").count()) === 1, "each row carries a flag");
    await t.shot("language-open");
    await t.tap(french);

    await eventually(async () => /Français/.test(await trigger.innerText()), { label: "French chosen" });
    await eventually(async () => /Saving switches memory search to a model that reads every language/.test(await section.innerText()), {
      label: "the section says what saving does to the GM's memory",
    });
    await t.shot("language-french");
  },
};
