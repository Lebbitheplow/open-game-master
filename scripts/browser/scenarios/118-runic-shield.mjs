// PR 790: Runic Shield comes up when an ally is hit, and the card is kept to
// the ally within its 60 feet (PlayerMapView.feet). Seen on a desktop and a
// phone, day and night, the Hand through axe, and played from the aim bar as
// the Rune Knight's reaction to that hit (the seed's bench2.runic). A player's
// card waits for the GM; from the GM's own seat the engine resolves it at once
// (bench2.runicGm), so the reroll itself runs here with no model.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "runic-shield",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    const phone = t.viewport === "phone";
    const bench = ids.bench2[t.viewport].runic;
    await t.open(`/campaigns/${bench.id}`);
    const hand = page.locator(`${root}section[aria-label="Your hand"]`).locator("visible=true").first();
    const tableTab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true }).locator("visible=true").first();
    await eventually(
      async () => {
        if (await hand.isVisible().catch(() => false)) return true;
        if (phone && (await tableTab.count())) await t.tap(tableTab).catch(() => undefined);
        return false;
      },
      { timeoutMs: 30_000, label: "Runa's Hand" },
    );
    const strips = hand.locator('[role="group"][aria-label="Reactions"]');
    const nearCard = strips.filter({ hasText: bench.near.name }).getByRole("button", { name: /^Runic Shield/ }).first();
    await eventually(() => nearCard.isVisible(), { timeoutMs: 20_000, label: `Runic Shield for ${bench.near.name}, beside Runa` });
    check(
      !(await strips.filter({ hasText: bench.far.name }).getByRole("button", { name: /^Runic Shield/ }).count()),
      `no Runic Shield for ${bench.far.name}, 65 feet off`,
    );
    await untilStill(page).catch(() => undefined);
    if (phone) {
      const box = await nearCard.boundingBox();
      check(box && Math.round(box.height) >= 40, `the card is at least 40px tall on a phone (${box?.height})`);
    }
    await hand.evaluate((node) => node.setAttribute("data-runic", "hand"));
    for (const theme of ["dark", "light"]) {
      await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
      await untilStill(page).catch(() => undefined);
      const faults = await axeViolations(page, '[data-runic="hand"]');
      check(faults.length === 0, `the Hand passes axe in the ${theme} theme: ${JSON.stringify(faults).slice(0, 400)}`);
      await t.shot(`runic-shield-${theme}`);
    }
    // Played: the aim bar names it, and it goes out as Runa's reaction.
    await t.tap(nearCard);
    const send = hand.locator("div", { has: page.getByRole("button", { name: "Back", exact: true }) }).last().getByRole("button").last();
    await eventually(async () => /runic shield/i.test(await send.innerText()), { label: "the aim bar for Runic Shield" });
    const played = page.waitForResponse((response) => response.url().endsWith(`/api/campaigns/${bench.id}/actions`) && response.request().method() === "POST", { timeout: 30_000 });
    await t.tap(send);
    const answer = await played;
    const body = JSON.parse(answer.request().postData() ?? "{}");
    check(answer.ok(), `the reaction answered ${answer.status()}: ${(await answer.text()).slice(0, 200)}`);
    check(body.characterId === bench.runa.id && body.intent?.card === "reaction" && /runic shield/i.test(body.intent?.feature ?? ""), `sent as Runic Shield (${JSON.stringify(body).slice(0, 300)})`);
    await untilStill(page).catch(() => undefined);
    await t.shot("runic-shield-played");

    // From the GM's own seat the engine resolves it as it is played: the attacker
    // rolls again, a use is spent, and the hit is answered, whichever way the die falls.
    const gm = ids.bench2[t.viewport].runicGm;
    const state = async () => (await (await t.api.get(`${t.base}/api/campaigns/${gm.id}`)).json());
    const sheetOf = (view, id) => (view.sheets ?? view.characters ?? []).find((sheet) => sheet.id === id);
    const hurt = sheetOf(await state(), gm.near.id)?.currentHp;
    check(typeof hurt === "number" && hurt < 44, `the goblin's blow is on ${gm.near.name} (${hurt})`);
    await t.open(`/campaigns/${gm.id}`);
    await eventually(
      async () => {
        if (await hand.isVisible().catch(() => false)) return true;
        if (phone && (await tableTab.count())) await t.tap(tableTab).catch(() => undefined);
        return false;
      },
      { timeoutMs: 30_000, label: "Runa's Hand at the GM's table" },
    );
    const gmCard = strips.filter({ hasText: gm.near.name }).getByRole("button", { name: /^Runic Shield/ }).first();
    await eventually(() => gmCard.isVisible(), { timeoutMs: 20_000, label: "Runic Shield at the GM's table" });
    await t.tap(gmCard);
    await eventually(async () => /runic shield/i.test(await send.innerText()), { label: "the aim bar at the GM's table" });
    const resolving = page.waitForResponse((response) => response.url().endsWith(`/api/campaigns/${gm.id}/actions`) && response.request().method() === "POST", { timeout: 30_000 });
    await t.tap(send);
    const resolved = await resolving;
    const outcome = await resolved.json();
    check(resolved.ok() && outcome.resolved === true, `the engine resolved it from the GM's seat (${resolved.status()} ${JSON.stringify(outcome).slice(0, 200)})`);
    const after = await state();
    const hp = sheetOf(after, gm.near.id)?.currentHp;
    // A reroll that misses gives the hit points back; one that hits leaves the
    // blow as it was, unless it comes up 20 and raises the hit to a critical,
    // which adds the scimitar's second d6 (1 to 6) to it (critical-raise.ts).
    const raised = typeof hp === "number" && hp < hurt && hurt - hp <= 6;
    check(hp === hurt || hp === 44 || raised, `${gm.near.name}'s blow stands, comes back whole or turns critical (${hurt} to ${hp})`);
    check(sheetOf(after, gm.runa.id)?.resources?.sub_runic_shield?.used === 1, "one use of Runic Shield is spent");
    await eventually(async () => (await gmCard.getAttribute("aria-disabled", { timeout: 1_000 }).catch(() => "true")) === "true", { label: "the card shut once answered" });
    await untilStill(page).catch(() => undefined);
    await t.shot("runic-shield-resolved");
  },
};
