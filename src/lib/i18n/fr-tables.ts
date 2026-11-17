// The French name tables beside the catalog: the official SRD 5.1 names
// (src/lib/content/names-fr.ts), our own translations of the rest
// (names-fr-translated.ts) and the class resources' lines
// (src/lib/srd/class-resources-fr-data.ts). About 27 KiB gzip together, so they
// are installed with the catalog rather than imported by the readers
// (translate.ts says where and when), and read English until they are in.
export type FrTables = {
  names: Record<string, Record<string, string>>;
  translated: Record<string, Record<string, string>>;
  resources: Record<string, { name: string; guidance: string }>;
};

const STORE = "__odmFrTables";

export function installFrTables(tables: FrTables): void {
  (globalThis as typeof globalThis & { [STORE]?: FrTables })[STORE] = tables;
}

export function frTables(): FrTables | null {
  return (globalThis as typeof globalThis & { [STORE]?: FrTables })[STORE] ?? null;
}
