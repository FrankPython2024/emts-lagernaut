import type { Metadata } from "next";
import { Providers } from "./providers";
import { SocketInitializer } from "@/components/ui/SocketInitializer";
import "./globals.css";

export const metadata: Metadata = {
  title: "EMTS Lagernaut",
  description: "Ersatzteil Management System — AfB Sömmerda",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@300;400;500;700&display=swap"
          rel="stylesheet"
        />
        {/* Dark-Mode vor Hydration setzen → kein Flicker */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body className="antialiased">
        <SocketInitializer />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
