import type { Metadata } from "next";
import "./globals.css";
import React from "react";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ThemeProvider } from "@/components/theme/theme-provider";

export const metadata: Metadata = {
  title: "Question Crafter",
  description: "Question Crafter chat interface",
  icons: {
    icon: [
      {
        url: "/question-crafter-logo.svg?v=20260208",
        type: "image/svg+xml",
      },
      {
        url: "/favicon-32x32.png?v=20260208",
        type: "image/png",
        sizes: "32x32",
      },
      {
        url: "/favicon-16x16.png?v=20260208",
        type: "image/png",
        sizes: "16x16",
      },
      {
        url: "/favicon.ico?v=20260208",
        sizes: "any",
      },
    ],
    shortcut: ["/favicon.ico?v=20260208"],
    apple: [
      {
        url: "/apple-touch-icon.png?v=20260208",
        type: "image/png",
        sizes: "180x180",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground min-h-screen">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <NuqsAdapter>{children}</NuqsAdapter>
        </ThemeProvider>
      </body>
    </html>
  );
}
