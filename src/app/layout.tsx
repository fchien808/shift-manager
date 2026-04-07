import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Shift Manager",
  description:
    "Delegate multi-hour knowledge work to a team of Claude agents. Async.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <Link
            href="/"
            className="nav-brand"
            style={{ color: "inherit", textDecoration: "none" }}
          >
            <span className="dot" />
            <span>Claude Shift Manager</span>
          </Link>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              fontSize: 12,
              color: "var(--muted)",
            }}
          >
            <Link href="/shifts" style={{ color: "var(--muted)" }}>
              Past shifts
            </Link>
            <span>Tiered multi-agent orchestration · Research preview</span>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
