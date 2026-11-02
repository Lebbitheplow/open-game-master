export const SEXES = ["Female", "Male"] as const;
export type Sex = (typeof SEXES)[number];

export function storedSex(value: unknown): Sex | undefined {
  return SEXES.includes(value as Sex) ? value as Sex : undefined;
}

// What the Cast recorded, as the board reads it: Female or Male is that sex;
// Nonbinary is none (null), so a view keeps its ordinary model rather than
// drawing someone the table recorded as nonbinary as a man or a woman;
// unrecorded is undefined, for the stable pick below.
export function declaredSex(gender: unknown): Sex | null | undefined {
  return gender === "Nonbinary" ? null : storedSex(gender);
}

// A saved actor ID makes unspecified appearance stable without rewriting old actors.
export function actorSex(id: string, declared?: unknown): Sex {
  const explicit = storedSex(declared);
  if (explicit) return explicit;
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return SEXES[hash % 2];
}
