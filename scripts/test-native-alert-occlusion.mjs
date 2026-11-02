// A native board view is a window drawn over the page, so the page names the
// rectangles that must stay above it (src/lib/addons/native-board-client.ts):
// the X-card's pause (an alertdialog), a table break's banner with its
// Resume, the composer's @ menu (a listbox), and an overlay measured again
// once its entrance has finished moving it.
import assert from "node:assert/strict";
import { register } from "node:module";
register("./lib/register-alias.mjs", import.meta.url);
const { attachNativeBoard } = await import("../src/lib/addons/native-board-client.ts");

// A page element the selector list either names or does not.
const element = (selector, box) => {
  const node = {
    selector,
    box,
    getAttribute: (name) => (name === "role" && selector.startsWith("[role=") ? selector.slice(7, -2) : null),
    contains: () => false,
    getClientRects: () => [node.box],
    closest: () => null,
    getBoundingClientRect: () => node.box,
  };
  return node;
};
const alert = element('[role="alertdialog"]', { x: 10, y: 20, width: 30, height: 40 });
const banner = element(".session-banner", { x: 20, y: 0, width: 60, height: 12 });
const names = element('[role="listbox"]', { x: 50, y: 60, width: 30, height: 30 });
const status = element('[role="status"]', { x: 5, y: 5, width: 10, height: 10 });
const page = [alert, banner, names, status];

const listeners = new Map();
const frame = { getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 100 }), toggleAttribute() {}, contentWindow: { postMessage() {} } };
globalThis.document = {
  body: {},
  visibilityState: "visible",
  // Each selector in the list the page is asked for, in page order.
  querySelectorAll: (selectors) => page.filter((entry) => selectors.split(",").includes(entry.selector)),
  addEventListener: (type, fn) => listeners.set(type, fn),
  removeEventListener: (type) => listeners.delete(type),
};
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.getComputedStyle = () => ({ visibility: "visible", pointerEvents: "auto" });
globalThis.devicePixelRatio = 1;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

let layout;
let receive;
const api = { open: async () => ({ id: "test" }), subscribe: (_id, fn) => ((receive = fn), () => {}), layout: (_id, data) => (layout = data), send() {}, close: async () => {} };
const detach = attachNativeBoard(frame, api, { addonId: "test", viewId: "board" }, () => {});
for (let i = 0; i < 20 && !receive; i++) await new Promise((resolve) => setTimeout(resolve, 5));
assert(receive, "native board opened");
receive({ odm: 1, type: "ready" });
assert.deepEqual(
  layout.occlusions,
  [alert.box, banner.box, names.box],
  "the X-card's pause, a table break's banner and the @ menu stay above the native board; a bare status line does not cut it",
);

// The banner slides in: measured as it mounts, it is measured again when its
// entrance ends, though nothing the observer watches changed.
banner.box = { x: 20, y: 8, width: 60, height: 12 };
assert.ok(listeners.has("animationend") && listeners.has("transitionend"), "the end of an entrance is heard");
listeners.get("animationend")();
assert.deepEqual(layout.occlusions[1], banner.box, "re-measured where its entrance left it");

detach();
assert.ok(!listeners.has("animationend") && !listeners.has("transitionend"), "nothing is heard once the view is gone");
console.log("ok: alert dialogs, floating banners and listboxes stay above a native board view, measured where their entrance ends");
