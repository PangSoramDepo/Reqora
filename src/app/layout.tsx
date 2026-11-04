import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import { RAIL_BOOT_SCRIPT } from "@/components/shell/rail-toggle";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Reqora",
    template: "%s · Reqora",
  },
  description: "Visual API flow builder for orchestrating HTTP workflows.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the boot script may set data-rail on <html> before React hydrates.
    <html lang="en" className={`dark ${geist.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: RAIL_BOOT_SCRIPT }} />
        {/* Icon font: display=block avoids flashing raw ligature names like "play_arrow" before it loads. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font, @next/next/google-font-display */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
        />
      </head>
      <body className="bg-surface font-body-md text-body-md text-on-surface antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
