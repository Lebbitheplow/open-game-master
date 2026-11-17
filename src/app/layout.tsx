import { LocaleApplier, LocaleProvider } from "@/lib/locale";
// The server renders a French page with the catalog in hand (translate.ts).
import "@/lib/i18n/fr-catalog";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/locale";
import { ThemeApplier } from "@/lib/theme-mode";
import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import localFont from "next/font/local";
import TopoBackground from "./TopoBackground";
import { ServerAddressButton } from "@/components/ServerAddressButton";
import { ConfirmHost } from "@/components/ui/ConfirmDialog";
import "./globals.css";

// The faces ship in the repo (Google Fonts' latin subsets) so a build
// never fetches from fonts.gstatic.com: a failed download there broke CI
// builds and made offline builds impossible.
// The interface face: Ysabeau Office, a humanist sans drawn on a Garamond
// skeleton, so labels and numbers sit beside Cinzel and Source Serif like
// the tables of a rulebook. Its figures are lining and tabular by default,
// which is what dice math and stat columns need (the Tailwind font-mono
// utility resolves to this face too: globals.css).
const uiSans = localFont({
  src: [
    { path: "./fonts/ysabeau-office.woff2", weight: "100 900", style: "normal" },
    { path: "./fonts/ysabeau-office-italic.woff2", weight: "100 900", style: "italic" },
  ],
  variable: "--font-ui",
});

// A fixed-width face for what is typed or copied exactly: a room code, a
// path, a command, a log (the font-code utility).
const codeMono = localFont({
  src: "./fonts/geist-mono.woff2",
  variable: "--font-code-face",
  weight: "100 900",
});

const sourceSerif = localFont({
  src: [
    { path: "./fonts/source-serif-4.woff2", weight: "200 900", style: "normal" },
    { path: "./fonts/source-serif-4-italic.woff2", weight: "200 900", style: "italic" },
  ],
  variable: "--font-source-serif",
});

// Engraved-capitals display face for wordmarks, screen titles, and
// campaign names; body text stays on the interface face and Source Serif.
const cinzel = localFont({
  src: "./fonts/cinzel.woff2",
  variable: "--font-display",
  weight: "400 900",
});

export const metadata: Metadata = {
  title: "Open Game Master",
  description: "Multiplayer D&D 5e campaigns with an AI Game Master.",
  applicationName: "Open Game Master",
  appleWebApp: {
    capable: true,
    title: "Open GM",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#181420",
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const initialLocale = resolveLocale({
    savedLocale: cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: headerStore.get("accept-language"),
  });
  return (
    <html
      lang={initialLocale === "fr" ? "fr-FR" : "en-US"}
      className={`${uiSans.variable} ${codeMono.variable} ${sourceSerif.variable} ${cinzel.variable} h-full antialiased`}
      // browser extensions (Grammarly among them) inject attributes into <html>
      // and <body> before React loads
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {/* The reader's theme and scale, applied to <html> before anything
            else paints (docs/vtt-parity-implementation-plan.md section 14). */}
        <ThemeApplier />
        {/* The reader's language, the same on-device contract: the stored
            choice (or the browser's) lands on <html lang> before paint. */}
        <LocaleApplier />
        {/* Dust motes first, so the contour canvas is drawn over them. */}
        <div className="ambient-dust" aria-hidden="true" />
        <TopoBackground />
        <LocaleProvider initialLocale={initialLocale}>
          {children}
          {/* Every page: the QR and address a friend scans to add this server
              in the app or open it in a browser on the same network. */}
          <ServerAddressButton />
          {/* The app's own confirm and notice, asked from anywhere. */}
          <ConfirmHost />
        </LocaleProvider>
      </body>
    </html>
  );
}
