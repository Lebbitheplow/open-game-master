// Server PR 1088 gave small controls a 40px reach on a phone (.tap-reach,
// kit.css), and where two stand a few px apart each reach covers the
// other's edge: the board's Draw took a tap on Point's right edge, Enlarge
// one on Draw's, and a party card's options one on the card's heading. The
// client found the same in the shell (Duplicate and Delete on a campaign
// slot). Here, on a phone, in the lobby, the battle and party panels and the
// home page: a tap on any control's face goes to that control, never to a
// neighbour's reach. A small action drawn over a larger surface (a campaign
// tile's own actions) may still reach over that surface round it.
import { check, eventually, untilStill } from "../lib.mjs";

const stolen = (page, root) =>
  page.evaluate((root) => {
    const scope = root ? document.querySelector(root.trim()) : document.body;
    if (!scope || !matchMedia("(pointer: coarse)").matches) return null;
    const name = (el) => (el.getAttribute("aria-label") || el.title || el.innerText || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
    const inside = (a, b) => a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;
    const found = [];
    for (const control of scope.querySelectorAll("button, a[href], [role=button]")) {
      if (!control.checkVisibility()) continue;
      const r = control.getBoundingClientRect();
      if (r.width < 6 || r.height < 6 || r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) continue;
      // Two px inside each edge, and the middle.
      const points = [
        [r.left + 2, r.top + r.height / 2], [r.right - 2, r.top + r.height / 2],
        [r.left + r.width / 2, r.top + 2], [r.left + r.width / 2, r.bottom - 2],
        [r.left + r.width / 2, r.top + r.height / 2],
      ];
      for (const [x, y] of points) {
        const thief = document.elementFromPoint(x, y)?.closest(".tap-reach");
        if (!thief || thief === control || control.contains(thief) || thief.contains(control)) continue;
        if (inside(thief.getBoundingClientRect(), r)) continue;
        found.push(`${name(thief)} takes a tap on ${name(control)} at ${Math.round(x)},${Math.round(y)}`);
        break;
      }
    }
    return found;
  }, root);

export default {
  name: "tap-reach-faces",
  viewports: ["phone"],
  async run(t) {
    const { page, root, ids } = t;
    const faults = [];
    const look = async (where) => {
      await untilStill(page).catch(() => undefined);
      const found = await stolen(page, root);
      check(found !== null, `${where}: the phone reports a coarse pointer`);
      faults.push(...found.map((fault) => `${where}: ${fault}`));
    };
    await t.open("/");
    await look("home");
    await t.open(`/campaigns/${ids.campaignId}`);
    const tab = (name) => page.locator(`${root}nav.cine-bottombar button`).filter({ hasText: name }).first();
    await eventually(() => tab(/^table$/i).count(), { timeoutMs: 30_000, label: "the bottom bar" });
    await look("the table");
    for (const name of [/^battle$/i, /^party$/i]) {
      await t.tap(tab(name));
      await look(`the ${name.source.replace(/[\^$]/g, "")} panel`);
    }
    check(faults.length === 0, `a tap on a control's face goes to that control:\n  ${faults.join("\n  ")}`);
  },
};
