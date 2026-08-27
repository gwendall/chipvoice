import type { ReactNode } from "react";
import "./globals.css";
import "@/studio/style.css";

export const metadata = {
  title: "chipvoice",
  description:
    "Write music on a real NES sound chip. An API for agents, and a link anyone can play.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
