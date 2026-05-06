import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EMTS Lagernaut",
  description: "Ersatzteil Management System — AfB Sömmerda",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@300;400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-ubuntu antialiased">
        {children}
      </body>
    </html>
  );
}
