// A private chat follows its newest line only for a reader who is at the
// end, and moves its own list alone. It used scrollIntoView on a node at the
// list's foot, which pulled a reader who had scrolled back to the end with
// every line that arrived and moved every scroller up to the window: the
// same fault as the transcript's in issue 760.
import { axeViolations, check, eventually, openPanelTab, signIn, sleep, untilStill } from "../lib.mjs";

export default {
  name: "side-chat-follow",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, api, base, ids, viewport } = t;
    const { id: campaignId } = ids.directed[viewport];
    const campaign = await (await api.get(`${base}/api/campaigns/${campaignId}`)).json();
    const player = (campaign.members ?? []).find((member) => member.username === ids.player);
    check(player, `the player sits at the table (${(campaign.members ?? []).map((member) => member.username).join(", ")})`);
    const opened = await api.post(`${base}/api/campaigns/${campaignId}/side-chat`, { data: { kind: "dm", memberUserIds: [player.userId] } });
    check(opened.ok(), `the chat with the player (${opened.status()})`);
    const { thread } = await opened.json();
    const say = async (request, content) => {
      const sent = await request.post(`${base}/api/campaigns/${campaignId}/side-chat/${thread.id}/messages`, { data: { content } });
      check(sent.ok(), `a line sent (${sent.status()})`);
    };
    for (let index = 0; index < 30; index += 1) {
      await say(api, `Line ${index + 1} of the plan: the bridge at dusk, the lantern twice, then the north gate.`);
    }

    await t.open(`/campaigns/${campaignId}`);
    await openPanelTab(t, "chat");
    const row = page.locator(`${root}button`).filter({ hasText: ids.player }).locator("visible=true").first();
    await eventually(() => row.isVisible(), { timeoutMs: 20_000, label: "the chat with the player" });
    await t.tap(row);
    const newest = page.locator(`${root}p`).filter({ hasText: "Line 30 of the plan" }).locator("visible=true").first();
    await eventually(() => newest.count(), { timeoutMs: 20_000, label: "the chat's lines" });
    // The chat's own scroller: the nearest one around its lines.
    const list = newest.locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' overflow-y-auto ')][1]");
    const metrics = () => list.evaluate((node) => ({ top: node.scrollTop, gap: node.scrollHeight - node.scrollTop - node.clientHeight, room: node.scrollHeight - node.clientHeight }));
    await eventually(async () => (await metrics()).gap < 4, { label: "the chat opened on its newest line" });
    check((await metrics()).room > 200, `the chat is long enough to scroll (${(await metrics()).room}px)`);

    // Every scroller from the list up to the window, where each stands.
    const scrollers = () => list.evaluate((node) => {
      const tops = [];
      for (let at = node.parentElement; at; at = at.parentElement) tops.push(at.scrollTop);
      return tops.join(",");
    });

    // The reader scrolls back; the player's next line does not pull them down.
    await list.evaluate((node) => {
      node.scrollTop = Math.max(0, node.scrollTop - 200);
      node.dispatchEvent(new Event("scroll"));
    });
    await sleep(200);
    const back = await metrics();
    const around = await scrollers();
    const seat = await page.context().browser().newContext();
    try {
      await signIn(seat, base, ids.player, ids.password);
      await say(seat.request, "The gate is open, come now.");
    } finally {
      await seat.close();
    }
    await eventually(async () => (await list.locator("p").filter({ hasText: "The gate is open" }).count()) > 0, { timeoutMs: 20_000, label: "the player's new line" });
    await sleep(400);
    const after = await metrics();
    check(Math.abs(after.top - back.top) <= 2, `a reader who scrolled back stays where they were (${Math.round(back.top)} then ${Math.round(after.top)})`);
    check((await scrollers()) === around, `nothing around the chat moved (${around} then ${await scrollers()})`);
    await t.shot("scrolled-back");
    for (const theme of ["light", "dark"]) {
      await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
      await untilStill(page);
      const problems = await axeViolations(page, `${root}form:has(textarea[aria-label^="Message "])`.trim());
      check(problems.length === 0, `the chat's box passes axe in the ${theme} theme: ${JSON.stringify(problems)}`);
    }

    // Your own line brings you to the end.
    const field = page.locator(`${root}textarea[aria-label^="Message "]`).locator("visible=true").first();
    await field.fill("On my way.");
    await field.press("Enter");
    await eventually(async () => (await list.locator("p").filter({ hasText: "On my way." }).count()) > 0, { timeoutMs: 20_000, label: "your own line" });
    await eventually(async () => (await metrics()).gap < 4, { label: "your own line brought you to the end" });
    await t.shot("own-line");
  },
};
