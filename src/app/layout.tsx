import type { Metadata } from "next";
import { DM_Sans, IBM_Plex_Mono } from "next/font/google";
import { DemoProvider } from "@/ui/DemoProvider";
import { Shell } from "@/ui/Shell";
import "./globals.css";
import "./archos.css";

const sans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "ArchOS · Recovery operations",
  description:
    "Rescues failed marketplace bookings and moves money within policy.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <DemoProvider>
          <Shell>{children}</Shell>
        </DemoProvider>
      </body>
    </html>
  );
}
