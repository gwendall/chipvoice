import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isLocale, locales } from "@/i18n/core";
import { getMessages } from "@/i18n/server";
import { I18nProvider } from "@/i18n/react";
import { PlayerProvider } from "@/lib/player";
import { Header } from "@/components/Header";
import "../globals.css";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export const metadata = {
  title: "gamesounds.ai",
  description: "A game sound-effects bank filed by event, with variants, consistent loudness and a clear licence.",
};

export default async function RootLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale}>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <I18nProvider locale={locale} messages={await getMessages(locale)}>
          <PlayerProvider>
            <Header />
            <main id="main">{children}</main>
          </PlayerProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
