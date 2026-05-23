import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Market Maker", description: "Admin trading console" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
