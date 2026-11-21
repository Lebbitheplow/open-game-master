import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

// jsx-a11y's recommended set, all of it. eslint-config-next registers the
// plugin but turns on only six of its rules. A place that must break a rule
// (a backdrop Escape already closes, a scroll box that takes Tab so the keys
// can scroll it, focus moved into a field the player just opened) says so
// beside it in an eslint-disable comment with the reason.
const a11yRecommended = {
  ...jsxA11y.flatConfigs.recommended.rules,
  // Our own components take a `role` prop that is not an ARIA role (the job a
  // model does: "story", "image", "dictation"). The rule checks only DOM
  // elements, where role is the ARIA one.
  "jsx-a11y/aria-role": ["error", { ignoreNonDOM: true }],
  // A choice card nests its words two spans deep (a title over a hint, beside
  // the radio), past the rule's default depth of two. Select
  // (src/components/ui/Select.tsx) draws a button, a control a label can name.
  "jsx-a11y/label-has-associated-control": ["error", { depth: 3, controlComponents: ["Select"] }],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees carry their own checkout and node_modules copy. Without
    // this, lint walks every one of them and reports thousands of problems
    // from dependencies rather than from this project's source.
    ".claude/**",
    // Disposable theme fixtures include Chromium's generated extension code.
    ".theme-preview/**",
    // pdf.js's worker and data, copied from pdfjs-dist by
    // scripts/copy-dice-assets.mjs: vendored and minified, not our source.
    "public/pdfjs/**",
  ]),
  {
    files: ["src/**/*.tsx"],
    rules: a11yRecommended,
  },
  // The browser's own dialogs are drawn by the browser, not the table, and
  // the desktop shell does not implement every one of them. Ask through
  // src/components/ui/ConfirmDialog.tsx and PromptDialog.tsx instead.
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/ConfirmDialog.tsx"],
    rules: {
      "no-restricted-globals": ["error", "confirm", "alert", "prompt"],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "confirm", message: "Use appConfirm from ConfirmDialog.tsx." },
        { object: "window", property: "alert", message: "Use appNotice from ConfirmDialog.tsx." },
        { object: "window", property: "prompt", message: "Use PromptDialog.tsx." },
      ],
    },
  },
]);

export default eslintConfig;
