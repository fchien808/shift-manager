import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shift Manager — Start the shift at midnight. Review finished work at 8am.",
  description:
    "Shift Manager delegates a full work shift to a tiered team of Claude agents — Opus plans, Sonnet workers execute in parallel, Haiku verifies quality — and delivers a single report while you sleep.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <nav className="topnav">
          <div className="topnav-inner">
            <Link href="/" className="brand">
              <span className="brand-mark">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </span>
              <span className="brand-name">Shift Manager</span>
            </Link>
            <div className="topnav-links">
              <Link href="/shifts">Shifts</Link>
              <Link href="/workers">Workers</Link>
              <Link href="/#how-it-works">How it works</Link>
            </div>
          </div>
        </nav>
        {children}
        <footer className="site-footer">
          <div className="site-footer-inner">
            <div className="brand">
              <span className="brand-mark">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </span>
              <span className="brand-name">Shift Manager</span>
            </div>
            <div className="footer-links">
              <Link href="/shifts">Shifts</Link>
              <Link href="/workers">Workers</Link>
              <Link href="/#how-it-works">How it works</Link>
            </div>
            <p className="footer-meta">Tiered multi-agent orchestration · Research preview</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
