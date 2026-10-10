import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "QueryMind · AI data analyst with live SQL and charts",
    template: "%s · QueryMind",
  },
  description:
    "Ask questions about your data in plain English. QueryMind uses Claude to write SQL, runs it on a Postgres database inside your browser (PGlite) and answers with tables and charts.",
  authors: [{ name: "Lalit Kumar Rajak", url: "https://github.com/lalitkumarrajak" }],
  keywords: ["AI data analyst", "text to SQL", "Claude", "PGlite", "Next.js", "data visualization"],
  openGraph: {
    title: "QueryMind · AI data analyst",
    description:
      "Ask your data anything. Claude writes the SQL, your browser runs it, you get the answer and the chart.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0e10" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
