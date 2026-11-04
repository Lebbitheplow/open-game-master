// The player receiver's own place for its ODM token, so a player does not
// have to write a credential helper (docs/player-webhooks.md). The token is
// kept where the operating system protects it for this user account:
// - Windows: DPAPI (CurrentUser), in the receiver's private state directory;
// - macOS: the login keychain, through `security`;
// - Linux: the Secret Service (GNOME Keyring, KWallet), through `secret-tool`.
// It never goes on a command line, in the config, or to the terminal. A
// config with its own authCommand keeps using that instead.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const TOKEN_SERVICE = "odm-player-receiver";
const TOKEN = /^odm_[A-Za-z0-9_-]{20,200}$/;

export function validToken(value) {
  return typeof value === "string" && TOKEN.test(value);
}

// A program that did not finish in its time and was stopped. Told apart from
// a refusal, so the message says it was slow rather than that it said no.
export class RunTimeout extends Error {
  constructor(command, timeout) {
    super(`${command} did not finish within ${Math.round(timeout / 1000)} seconds.`);
    this.name = "RunTimeout";
  }
}

// Runs a program with text on its standard input; resolves its exit code and
// standard output. Standard error is dropped: it can echo what it was given.
// One stopped for running past `timeout` rejects with RunTimeout: it used to
// resolve as an ordinary failure, so a slow PowerShell read as "Windows could
// not protect the token".
export function runWithInput(command, args, input, timeout = 20_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    let stdout = "";
    let late = false;
    const timer = setTimeout(() => { late = true; child.kill(); }, timeout);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { if (stdout.length < 16_384) stdout += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (late) reject(new RunTimeout(command, timeout));
      else resolve({ code, stdout });
    });
    child.stdin.end(input);
  });
}

const POWERSHELL = "powershell.exe";
// Windows PowerShell starting cold and loading System.Security can take well
// over twenty seconds on a busy machine (a CI runner with four suites at
// once was stopped at twenty mid-protect). Setup waits on a person anyway.
const POWERSHELL_TIMEOUT = 90_000;
// What a stopped program means to the person running setup.
const slow = (error, what) => {
  if (error instanceof RunTimeout) throw new Error(`${what} took too long: ${error.message} Try again; nothing was saved.`);
  throw error;
};
const PS_START = "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$i=[Console]::In.ReadToEnd().Trim();";
const PS_SCOPE = "[Security.Cryptography.DataProtectionScope]::CurrentUser";
const PROTECT = `${PS_START}$p=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($i),$null,${PS_SCOPE});[Console]::Out.Write([Convert]::ToBase64String($p))`;
const UNPROTECT = `${PS_START}$p=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($i),$null,${PS_SCOPE});[Console]::Out.Write([Text.Encoding]::UTF8.GetString($p))`;

