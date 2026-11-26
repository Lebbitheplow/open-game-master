// Issue #1091: an enemy gets on and off a mount in the middle of a fight.
// mount_up and dismount take an enemy's id in characterId, so the GM of the
// seed's Saddle Table puts a goblin on the wolf beside it, and a second
// goblin on a warhorse it steers, and takes that one down again.
//
// What the table sees: two tokens become one in the mount's space; a mount
// its rider steers gives up its seat in the turn order, and has it back,
// after its rider's, once the rider is down; a rider that mounted this move
// does not get down in it. The engine's half is held by
// scripts/test-enforce-enemy-midfight-mounting.mjs.
import { check, eventually, untilStill } from "../lib.mjs";

const scenario = {
  name: "enemy-midfight-mounting",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport, api } = t;
    const bench = ids.bench2.saddle[viewport];
    const tokens = page.locator(`${root}[data-token-id]`).locator("visible=true");
    // The turn order's seats, by their full names (a seat shows a first name).
    const seats = () => page.locator(`${root}.cine-ribbon-seat button`).evaluateAll((nodes) => nodes.map((node) => (node.getAttribute("aria-label") ?? "").replace(/, their turn$/, "")));
    // The GM's own door, as the console's form sends it, through the
    // signed-in request context: in the app shell the page carries a token,
    // not the cookie page.request would send.
    const invoke = async (name, args) => {
      const sent = await api.post(`${base}/api/campaigns/${bench.id}/dm/invoke`, { data: { name, args } });
      const body = await sent.json().catch(() => ({}));
      return { status: sent.status(), ok: sent.ok() && body.ok !== false && !body.error, error: String(body.error ?? ""), result: body.result ?? body };
    };
    const enemies = async () => (await (await api.get(`${base}/api/campaigns/${bench.id}`)).json()).encounter?.enemies ?? [];
    const ridden = async (riderId) => (await enemies()).find((enemy) => enemy.id === riderId)?.ridesEnemyId ?? null;
    const drawn = (count, label) => eventually(async () => (await tokens.count()) === count, { timeoutMs: 30_000, label });

    await t.open(`/campaigns/${bench.id}`);
    await eventually(async () => (await seats()).length >= 5, { timeoutMs: 30_000, label: "the turn order" });
    const before = await seats();
    check(before.includes(bench.horse.name) && before.includes(bench.wolf.name), `each creature on foot has a seat of its own (${before.join(" | ")})`);
    if (viewport === "phone") {
      const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Battle", exact: true }).locator("visible=true").first();
      await eventually(() => tab.isVisible(), { timeoutMs: 30_000, label: "the phone's bar" });
      await t.tap(tab);
    }
    await eventually(async () => (await tokens.count()) >= 5, { timeoutMs: 30_000, label: "the board's tokens" });
    // The fight's title card plays over the board as the page opens.
    const card = page.getByText("Roll initiative", { exact: true }).locator("visible=true");
    await eventually(async () => (await card.count()) === 0, { timeoutMs: 30_000, label: "the title card gone" });
    // The Hand lies over the lower board: put away, the tokens show.
    const hide = page.locator(`${root}button`, { hasText: /^Hide$/i }).locator("visible=true").first();
    if (await hide.count()) {
      await t.tap(hide);
    }
    await untilStill(page).catch(() => undefined);
    check((await tokens.count()) === 5, `the board draws 5 tokens for a hero, two goblins, a wolf and a warhorse (${await tokens.count()})`);
    await t.shot("on-foot");

    // ---- the goblin gets on the wolf beside it, on its own turn ----
    const up = await invoke("mount_up", { characterId: bench.scout.id, mount: bench.wolf.id });
    check(up.ok, `an enemy's id in characterId put the goblin on the wolf (${up.status}: ${up.error})`);
    check(up.result.movementSpent === 15, `mounting cost the goblin half its 30 feet (${JSON.stringify(up.result.movementSpent)})`);
    await drawn(4, "the goblin and the wolf on one token");
    check((await ridden(bench.scout.id)) === bench.wolf.id, "the page's own state names the wolf as the goblin's mount");
    const paired = await seats();
    check(paired.includes(bench.wolf.name), `a mount that acts as it wishes keeps its seat (${paired.join(" | ")})`);
    await untilStill(page).catch(() => undefined);
    await t.shot("mounted");

    // ---- once a move: it does not get down in the move it mounted in ----
    const again = await invoke("dismount", { characterId: bench.scout.id });
    check(!again.ok && /once a move/.test(again.error), `a rider that mounted this move was refused the dismount (${again.status}: ${again.error || JSON.stringify(again.result).slice(0, 200)})`);
    check((await ridden(bench.scout.id)) === bench.wolf.id, "the refused dismount left the goblin in the saddle");

    // ---- the lancer takes the warhorse's reins ----
    const steer = await invoke("mount_up", { characterId: bench.lancer.id, mount: bench.horse.id, controlled: true });
    check(steer.ok, `the lancer mounted the warhorse as a controlled mount (${steer.status}: ${steer.error})`);
    await drawn(3, "the lancer and the warhorse on one token");
    await eventually(async () => !(await seats()).includes(bench.horse.name), { timeoutMs: 30_000, label: "the steered warhorse giving up its seat" });
    const steered = await seats();
    check(steered.length === 4, `the turn order seats 4: the hero, the goblin, the wolf and the lancer (${steered.join(" | ")})`);
    await untilStill(page).catch(() => undefined);
    await t.shot("steered");

    // ---- and gets down again: the warhorse stands alone, with a seat after its rider's ----
    const down = await invoke("dismount", { characterId: bench.lancer.id });
    check(down.ok, `the lancer got down (${down.status}: ${down.error})`);
    await drawn(4, "the lancer and the warhorse on a token each");
    await eventually(async () => (await seats()).includes(bench.horse.name), { timeoutMs: 30_000, label: "the riderless warhorse seated again" });
    const after = await seats();
    check(after.indexOf(bench.horse.name) === after.indexOf(bench.lancer.name) + 1, `the freed warhorse's seat is right after its rider's (${after.join(" | ")})`);
    check((await ridden(bench.lancer.id)) === null, "the page's own state has the lancer on foot");
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "nothing pushes the page sideways");
    await untilStill(page).catch(() => undefined);
    await t.shot("down");
  },
};

export default scenario;
