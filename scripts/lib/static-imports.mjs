// The files a page's first load reaches: its static imports and re-exports,
// followed through "@/" and relative paths, from the entry down. A type-only
// import brings no code and is not followed. The suites use it to hold a
// heavy module out of a page that never runs it (the bundle budget says a
// page grew; this says which import did it).
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");

function resolveFrom(from, spec) {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

// entry is relative to src/ ("app/campaigns/[campaignId]/table/page.tsx");
// the result holds paths relative to src/ too.
export function staticImports(entry) {
  const reached = new Set();
  const walk = (file) => {
    if (reached.has(file) || !/\.tsx?$/.test(file)) return;
    reached.add(file);
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gms)) {
      const next = resolveFrom(file, match[1]);
      if (next) walk(next);
    }
  };
  walk(path.join(SRC, entry));
  return new Set([...reached].map((file) => path.relative(SRC, file).split(path.sep).join("/")));
}
