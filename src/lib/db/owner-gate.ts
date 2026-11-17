// One owner per thing in the game (docs/specs/ogm-domain-owners.md): the gate
// a sheet write passes. A write that changes a domain's fields is its owner's,
// and only the owner opens the gate (src/lib/owners/). The import of ownerWrite
// is held to the owners by scripts/test-domain-owners.mjs; the check below
// catches a writer that builds its patch where no grep can see it.
//
// Strict (OGM_OWNER_GATE=strict, the test suites) refuses the write. Elsewhere
// the write goes through and the stray writer is named once in the log, so a
// table in play never loses a turn to a writer the migration has not reached.

export type OwnedDomain = "items";

const FIELDS: Record<OwnedDomain, readonly string[]> = {
  items: ["equipment", "gold", "copper"],
};

let open: OwnedDomain | null = null;

// Run fn with the domain's gate open; synchronous like the sheet writes it wraps.
export function ownerWrite<T>(domain: OwnedDomain, fn: () => T): T {
  const before = open;
  open = domain;
  try {
    return fn();
  } finally {
    open = before;
  }
}

const named = new Set<string>();

// Called by patchSheet before it writes: the domain fields this patch changes
// without their owner, refused or named.
export function checkOwnedFields(patch: Record<string, unknown>) {
  for (const [domain, fields] of Object.entries(FIELDS) as [OwnedDomain, readonly string[]][]) {
    if (open === domain) {
      continue;
    }
    const touched = fields.filter((field) => patch[field] !== undefined);
    if (touched.length === 0) {
      continue;
    }
    const where = new Error().stack?.split("\n").slice(3, 4).join("").trim() ?? "";
    const message = `${touched.join(", ")} written outside the ${domain} owner (src/lib/owners/${domain}.ts) ${where}`;
    if (process.env.OGM_OWNER_GATE === "strict") {
      throw new Error(message);
    }
    if (!named.has(where)) {
      named.add(where);
      console.warn(`[owner-gate] ${message}`);
    }
  }
}

// A patch cut in two: the fields a domain's owner writes, and the rest the
// caller still writes itself. Pure: it opens no gate.
export function splitOwnedFields<T extends Record<string, unknown>>(domain: OwnedDomain, patch: T): { owned: Partial<T>; rest: Partial<T> } {
  const owned: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    (FIELDS[domain].includes(key) ? owned : rest)[key] = value;
  }
  return { owned: owned as Partial<T>, rest: rest as Partial<T> };
}
