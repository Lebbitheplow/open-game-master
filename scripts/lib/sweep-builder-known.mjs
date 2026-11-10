// The builder sweep's known gaps and skips, by suite. Each group names the
// rule a row breaks, where the fix goes, and the rows that fail for that one
// cause today (scripts/lib/sweep-builder-rows.mjs expand()).

export const KNOWN_FILL_CLASSES = [];
export const SKIP_FILL_CLASSES = {};

export const KNOWN_FILL_SUBCLASSES_A = [];
export const SKIP_FILL_SUBCLASSES_A = {};

export const KNOWN_FILL_SUBCLASSES_B = [];
export const SKIP_FILL_SUBCLASSES_B = {};

export const KNOWN_FILL_SPECIES = [];
export const SKIP_FILL_SPECIES = {};

export const KNOWN_FILL_BACKGROUNDS = [];
export const SKIP_FILL_BACKGROUNDS = {};

export const KNOWN_FILL_NOPACK = [];
export const SKIP_FILL_NOPACK = {};

export const KNOWN_PACK_PARITY = [];

export const KNOWN_TRAINING_TEXT = [];

// The coin writers scan (test-enforce-sweep-builder-coin.mjs). Open pull
// request #895 removes this writer; the row closes when it merges.
export const KNOWN_COIN = [
  {
    id: "receipt-writes-silver-as-copper",
    rule:
      "src/lib/srd/currency.ts formatPrice writes a sum in gold, silver and copper; the builder's gear receipt writes \"Spent\" with it and \"Coin left\" with a writer of its own, so 3 gp 9 sp reads \"3 gp 90 cp\".",
    where: "src/app/characters/builder/receiptMath.ts formatCoin (called by GearReceipt.tsx for Starting coin and Coin left)",
    severity: "low",
    note: "formatCoin(390) is \"3 gp 90 cp\"; formatPrice(390) is \"3 gp 9 sp\".",
    rows: ["coin:src/app/characters/builder/receiptMath.ts#formatCoin"],
  },
];
