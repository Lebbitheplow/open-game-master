// Import this before scripts/lib/enforce-world.mjs to run a suite the way a
// server without the content pack runs (and the way CI does): the world
// helper keeps a CONTENT_DB_PATH that is already set.
process.env.CONTENT_DB_PATH = "/nonexistent";
