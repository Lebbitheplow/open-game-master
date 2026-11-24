// Issue #1055, ruling 2: an enemy rider may steer its mount (`controlled:
// true` on the entry). A steered mount takes no turn of its own, so the turn
// order seats the pair once, under the rider's name, while a mount that acts
// as it wishes keeps the seat it always had. Both pairs are still one token
// each on the board.
import { check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "controlled-enemy-mount",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    const bench = ids.bench2.steered;
    const tokens = page.locator(`${root}[data-token-id]`).locator("visible=true");
    // The turn order's seats, by their full names (a seat shows a first name).
    const seats = () => page.locator(`${root}.cine-ribbon-seat button`).evaluateAll((nodes) => nodes.map((node) => (node.getAttribute("aria-label") ?? "").replace(/, their turn$/, "")));
    await t.open(`/campaigns/${bench.id}`);
    await eventually(async () => (await seats()).length >= bench.turns, { timeoutMs: 30_000, label: "the turn order" });
    const seated = await seats();
    check(seated.length === bench.turns, `the turn order seats ${bench.turns}: the hero, two riders and the mount that acts as it wishes (${seated.join(" | ")})`);
    check(!seated.includes(bench.steered), `the steered ${bench.steered} has no seat of its own (${seated.join(" | ")})`);
    check(seated.includes(bench.free), `the ${bench.free} that acts as it wishes keeps its seat (${seated.join(" | ")})`);
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
    check((await tokens.count()) === bench.tokens, `the board draws ${bench.tokens} tokens for a hero and two mounted goblins (${await tokens.count()})`);
    await t.shot("order");
  },
};