// One store entry per receiver state directory, so several receivers on one
// computer (one per seated agent) keep separate tokens.
export function tokenStore(directory, { platform = process.platform, run = runWithInput } = {}) {
  const account = createHash("sha256").update(path.resolve(directory)).digest("hex").slice(0, 32);
  const checked = (token) => {
    if (!validToken(token)) throw new Error("The stored token is missing or damaged. Run --save-token again.");
    return token;
  };

  if (platform === "win32") {
    const file = path.join(directory, "token.dpapi");
    return {
      where: "Windows' protected storage for this user (DPAPI)",
      async save(token) {
        const { code, stdout } = await run(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", PROTECT], token, POWERSHELL_TIMEOUT).catch((error) => slow(error, "Protecting the token"));
        if (code !== 0 || !stdout.trim()) throw new Error("Windows could not protect the token.");
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        writeFileSync(`${file}.tmp`, stdout.trim(), { mode: 0o600 });
        renameSync(`${file}.tmp`, file);
      },
      async read() {
        if (!existsSync(file)) throw new Error("No token is saved for this receiver. Run --setup or --save-token.");
        const { code, stdout } = await run(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", UNPROTECT], readFileSync(file, "utf8"), POWERSHELL_TIMEOUT).catch((error) => slow(error, "Reading the protected token"));
        if (code !== 0) throw new Error("Windows could not unprotect the token; it was saved by another user account.");
        return checked(stdout.trim());
      },
    };
  }

  if (platform === "darwin") {
    return {
      where: "the macOS keychain",
      async save(token) {
        // security -i reads the command from standard input, so the token is
        // never an argument another process could list. Tokens are
        // odm_ plus base64url, with nothing to quote.
        const { code } = await run("security", ["-i"], `add-generic-password -U -a ${account} -s ${TOKEN_SERVICE} -w ${checkedInput(token)}\n`);
        if (code !== 0) throw new Error("The keychain did not take the token.");
      },
      async read() {
        const { code, stdout } = await run("security", ["find-generic-password", "-a", account, "-s", TOKEN_SERVICE, "-w"], "");
        if (code !== 0) throw new Error("No token is saved for this receiver. Run --setup or --save-token.");
        return checked(stdout.trim());
      },
    };
  }

  return {
    where: "the Secret Service keyring (secret-tool)",
    async save(token) {
      let result;
      try {
        result = await run("secret-tool", ["store", "--label=ODM player receiver", "service", TOKEN_SERVICE, "account", account], checkedInput(token));
      } catch (error) {
        if (error instanceof RunTimeout) slow(error, "The keyring (waiting on an unlock prompt?)");
        throw new Error("secret-tool is not installed. Install libsecret-tools (or your distribution's libsecret package), or give the config an authCommand.");
      }
      if (result.code !== 0) throw new Error("The keyring did not take the token. Is a keyring unlocked in this session?");
    },
    async read() {
      let result;
      try {
        result = await run("secret-tool", ["lookup", "service", TOKEN_SERVICE, "account", account], "");
      } catch (error) {
        if (error instanceof RunTimeout) slow(error, "The keyring (waiting on an unlock prompt?)");
        throw new Error("secret-tool is not installed, so no saved token can be read.");
      }
      if (result.code !== 0) throw new Error("No token is saved for this receiver. Run --setup or --save-token.");
      return checked(result.stdout.trim());
    },
  };
}

function checkedInput(token) {
  if (!validToken(token)) throw new Error("That is not an ODM connection token (they start with odm_).");
  return token;
}

// Saves a token, then reads it back, so a store that silently refused (a
// locked keyring, an interactive command that reported nothing) is caught now
// rather than at the first webhook.
export async function saveToken(store, token) {
  await store.save(checkedInput(token));
  let back;
  try { back = await store.read(); } catch { back = null; }
  if (back !== token) throw new Error(`The token did not read back from ${store.where}.`);
}

// Reads a secret from the terminal without echoing it. Input that is not a
// terminal (a pipe, or a console that is not one) is read whole, up to its
// end; the question still goes out first, so a console that is not a
// terminal does not sit there silently. Bracketed-paste markers are dropped.
export function promptSecret(question, input = process.stdin, output = process.stderr) {
  const clean = (text) => text.replace(/\x1b\[20[01]~/g, "").trim();
  if (!input.isTTY) {
    output.write(`${question}\n(Reading to the end of input: paste, then press Ctrl+D, or Ctrl+Z and Enter on Windows. Your console may show what you paste.)\n`);
    return new Promise((resolve, reject) => {
      let text = "";
      input.setEncoding("utf8");
      input.on("data", (chunk) => { text += chunk; });
      input.on("end", () => resolve(clean(text)));
      input.on("error", reject);
    });
  }
  return new Promise((resolve, reject) => {
    output.write(question);
    let value = "";
    const finish = (error) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
      if (error) reject(error); else resolve(clean(value));
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") { finish(); return; }
        if (char === "\u0003") { finish(new Error("Cancelled.")); return; }
        if (char === "\u007f" || char === "\b") { value = value.slice(0, -1); continue; }
        value += char;
      }
    };
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.resume();
    input.on("data", onData);
  });
}
