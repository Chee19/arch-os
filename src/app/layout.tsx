import type { Metadata } from "next";
import { DM_Sans, IBM_Plex_Mono, Manrope } from "next/font/google";
import { WorkspaceProvider } from "@/ui/WorkspaceProvider";
import { Shell } from "@/ui/Shell";
import "./globals.css";
import "./archos.css";
import "./styles/overview.css";
import "./styles/case.css";
import "./styles/evidence.css";
import "./styles/incident.css";
import "./styles/records.css";

const sans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });
const heading = Manrope({ subsets: ["latin"], variable: "--font-manrope" });
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "ArchOS · Recovery workspace",
  description: "A calmer workspace for getting bookings back on track.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${heading.variable}`}
    >
      <body>
        <WorkspaceProvider>
          <Shell>{children}</Shell>
        </WorkspaceProvider>
      </body>
    </html>
  );
}
