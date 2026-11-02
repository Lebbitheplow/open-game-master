export const SEXES = ["Female", "Male"] as const;
export type Sex = (typeof SEXES)[number];

export function storedSex(value: unknown): Sex | undefined {
  return SEXES.includes(value as Sex) ? value as Sex : undefined;
}

// A saved actor ID makes unspecified appearance stable without rewriting old actors.
export function actorSex(id: string, declared?: unknown): Sex {
  const explicit = storedSex(declared);
  if (explicit) return explicit;
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return SEXES[hash % 2];
}
