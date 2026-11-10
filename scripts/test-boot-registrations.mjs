// The server loads a route when it is first asked for
// (preloadEntriesOnStart: false in next.config.ts), so a module is no longer
// loaded merely because some route imports it. A dozen modules register a
// hook as they load (registerDmWaker, onTurnWorkDone, the item-cast store on
// globalThis and the like), which is how two modules that cannot import each
// other meet. If one of them were loaded only by a route nobody had asked for
// yet, the code that calls its hook would find nothing there and carry on
// without it: no error, a rule quietly not applied.
//
// So every server module that registers as it loads must be among what the
// server imports at start (src/instrumentation.ts), reached by imports that
// survive compilation: a type-only import loads nothing. A module that is
// loaded later on purpose is named below with why that is enough.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const src = path.join(import.meta.dirname, "..", "src");

// Registered on first use, by design.
const LOADED_LATER = {
  // Its own comment proves it: rooms and peers exist only through joinRoom
  // in that module, the registry is in memory, and the hook does nothing at
  // zero peers, so no event can have anything to act on before it loads.
  "lib/voice/peers.ts": "the voice hook, set by the first voice request",
};

function resolveImport(from, specifier) {
  let base;
  if (specifier.startsWith("@/")) base = path.join(src, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const read = new Map();

// What a file imports once compiled (an import used only as a type is gone,
// as the bundler drops it), the modules it imports inside a function, and
// the statements at its top level that register something: a bare call, or
// an assignment to globalThis.
function moduleOf(file) {
  const known = read.get(file);
  if (known) return known;
  const info = { imports: [], dynamic: [], registers: [], client: false };
  read.set(file, info);
  if (!/\.tsx?$/.test(file) || file.endsWith(".d.ts")) return info;
  const text = fs.readFileSync(file, "utf8");
  info.client = /^\s*["']use client["']/.test(text);
  const compiled = ts.transpileModule(text, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.Preserve, isolatedModules: true },
  }).outputText;
  const js = ts.createSourceFile(`${file}.js`, compiled, ts.ScriptTarget.ESNext, true, file.endsWith("x") ? ts.ScriptKind.JSX : ts.ScriptKind.JS);
  for (const statement of js.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier) {
      info.imports.push(statement.moduleSpecifier.text);
    } else if (ts.isExpressionStatement(statement)) {
      const expression = statement.expression;
      const assignsGlobal = ts.isBinaryExpression(expression) && expression.left.getText(js).startsWith("globalThis.");
      if (ts.isCallExpression(expression) || assignsGlobal) {
        info.registers.push(statement.getText(js).split("\n")[0]);
      }
    }
  }
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      info.dynamic.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(js);
  return info;
}

function reachedFrom(roots) {
  const seen = new Set();
  const stack = [...roots];
  while (stack.length) {
    const file = stack.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    for (const specifier of moduleOf(file).imports) stack.push(resolveImport(file, specifier));
  }
  return seen;
}

let passed = 0;
function test(name, body) {
  body();
  passed += 1;
  console.log(`ok: ${name}`);
}

const rel = (file) => path.relative(src, file).split(path.sep).join("/");

test("the reader follows the imports that load code and sees a registration at a module's top level", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-boot-registrations-"));
  try {
    fs.writeFileSync(path.join(dir, "hook.ts"), `export type Hook = () => void;\nexport function registerHook(hook: Hook) {}\n`);
    fs.writeFileSync(
      path.join(dir, "registrar.ts"),
      `import { registerHook, type Hook } from "./hook";\nconst mine: Hook = () => {};\nregisterHook(mine);\nglobalThis.__sample = mine;\nexport const value = 1;\n`,
    );
    fs.writeFileSync(path.join(dir, "types-only.ts"), `import type { Hook } from "./hook";\nimport { value } from "./registrar";\nexport type Kept = Hook | typeof value;\n`);
    fs.writeFileSync(path.join(dir, "lazy.ts"), `export async function later() {\n  return import("./registrar");\n}\n`);
    assert.deepEqual(moduleOf(path.join(dir, "registrar.ts")).registers, ["registerHook(mine);", "globalThis.__sample = mine;"]);
    assert.deepEqual(moduleOf(path.join(dir, "hook.ts")).registers, []);
    // An import used only for its types loads nothing, and neither does one made inside a function.
    assert.deepEqual([...reachedFrom([path.join(dir, "types-only.ts")])].map((file) => path.basename(file)), ["types-only.ts"]);
    assert.deepEqual([...reachedFrom([path.join(dir, "lazy.ts")])].map((file) => path.basename(file)), ["lazy.ts"]);
    assert.deepEqual(moduleOf(path.join(dir, "lazy.ts")).dynamic, ["./registrar"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const instrumentation = path.join(src, "instrumentation.ts");
const atStart = reachedFrom(moduleOf(instrumentation).dynamic.map((specifier) => resolveImport(instrumentation, specifier)));

const routes = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === "route.ts") routes.push(full);
  }
})(path.join(src, "app"));
const served = reachedFrom(routes);
const registrars = [...served].filter((file) => !file.endsWith("route.ts") && !moduleOf(file).client && moduleOf(file).registers.length > 0).sort();

test("the server still registers hooks as modules load, so this suite has something to hold", () => {
  assert.ok(routes.length > 100, `only ${routes.length} routes found under src/app`);
  assert.ok(registrars.length >= 10, `only ${registrars.length} registering modules found: ${registrars.map(rel).join(", ")}`);
  assert.ok(atStart.size > 500, `the start reaches only ${atStart.size} modules`);
});

test("every module that registers a hook as it loads is loaded at start, or named with why later is enough", () => {
  const late = registrars.filter((file) => !atStart.has(file)).map(rel);
  const unexplained = late.filter((file) => !Object.hasOwn(LOADED_LATER, file));
  assert.deepEqual(
    unexplained,
    [],
    `loaded only when a route that imports it is first asked for, so its hook can be missing when called: ${unexplained
      .map((file) => `${file} (${moduleOf(path.join(src, file)).registers.join("; ")})`)
      .join(", ")}. Import it in src/instrumentation.ts, or name it in LOADED_LATER with the reason.`,
  );
});

test("a module named as loaded later still exists, registers, and is not loaded at start after all", () => {
  for (const file of Object.keys(LOADED_LATER)) {
    const full = path.join(src, file);
    assert.ok(fs.existsSync(full), `${file} is gone: strike it from LOADED_LATER`);
    assert.ok(moduleOf(full).registers.length > 0, `${file} registers nothing now: strike it from LOADED_LATER`);
    assert.ok(!atStart.has(full), `${file} is loaded at start now: strike it from LOADED_LATER`);
  }
});

console.log(`\n${passed} boot registration tests passed`);
