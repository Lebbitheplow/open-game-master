// Prefetches the app's local embedding model (EMBEDDING_MODEL, else the one the
// server's language picks: MiniLM for English, multilingual-e5-small for any
// other) into models/embeddings so the app has it warm before the first live
// embed.
// The model is no longer bundled in git; transformers.js also auto-downloads it
// on first use, but running this once (online) is handy for offline setups.
// Usage: npm run fetch-model [-- --language french]
import path from "node:path";
import { embed, embeddingModelId, setEmbeddingLanguage } from "../src/lib/embeddings.ts";
import { TABLE_LANGUAGES } from "../src/lib/schemas/game-settings-options.ts";

const flag = process.argv.indexOf("--language");
const language = flag >= 0 ? process.argv[flag + 1] : "english";
if (!TABLE_LANGUAGES.includes(language)) {
  console.error(`[fetch-embedding-model] --language takes one of: ${TABLE_LANGUAGES.join(", ")}`);
  process.exit(1);
}
setEmbeddingLanguage(language);
const MODEL_ID = embeddingModelId();

const cacheDir = path.join(process.cwd(), "models", "embeddings");
console.log(`[fetch-embedding-model] downloading ${MODEL_ID} into ${cacheDir} ...`);
await embed(["warm-up"]);
console.log("[fetch-embedding-model] done.");
