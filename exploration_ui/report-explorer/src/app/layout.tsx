import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@carbon/styles/css/styles.css";
import "./globals.scss";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import Sidebar from "@/components/Sidebar";
import TopHeader from "@/components/TopHeader";
import AuthProvider from "@/components/AuthProvider";
import { RefreshProvider } from "@/contexts/RefreshContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Network Rail Gap Detection",
  description: "View and analyze missed train report events",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AuthProvider>
          <RefreshProvider>
            <Sidebar />
            <TopHeader />
            <main
              style={{
                marginLeft: '260px',
                marginTop: '60px',
                minHeight: 'calc(100vh - 60px)',
                background: '#f4f4f4',
              }}
            >
              {children}
            </main>
          </RefreshProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
