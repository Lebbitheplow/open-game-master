import { Anvil, Church, Flame, Leaf, Shield, Snowflake, Sparkles, Waves, type LucideIcon, type LucideProps } from "lucide-react";
import type { AppearanceIcon } from "@/lib/appearance-themes";

// One checked map serves both the picker and the lobby emblem.
const ICONS = { anvil: Anvil, church: Church, flame: Flame, leaf: Leaf, shield: Shield, snowflake: Snowflake, sparkles: Sparkles, waves: Waves } satisfies Record<AppearanceIcon, LucideIcon>;

export function ThemeIcon({ icon, ...props }: LucideProps & { icon: AppearanceIcon }) {
  const Icon = ICONS[icon];
  return <Icon {...props} />;
}
