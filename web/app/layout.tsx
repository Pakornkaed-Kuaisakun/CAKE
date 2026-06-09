import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CAKE Core",
  description: "Local CAKE core web client",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
