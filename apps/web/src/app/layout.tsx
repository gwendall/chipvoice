import type { ReactNode } from "react";
import "./globals.css";
import "@/studio/style.css";

export const metadata = {
  title: "chipvoice",
  description:
    "Play five classic sound chips. Make a tune, borrow a voice with arcade effects, and take the music into your own project.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
