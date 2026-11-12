// An admin's password reset (POST /api/admin/users/:id/reset-password) is
// for other accounts. It swaps in a temporary password and ends every
// session of the account, so an admin who reset their own was signed out
// before the temporary password could be read; in the desktop app, whose
// owner signs in with a password the app made up, that locked the owner out
// of their own world (#909).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, vi } from "vitest";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

let admin = null;
vi.mock("@/lib/admin-api", () => ({
  requireAdmin: async () => admin,
  isErrorResponse: (value) => value instanceof Response,
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-admin-self-reset-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.ODM_ENV_FILE = path.join(dir, "no-env-file");

vi.setConfig({ testTimeout: 30_000 });

const { POST } = await import("../src/app/api/admin/users/[userId]/reset-password/route.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { createUser, getUserByUsername, insertSession } = await import("../src/lib/db/users.ts");

const sessions = (userId) =>
  getDatabase().prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?`).get(userId).n;
const reset = (userId) =>
  POST(new Request(`http://localhost/api/admin/users/${userId}/reset-password`, { method: "POST" }), {
    params: Promise.resolve({ userId }),
  });
const later = () => new Date(Date.now() + 60_000).toISOString();

test("an admin cannot reset their own password, and still resets another's", async () => {
  try {
    admin = createUser("owner", "owner-hash", { isAdmin: true });
    const player = createUser("player", "player-hash");
    insertSession("owner-session", admin.id, later());
    insertSession("player-session", player.id, later());

    const own = await reset(admin.id);
    assert.equal(own.status, 400, "the admin's own account is refused");
    assert.match((await own.json()).error, /your own password/);
    const kept = getUserByUsername("owner");
    assert.equal(kept.passwordHash, "owner-hash", "the password the app signs in with is untouched");
    assert.equal(kept.mustChangePassword, false);
    assert.equal(sessions(admin.id), 1, "and the admin stays signed in");

    const other = await reset(player.id);
    assert.equal(other.status, 200);
    assert.ok((await other.json()).tempPassword, "another account gets its temporary password");
    const changed = getUserByUsername("player");
    assert.notEqual(changed.passwordHash, "player-hash");
    assert.equal(changed.mustChangePassword, true);
    assert.equal(sessions(player.id), 0, "and is signed out everywhere");
  } catch (error) {
    removeTempDir(dir);
    throw error;
  }
});

test("in a world one of the apps hosts, the refusal does not send the host to a Password section it lacks", async () => {
  try {
    process.env.ODM_DEVICE_WORLD = "1";
    const own = await reset(admin.id);
    assert.equal(own.status, 400);
    const { error } = await own.json();
    assert.match(error, /your own password/);
    assert.doesNotMatch(error, /Settings/, "Settings has no Password section in a device world");
  } finally {
    delete process.env.ODM_DEVICE_WORLD;
    removeTempDir(dir);
  }
});
