// A second reading for JSON a small model almost got right. The arc's
// planners reply in JSON, and on the default local model about one reply in
// four came back with one small slip in it, always of the same few kinds:
// a closing brace too many between two list entries, a comma before a
// closing brace, or a stray quote in front of an object or of the brace
// that closes one. Strict parsing threw the whole plan away for it, and a
// campaign went without its spine, or a table sat in an act's aftermath,
// until the next attempt.
//
// This reads exactly those slips and nothing looser: it never closes what
// a reply left open (a reply cut short is still unreadable), and it is
// only ever tried after JSON.parse has refused the text, so a well-formed
// reply reads exactly as it always did. What comes out is still checked
// field by field by the caller's own parser.
//
// Pure and alias-free, so the test scripts load it directly.

class Unreadable extends Error {}

export function parseJsonLeniently(source: string): unknown | undefined {
  let at = source.indexOf("{");
  if (at < 0) {
    return undefined;
  }

  const skipSpace = () => {
    while (at < source.length && /\s/.test(source[at])) {
      at += 1;
    }
  };

  // The string whose opening quote is at `at`; leaves `at` past its close.
  const readString = (): string => {
    const start = at;
    at += 1;
    while (at < source.length && source[at] !== '"') {
      at += source[at] === "\\" ? 2 : 1;
    }
    if (at >= source.length) {
      throw new Unreadable();
    }
    at += 1;
    const token = source.slice(start, at);
    try {
      return JSON.parse(token) as string;
    } catch {
      // A raw line break or tab inside the quotes: the text as written.
      return token.slice(1, -1);
    }
  };

  const readValue = (): unknown => {
    skipSpace();
    const ch = source[at];
    if (ch === "{") {
      return readObject();
    }
    if (ch === "[") {
      return readArray();
    }
    if (ch === '"') {
      return readString();
    }
    const literal = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(source.slice(at, at + 40));
    if (!literal) {
      throw new Unreadable();
    }
    at += literal[0].length;
    return JSON.parse(literal[0]);
  };

  const readObject = (): Record<string, unknown> => {
    at += 1;
    const out: Record<string, unknown> = {};
    for (;;) {
      skipSpace();
      if (at >= source.length) {
        throw new Unreadable();
      }
      const ch = source[at];
      if (ch === "}") {
        at += 1;
        return out;
      }
      // A comma with nothing after it: `"hooks": [],}`.
      if (ch === ",") {
        at += 1;
        continue;
      }
      let key: string;
      if (ch === '"') {
        const start = at;
        key = readString();
        skipSpace();
        if (source[at] !== ":") {
          // Not a key at all but structure behind a stray quote
          // (`"hooks": [],"},{"title": ...`): the quote is dropped and the
          // brace it hid closes this object.
          if (/^\s*[{}[\]]/.test(key)) {
            at = start + 1;
            continue;
          }
          throw new Unreadable();
        }
      } else {
        // A key that lost its opening quote to the slip above (`{text": ...`).
        const bare = /^[A-Za-z_]\w*/.exec(source.slice(at, at + 80));
        if (!bare) {
          throw new Unreadable();
        }
        key = bare[0];
        at += key.length;
        if (source[at] === '"') {
          at += 1;
        }
        skipSpace();
        if (source[at] !== ":") {
          throw new Unreadable();
        }
      }
      at += 1;
      out[key] = readValue();
    }
  };

  const readArray = (): unknown[] => {
    at += 1;
    const out: unknown[] = [];
    for (;;) {
      skipSpace();
      if (at >= source.length) {
        throw new Unreadable();
      }
      const ch = source[at];
      if (ch === "]") {
        at += 1;
        return out;
      }
      // A doubled comma, or a closing brace too many between two entries
      // (`{...}]}},{...}`).
      if (ch === "," || ch === "}") {
        at += 1;
        continue;
      }
      if (ch === '"') {
        const start = at;
        const text = readString();
        skipSpace();
        // An object behind a stray quote (`},"{"name": ...`): what read as
        // a string is its opening brace, and what follows it is not what
        // follows a list entry.
        if (source[at] !== "," && source[at] !== "]" && /^\s*[{[]/.test(text)) {
          at = start + 1;
          continue;
        }
        out.push(text);
        continue;
      }
      out.push(readValue());
    }
  };

  try {
    return readObject();
  } catch (error) {
    if (error instanceof Unreadable || error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}
