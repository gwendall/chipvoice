import type { ReactNode } from "react";
import "./globals.css";
import "@/ui/tokens.css";
import "@/ui/style.css";
import "@/studio/style.css";

export const metadata = {
  title: "chipvoice",
  description:
    "Classic console sound chips, rebuilt in JavaScript. Play familiar melodies, switch consoles, and take the open-source library into your own project.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
