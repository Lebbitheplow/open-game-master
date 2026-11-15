import { Church, Flame, Leaf, Sparkles, Waves, type LucideIcon, type LucideProps } from "lucide-react";
import type { AppearanceIcon } from "@/lib/appearance-themes";

// One checked map serves both the picker and the lobby emblem.
const ICONS = { church: Church, flame: Flame, leaf: Leaf, sparkles: Sparkles, waves: Waves } satisfies Record<AppearanceIcon, LucideIcon>;

export function ThemeIcon({ icon, ...props }: LucideProps & { icon: AppearanceIcon }) {
  const Icon = ICONS[icon];
  return <Icon {...props} />;
}
