// Local fixture only: new disposable database on every run, no API keys or AI calls.
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { register } from "node:module";
import { repo, theme, port, origin, output } from "./options.mjs";

process.chdir(repo);
await mkdir(output, { recursive: true });
const fixture = await mkdtemp(path.join(output, "fixture-"));
process.env.SQLITE_DB_PATH = path.join(fixture, "preview.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.NEXT_TELEMETRY_DISABLED = "1";
register("../lib/register-routes.mjs", import.meta.url);
const { createUser } = await import("../../src/lib/db/users.ts");
const { hashPassword } = await import("../../src/lib/auth.ts");
const { createCampaign } = await import("../../src/lib/db/campaigns.ts");
const { getDatabase } = await import("../../src/lib/db/core.ts");
const user = createUser("theme_preview", await hashPassword("ThemePreview2026!"));
const lobby = createCampaign(user.id, {
  title: "Theme validation · Lobby", description: "A fictional campaign for visual review.",
  theme: "Ancient forest", maxPlayers: 4, startingLevel: 3, difficulty: "normal",
  gameSettings: { appearanceTheme: theme, genre: "high_fantasy", dmMode: "human", aiStorySetup: false, ttsEnabled: false, ambienceEnabled: false },
});
const { seedPlay } = await import("./seed-play.mjs");
const { seedValidation } = await import("./seed-validation.mjs");
const play = await seedPlay(user, theme);
await seedValidation(play, theme);
getDatabase().close();
console.log(`Theme preview: ${theme}\nLobby: ${origin}/campaigns/${lobby.id}\nSign in: theme_preview / ThemePreview2026!\nDisposable files: ${output}`);
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: repo, env: process.env, stdio: "inherit", windowsHide: true,
});
server.on("error", error => { console.error(error.message); process.exitCode = 1; });
server.on("exit", code => { process.exitCode = code ?? 0; });
// Next's dev process owns a worker. Stop the process tree we started on Windows.
function stop() {
  if (!server.pid || server.exitCode !== null) return;
  if (process.platform === "win32") spawn(path.join(process.env.SystemRoot ?? "C:/Windows", "System32/taskkill.exe"), ["/pid", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else server.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
