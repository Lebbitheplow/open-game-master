import { Anvil, Church, Flame, Flower2, Leaf, Shield, Sparkles, Waves, type LucideIcon, type LucideProps } from "lucide-react";
import type { AppearanceIcon } from "@/lib/appearance-themes";

// One checked map serves both the picker and the lobby emblem.
const ICONS = { anvil: Anvil, church: Church, flame: Flame, flower: Flower2, leaf: Leaf, shield: Shield, sparkles: Sparkles, waves: Waves } satisfies Record<AppearanceIcon, LucideIcon>;

export function ThemeIcon({ icon, ...props }: LucideProps & { icon: AppearanceIcon }) {
  const Icon = ICONS[icon];
  return <Icon {...props} />;
}
