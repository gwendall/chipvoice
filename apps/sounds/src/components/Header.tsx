import Link, { LanguageSelector } from "@/i18n/react";

/** Site chrome: shown on every page, one accent colour, no per-page nav
 * state to track (spec: "Minimal, fast, keyboard first"). */
export function Header() {
  return (
    <header className="row" style={{ justifyContent: "space-between", padding: "16px 24px", borderBottom: "1px solid var(--border)" }}>
      <Link href="/" style={{ fontWeight: 700, fontSize: "1.1em", textDecoration: "none" }}>
        gamesounds.ai
      </Link>
      <nav className="row" style={{ gap: 16 }}>
        <Link href="/docs" style={{ textDecoration: "none" }}>
          Docs
        </Link>
        <LanguageSelector />
      </nav>
    </header>
  );
}
