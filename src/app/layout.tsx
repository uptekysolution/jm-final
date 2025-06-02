
import type { Metadata } from "next";
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "JM PlastoPack EMS",
  description: "Enterprise Management System for J M PlastoPack Pvt. Ltd.",
  icons: {
    icon: { url: '/assets/favicon.svg', type: 'image/svg+xml' },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body
        className={`antialiased`}
      >
        <AuthProvider>
          {children}
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
