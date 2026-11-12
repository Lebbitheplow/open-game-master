// A world one of the apps hosts belongs to the device that runs it, and its
// host's account is the world's first: the app made up its password and
// signs in with it. Another admin the host made can neither demote, reset
// nor delete that account (each locked the app out of its own world, or
// left it nobody to recover). Settings > Delete account there takes the
// signed-in session as proof, since nobody was ever shown the password.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, vi } from "vitest";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

let admin = null;
let current = null;
vi.mock("@/lib/admin-api", () => ({
  requireAdmin: async () => admin,
  isErrorResponse: (value) => value instanceof Response,
}));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal()),
  currentUser: async () => current,
  endSession: async () => {},
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-device-world-host-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.ODM_ENV_FILE = path.join(dir, "no-env-file");

vi.setConfig({ testTimeout: 30_000 });

const userRoute = await import("../src/app/api/admin/users/[userId]/route.ts");
const { POST: resetRoute } = await import("../src/app/api/admin/users/[userId]/reset-password/route.ts");
const { GET: listRoute } = await import("../src/app/api/admin/users/route.ts");
const { DELETE: deleteOwn } = await import("../src/app/api/profile/route.ts");
const { hashPassword } = await import("../src/lib/auth.ts");
const { createUser, getUserById } = await import("../src/lib/db/users.ts");

const host = createUser("host", await hashPassword("app-made-secret"), { isAdmin: true });
// A tick apart, so the host is the world's first account by creation time.
await new Promise((resolve) => setTimeout(resolve, 5));
const coAdmin = createUser("coadmin", await hashPassword("coadmin-secret"), { isAdmin: true });
const guest = createUser("guest", await hashPassword("guest-secret"));

const ctx = (userId) => ({ params: Promise.resolve({ userId }) });
const demote = (userId) =>
  userRoute.PATCH(
    new Request(`http://localhost/api/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify({ isAdmin: false }) }),
    ctx(userId),
  );
const remove = (userId) => userRoute.DELETE(new Request(`http://localhost/api/admin/users/${userId}`, { method: "DELETE" }), ctx(userId));
const reset = (userId) => resetRoute(new Request(`http://localhost/api/admin/users/${userId}/reset-password`, { method: "POST" }), ctx(userId));
const deleteMine = (body) =>
  deleteOwn(new Request("http://localhost/api/profile", { method: "DELETE", body: JSON.stringify(body) }));

test("in a device world, another admin cannot demote, reset or delete the host", async () => {
  process.env.ODM_DEVICE_WORLD = "1";
  admin = coAdmin;
  for (const attempt of [demote, reset, remove]) {
    const response = await attempt(host.id);
    assert.equal(response.status, 403, attempt.name);
    assert.match((await response.json()).error, /device that hosts it/);
  }
  const kept = getUserById(host.id);
  assert.equal(kept.isAdmin, true);
  assert.equal(kept.mustChangePassword, false);

  // The host still manages everyone else, and a co-admin still manages guests.
  admin = host;
  assert.equal((await demote(coAdmin.id)).status, 200);
  admin = coAdmin;
  assert.equal((await reset(guest.id)).status, 200);
});

test("the admin list marks the host in a device world only", async () => {
  process.env.ODM_DEVICE_WORLD = "1";
  admin = host;
  const marked = (await (await listRoute()).json()).users.filter((user) => user.isHost).map((user) => user.username);
  assert.deepEqual(marked, ["host"]);
  delete process.env.ODM_DEVICE_WORLD;
  const none = (await (await listRoute()).json()).users.filter((user) => user.isHost);
  assert.deepEqual(none, []);
});

test("on a server somebody runs, the first account is an account like any other", async () => {
  delete process.env.ODM_DEVICE_WORLD;
  admin = host;
  assert.equal((await userRoute.PATCH(
    new Request(`http://localhost/api/admin/users/${coAdmin.id}`, { method: "PATCH", body: JSON.stringify({ isAdmin: true }) }),
    ctx(coAdmin.id),
  )).status, 200);
  admin = coAdmin;
  assert.equal((await demote(host.id)).status, 200);
});

test("Settings > Delete account takes the session as proof in a device world, and the password elsewhere", async () => {
  try {
    delete process.env.ODM_DEVICE_WORLD;
    current = guest;
    const refused = await deleteMine({});
    assert.equal(refused.status, 400, "a server somebody runs still asks for the password");
    process.env.ODM_DEVICE_WORLD = "1";
    const scheduled = await deleteMine({});
    assert.equal(scheduled.status, 200);
    assert.ok((await scheduled.json()).dueAt, "the grace period is kept");
    assert.ok(getUserById(guest.id).deletionDueAt);
  } finally {
    delete process.env.ODM_DEVICE_WORLD;
    removeTempDir(dir);
  }
});
