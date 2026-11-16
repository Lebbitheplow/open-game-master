"use client";

import { Select } from "@/components/ui/Select";
import { LanguageFlag } from "@/components/ui/LanguageFlag";
import {
  TABLE_LANGUAGES,
  TABLE_LANGUAGE_NAMES,
  type TableLanguage,
} from "@/lib/schemas/game-settings-options";

// The one language picker: the server's language (setup wizard, Admin >
// Settings) and a table's (campaign creator, table settings). Each row is the
// language's flag and its own name, with the English name under it, so a
// French admin finds "Français" and an English one finds "French".
export function LanguageSelect({
  value,
  onChange,
  label,
  className,
  size = "md",
  disabled = false,
}: {
  value: TableLanguage;
  onChange: (language: TableLanguage) => void;
  // The accessible name; the visible label is the caller's.
  label: string;
  className?: string;
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  return (
    <Select<TableLanguage>
      value={value}
      onChange={onChange}
      label={label}
      className={className}
      size={size}
      disabled={disabled}
      options={TABLE_LANGUAGES.map((language) => {
        const { english, native } = TABLE_LANGUAGE_NAMES[language];
        return {
          value: language,
          label: native,
          hint: english === native ? undefined : english,
          leading: <LanguageFlag language={language} />,
        };
      })}
    />
  );
}
