export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <title>Random Video Chat</title>
      </head>
      <body>{children}</body>
    </html>
  );
}
