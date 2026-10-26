import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Git History",
  description: "Local Git client with an interactive commit graph and merge history.",
};

// Applies the saved theme before first paint to avoid a flash of the wrong theme.
const THEME_SCRIPT = `try{var t=localStorage.getItem("git-history-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
