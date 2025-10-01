import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Random Video Chat - Connect with Strangers Worldwide",
  description: "Free anonymous video chat platform. Connect instantly with random people worldwide through secure peer-to-peer video calls.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
