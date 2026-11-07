// What the spell pickers fetched, kept for the page's life
// (src/components/sheet/useSpellPool.ts). Its own module, with nothing heavy
// behind it, so the workshop can clear it when a spell or a class is saved
// without loading the pickers: a homebrew spell made this session, or a
// class's list just edited, was missing from a pool fetched before it until
// the page was reloaded (issue #833 review).

export type CachedPoolSpell = {
  name: string;
  level: number;
  slug?: string;
  source?: "open5e" | "homebrew";
  documentSlug?: string;
  document?: string;
  data?: Record<string, unknown>;
};

export const poolCache = new Map<string, CachedPoolSpell[]>();
export const lookupCache = new Map<string, CachedPoolSpell | null>();

export function forgetSpellPools(): void {
  poolCache.clear();
  lookupCache.clear();
}
