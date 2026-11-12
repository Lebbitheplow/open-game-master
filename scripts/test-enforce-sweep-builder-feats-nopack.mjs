// Builder sweep, part 2: every bundled feat on a server without the content
// pack (test-enforce-sweep-builder-feats.mjs says what each row is held to).
import "./lib/sweep-builder-nopack.mjs";
await import("./test-enforce-sweep-builder-feats.mjs");
