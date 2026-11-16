import path from "node:path";
import { register } from "node:module";
register("../lib/register-alias.mjs", import.meta.url);
const { isAppearanceTheme, appearanceDefinition } = await import("../../src/lib/appearance-themes.ts");

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}
export const repo = path.resolve(import.meta.dirname, "../..");
export const theme = argument("theme", "woodland");
if (!isAppearanceTheme(theme)) throw new Error(`Unknown theme: ${theme}. Register it in src/lib/appearance-themes.ts first.`);
export const definition = appearanceDefinition(theme);
export const port = Number(argument("port", "3016"));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port must be an integer between 1024 and 65535");
export const origin = `http://127.0.0.1:${port}`;
export const output = path.join(repo, ".theme-preview", theme);
export const browserPath = argument("browser", process.env.THEME_BROWSER);
